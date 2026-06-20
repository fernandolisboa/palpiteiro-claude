# ADR 0033 — Cartões liquidáveis (Tier 3) via extração web-grounded

## Status

Accepted (2026-06-20) — decisão delegada pelo dono ("você decide, só faz"; o domínio público
cobre o dado que falta na api-football pra Copa). **Cruza o gate Tier 3** (ADR 0015 D2 / CLAUDE.md:105
exigem 1 ADR por mercado Tier 3) — este é o ADR que o gate pede. **Escopo: CARTÕES (amarelo + vermelho)
liquidáveis; ESCANTEIOS ficam fun-only/diferidos** (a sonda empírica os reprovou — ver discovery §8).
Reusa o seam de web search da Claude já estabelecido no ADR 0032 (via `lib/ai/predict.ts` / seam
`AIProvider` ADR 0027, logado em `ai_calls`) — **sem provider externo novo**. Build sequenciado
**depois** do provider de web search (#377).

## Contexto

Cartão e escanteio são palpites **fun-only** (sem badge) porque o normalizer de eventos é goal-only
(`lib/providers/sports-data/api-football/adapter.ts:549`, `if (ev.type !== "Goal") continue`) e a
camada normalizada (`types.ts`) só modela gols/assists. O #354 (migration 0036) já liquidou 4 tipos
gol-derivados pelo registry de palpite (`SETTLEABLE_PALPITE_TYPES`, `palpite-dispatch.ts`), provando
que dar badge a um tipo novo é um padrão estabelecido — falta a **fonte de dado** + a **regra**.

A discovery do #350 (`docs/discovery/event-based-settlement-cards-corners.md`) mapeou o terreno:

- **A api-football que já pagamos (Pro/7500-dia) cobre cartões/escanteios pra ligas de CLUBE**
  (Brasileirão, Champions) — via `/fixtures/events` (cartões, já no feed) e `/fixtures/statistics`
  (escanteios). O buraco é **específico da Copa** (`coverage` de stats pode não vir populada pra
  `league_id=1`, mesmo padrão do `injuries=false`). Hoje `ACTIVE_LEAGUES=["world_cup"]` é a única
  liga ativa → o caminho estruturado não resolve a liga ativa.
- APIs estruturadas que cobrem a Copa custam caro (SportMonks plano dedicado €69+/mo; football-data
  sem stats de WC; Sportradar/Opta enterprise) — não valem por um torneio.
- Mas o dado é **conhecimento público trivial** (qualquer ESPN/Globo/SofaScore mostra o FT). A
  pergunta real não é "achar o número" — é **confiar nele o bastante pra liquidar automaticamente**,
  sem humano, sob o princípio do projeto "prefer skip over silent wrong settle" (settlement
  idempotente + override manual).

**Sonda empírica (2026-06-20, discovery §8):** 6 jogos de Copa encerrados, 2 buscas web cegas e
independentes (A/B) por jogo. Resultado: **cartões são settlement-grade** (amarelos A≡B exato 5/5;
vermelhos 5/5, o único vermelho unânime em 6+ fontes; cartões vivem no play-by-play que faz fetch
limpo). **Escanteios NÃO são** (A≡B limpo em 1/6; ±1 de variância real entre providers; tabelas de
stats são JS-rendered, invisíveis a fetch puro). Isso fixa o escopo: cartões sim, escanteios não.

## Decisão

**1. Cartões (amarelo + vermelho) viram mercados Tier 3 liquidáveis**, adicionando os tipos a
`SETTLEABLE_PALPITE_TYPES` (`lib/ai/palpites/settleable.ts`) e uma regra pura em
`lib/settlement/rules/` registrada em `PALPITE_SETTLEMENT_RULES` (`palpite-dispatch.ts`), com
`PalpiteResultData` estendido (contagens FT de cartão, Zod-validado por ADR 0016).

**2. A fonte do dado de cartão é dupla, por liga:**
- **Ligas de clube** (quando ativas) → api-football estruturado: `/fixtures/events` (`type="Card"`,
  já no feed) com retenção no normalizer. Caminho barato, determinístico, preferido onde há cobertura.
- **Copa (e qualquer liga sem cobertura estruturada)** → **extração web-grounded** reusando o seam
  de web search da Claude (ADR 0032), pela fronteira `lib/ai/predict.ts` / `AIProvider`, logada em
  `ai_calls`. **Sem provider externo novo, sem infra de busca própria.**

**3. Guardrails de liquidação (inegociáveis, justificados pela sonda):**
- **Dupla leitura cega:** liquidar só se duas extrações independentes (A e B) retornarem valor
  não-nulo **E iguais**; qualquer `null` ou `A≠B` deixa o mercado **PENDENTE** (revisão/override
  manual). Nunca auto-liquidar com uma leitura só.
- **≥2 fontes públicas independentes** citando o mesmo número explícito **numa página efetivamente
  lida**; **nunca** promover valor que só apareça em resumo de IA/buscador.
- **Preferir bookings nomeados** (play-by-play / box por jogador) a agregados crus; desconfiar de
  agregado que "completa" com jogadores não nomeados (a sonda pegou contagens infladas do FOX assim).
- Disclaimer + idempotência + override manual mantidos (shield regulatório; ADR 0030 mantém a
  manchete sem linguagem de EV/stake).

**4. Escanteios ficam DIFERIDOS / fun-only.** Não auto-liquidar via busca web (tabelas JS-rendered +
variância de ±1 entre providers — fatal pra over/under). Reabrir só atrás de um renderer JS-capaz
(Playwright DOM / Opta JSON lido verbatim) **ou** API estruturada com cobertura provada, + a regra
"qualquer split de ±1 ⇒ pendente". Até lá, escanteio segue sem badge.

**5. Gate de cobertura por-mercado:** o mercado de cartão fica **inerte** até a fonte ser provada
pra liga (flag per-market + `coveredLeagues`, ADR 0015 D1/D6) — não embarcar badge pra liga sem
fonte validada ao vivo.

**6. Sequenciamento:** o caminho web-grounded **consome** o provider de web search do arco
value-aware (#377, ADR 0032). Construir cartões-via-web **depois/junto** de #377 — reusar o provider,
não duplicar.

## Consequências

- (+) Fecha o gap "fun-only" de **cartões**, incluindo a Copa (a liga ativa hoje), reusando seam
  existente (0032) + registry de settlement (0016) + flag per-market (0015) — infra nova mínima,
  zero provider externo novo.
- (+) Padrão de fonte-por-liga: estruturado barato onde há cobertura (clubes), web-grounded onde não
  (Copa) — generaliza pra futuros tipos com buraco de cobertura.
- (−) Settlement passa a consumir um caminho de **extração por LLM** — superfície de risco nova
  (alucinação de número). Mitigada por: dupla leitura A≡B, ≥2 fontes citadas, skip-não-fabrica,
  override manual, idempotência. O risco residual é deixar **pendente demais** (conservador), não
  liquidar errado — alinhado ao princípio do projeto.
- (−) Normalizer passa a reter eventos não-gol (cartões) pro caminho de clube → DTO de stats novo +
  Zod + testes.
- (−) Escanteios continuam sem badge (diferidos) — resolução parcial do #350 por design.
- (−) Custo de web search por jogo liquidado (metered por busca; bounded por jogo finalizado; barato).
- (±) Dependência de sequenciamento com #377 (provider de web search).

## Alternativas consideradas

- **api-football estruturado pra tudo** — rejeitado como solução única: buraco de cobertura da Copa
  (a liga ativa). Mantido como caminho preferido pras ligas de clube.
- **SportMonks / football-data.org / Sportradar / Opta** — caros ou sem cobertura de WC (discovery
  §4); SportMonks via plano dedicado €69+/mo só pela Copa não se paga num side-project solo.
- **Escanteios via busca web** — reprovado empiricamente (sonda §8): variância de provider + tabelas
  JS-rendered. Diferido atrás de renderer/structured-API.
- **Scraping direto de FotMob/SofaScore** — ToS proíbe extração automatizada (mesmo motivo do ADR
  0026 rejeitar Sofascore/Transfermarkt). A web search nativa da Claude respeita robots/ToS via o
  provider de busca, e é o caminho sancionado pelo ADR 0032.

## Referências

#350, #354, #377 (provider de web search), `docs/discovery/event-based-settlement-cards-corners.md`
(esp. §4 providers + §8 sonda), CLAUDE.md:105, ADR 0015 (Tier gate D2) / 0016 (settlement registry) /
0025 (Tier 3 odds+settlement) / 0026 (provider dedicado de dado) / 0030 (palpite-first firewall) /
0032 (seam de web search), `adapter.ts:549`, `settleable.ts:15-21`, `palpite-dispatch.ts:33-35`,
`active-leagues.ts:14`.

## Addendum (2026-06-20, #394) — reconciliação pós-#419 e pós-reshape

Esta decisão (0033) precede o **#419** (que JÁ embarcou a linha de cartão fun-only) e os
guardrails reshaped no design do #394. O addendum corrige o texto original ponto a ponto;
**onde conflita, o addendum vence**.

**1. Tipo = `cards` (amarelos), NÃO "amarelo + vermelho".** §1/§3 e o escopo do Status diziam
"cartões (amarelo + vermelho)". O #419 embarcou UM tipo `cards` (enum migr 0039) com params
`{line, scope:'total'}` = **TOTAL DE AMARELOS `>= line`, line ∈ {4,6}** (`CARDS_LINE`,
`settleable-rows.ts`). O #394 liquida **só total de amarelos**. Vermelhos ficam fora da chave de
liquidação. `red_card`/`corners` seguem fun-only (FORA de `SETTLEABLE_PALPITE_TYPES`).

**2. Seam = `runAnalysis`, NÃO `predict()`.** §2 dizia "pela fronteira `lib/ai/predict.ts`".
CORRIGE: a extração vai por
`getProviderForModel(MODEL_REGISTRY['claude-haiku-4-5']).runAnalysis({…serverTool:{kind:'web_search', allowedDomains, maxUses}})`
(o padrão #377/`lib/providers/news/anthropic-web-search.ts`), logada em `ai_calls`, `hasKey()`-gated
(zero gasto sem chave), SEM provider novo, SEM SDK direto. `predict.ts` NÃO é a porta de entrada aqui
(é a porta do caminho de VALOR; o caminho web-grounded de notícias/cartões usa o seam direto, mirror
da AbsencesProvider/ADR 0026). `lib/settlement/extract-cards-from-web.ts` é o módulo.

**3. A≡B DECORRELACIONADO, não "dupla leitura cega".** §3 pedia duas extrações cegas
"independentes". SHARPEN: A e B rodam com partições `allowedDomains` **DISJUNTAS** (A =
`CARD_DOMAINS_BR`, B = `CARD_DOMAINS_INTL`, em `allowed-domains.ts`) — pools de busca fisicamente
distintos, não clones byte-idênticos. Liquida só se ambos não-nulos E iguais; qualquer `null` ou
`A≠B` → PENDENTE.

**4. Garantia de origens — DOWNGRADE honesto do que é construível.** §3 pedia "≥2 fontes citando o
mesmo número numa página efetivamente lida". REALIDADE DO SEAM: no modo server-tool
`runServerToolAnalysis` devolve `toolInput:undefined` (`tool_choice:auto`, sem submit forçado) e o
`extractSources` (o firewall) só carrega `{title,url}` — **NÃO há canal estruturado pra um número
por-fonte**. A CONTAGEM vem do bloco de **TEXTO (prosa)** do modelo, ancorada pela busca server-side
mas **NÃO protegida pelo firewall**. Isso é ACEITÁVEL aqui: uma contagem de cartões é um **FATO de
liquidação, não uma afirmação de VALOR** (EV/odd/stake) — o firewall de linguagem-de-valor (ADR
0030/0032) **NÃO se aplica**. Parse defensivo (um único inteiro via sentinela `AMARELOS_TOTAL=`;
ambíguo/`INDISPONIVEL`/múltiplo → `null` → PENDENTE). A garantia REAL construída:
`A.count === B.count` sobre pools disjuntos **E** cada leitura com ≥1 fonte real **E** união de
ORIGENS EDITORIAIS distintas (colapsadas: `espn.com`+`espn.com.br`→1, `*.globo.com`→1, via a tabela
pinada `origin-collapse.ts`) **≥ 2**. O `{origin,count}` por-fonte do texto original é mecanicamente
inderivável e está **RETRATADO**. Além disso: cartões têm UMA súmula oficial upstream, então **A≡B é
CONCORDÂNCIA de VEÍCULOS, NÃO corroboração independente**; a proteção real é skip-on-disagreement +
attempt-cap + override.

**5. Override manual concreto.** §3 "override manual" agora é um writer real:
`upsertPalpiteOutcomeOverride` (espelha `upsertOutcomeOverride` MENOS `profitUnits`) +
`overridePalpiteOutcome` admin-gated (won/lost só, reject-empty-first). Rows overridden são
**trust-the-admin** (NÃO re-validadas pela regra contra `line`).

**6. Attempt-cap cross-tick (NOVO).** Rows stuck-PENDING (A≠B repetido) NÃO são re-extraídas pra
sempre: sidecar `palpite_settlement_attempts` (migration **0040**, a ÚNICA do #394), incremento ANTES
da chamada paga (incondicional), fan-out gated em `attempts < CAP` (=3). Esgotou → PENDENTE
permanente até override. KV foi rejeitado (TTL zera o cap silenciosamente → re-gasto).

**7. `ai_calls` do cron loga sob o DONO do palpite.** `ai_calls.userId`/`matchId` são
notNull+restrict; o cron não tem usuário requisitante. A pending query passa a SELECT
`palpiteSets.userId` → cada extração loga sob o id do dono do palpite (matchId já na row). Sem
migration de coluna nullable, sem usuário sentinela.

**8. Inércia por COBERTURA, não por flag.** §5 falava "flag per-market + `coveredLeagues`". CONCRETIZA:
`CARDS_COVERED_LEAGUES` (`cards-coverage.ts`) **VAZIO** ⇒ o fan-out web NÃO dispara pra liga nenhuma
(gate ANTES da chamada paga, no orquestrador `settle-palpites.ts`) ⇒ zero gasto, zero badge. Ligar uma
liga exige prova empírica de fonte ao vivo (decisão de ENGENHARIA, não flag que o dono vira).
**`deriveSettleable` é league-BLIND** (só vê `type`): a row NOVA de cartão é `settleable=true` e
ENTRA no pending set — a inércia é 100% da cobertura, não do gate SQL. **NÃO há backfill** de
`palpites.settleable` nas rows #419 antigas (elas persistiram `settleable=false` e o gate SQL duplo as
mantém fora). `WEB_GROUNDED_PALPITE_TYPES` ∩ `EVENT_BACKED_PALPITE_TYPES` = ∅ (invariante de
import-time): cartões NÃO disparam `/fixtures/events` + web search ao mesmo tempo.

**9. Custo.** Por liquidação de cartão: **2 LEITURAS** (A+B), cada uma com até `max_uses=2` **BUSCAS**
web (≤ **4 web-searches por tick** × ~$0,01) + 2 Haiku, RETENTADO por tick até o cap ⇒ ≤ **4×CAP = 12
web-searches por row stuck**. (Leitura ≠ busca: uma leitura = um `runAnalysis`, que pode disparar até
`max_uses` buscas server-side.) A taxa de web search **NÃO entra em `ai_calls.costUsd`** (metered
out-of-band, ADR 0032 §4). Com `CARDS_COVERED_LEAGUES` vazio = literalmente **zero** até uma liga ser
ligada.

**10. Caveat de ativação por liga (open-risk, antes de ligar `CARDS_COVERED_LEAGUES`).** O gate "≥1
fonte por leitura" lê os blocos `web_search_tool_result` do **TURNO FINAL** da resposta
(`collectOrigins` ← `result.contentBlocks`, mesma fronteira herdada do seam #377/news). Se a busca
disparar um `pause_turn` e o turno final NÃO re-emitir os blocos de resultado, `sourceCount=0` →
extração devolve `null` → PENDENTE **mesmo numa contagem correta** (direção SEGURA: skip, nunca
wrong-settle; pré-existente — o provider de notícias já tem a mesma limitação em prod). Antes de ligar
QUALQUER liga, validar empiricamente que a contagem reconcilia com fonte ≥1/pool nas extrações reais
(taxa de PENDENTE-falso-positivo). Se necessário, acumular `contentBlocks` cross-turno no adapter
(opt-in aditivo) ou afrouxar o gate de fonte pra ocorrência de busca server-side. Enquanto a cobertura
está vazia, é inerte e o caveat não morde.

Referências do addendum: #419 (linha fun-only), `extract-cards-from-web.ts`, `origin-collapse.ts`,
`cards-coverage.ts`, `cards_palpite.ts`, `palpite-settlement-attempts.ts`, migration
`0040_modern_giant_girl.sql`, `settle-palpites.ts` (orquestração), `settleable.ts:15-22` (forcing
function), `allowed-domains.ts` (partições A/B).
