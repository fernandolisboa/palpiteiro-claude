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
