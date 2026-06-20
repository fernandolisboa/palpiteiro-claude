# DISCOVERY — Cartões/escanteios liquidáveis (badge) — fonte de stats, World Cup e o gate Tier 3 (#350)

> Documento de followup pra um `/grill-with-docs` → (talvez) `/to-issues`. Aterrado no código
> real (investigação multi-agente + verificação adversarial, 2026-06-19), com providers checados
> em docs reais. **Não é spec nem decisão** — é o mapa do terreno + as alavancas + as perguntas
> em aberto. Números marcados *(UNVERIFIED)* **NÃO foram confirmados ao vivo** — a fonte da verdade
> é uma chamada real ao provider (§0). **Pricing de provider sai de docs públicos atrás de
> Cloudflare/403** → re-confirmar na página de preços antes de citar pro dono.

## 0. Meça primeiro (a verdade só vem de uma chamada ao vivo)

A pergunta do #350 — "dá pra dar badge de cartão/escanteio?" — colapsa em UMA pergunta empírica:
**a stat de cartão/escanteio existe, populada, no full-time de um jogo de World Cup?** Hoje
`ACTIVE_LEAGUES = ["world_cup"]` é a ÚNICA liga ativa (`lib/config/active-leagues.ts:14`; clubes
fora de temporada, voltam jul/ago). Logo o feature só tem **valor ao vivo** se funcionar pra Copa
PRIMEIRO. E a Copa tem buraco de cobertura conhecido: **api-football reporta `coverage.injuries=false`
estrutural pra `league_id=1` em TODAS as edições** (ADR 0006/0026) — flag-true ≠ dado-presente é um
padrão JÁ observado neste projeto.

**Antes de qualquer decisão, rodar com a chave de produção:**

```
# 1) A liga sequer declara cobertura de stats?
GET https://v3.football.api-sports.io/leagues?id=1&season=2026
→ ler coverage.fixtures.statistics_fixtures, coverage.fixtures.events, coverage.top_cards

# 2) O dado VEM, não-nulo, num jogo finalizado de Copa?
GET https://v3.football.api-sports.io/fixtures/statistics?fixture={WC_fixture_finalizado}
→ confirmar "Corner Kicks", "Yellow Cards", "Red Cards" NÃO-nulos
```

Os docs da api-football são EXPLÍCITOS: *"the coverage of a competition can vary from season to
season and values set to True do not guarantee 100% data availability"* — e o guia da Copa 2026
adiciona *"availability may vary from match to match especially early in the tournament"*. **Trust
no flag é inseguro pra Copa** (o precedente de injuries=false prova isso). Sem essa verificação ao
vivo, o badge NÃO pode ser prometido pra liga ativa.

## 1. Reframe central — o dado de cartão JÁ chega; o de escanteio é 1 endpoint a mais

A intuição "precisa de um provider novo" provavelmente está **errada**. A realidade do código:

- **Cartões JÁ chegam no feed que o app PAGA.** `/fixtures/events` é consumido hoje (settlement de
  artilheiro/assist, #290). O schema do projeto documenta `type ∈ {"Goal","Card","subst","Var"}`
  (`schemas.ts:102`); eventos `type="Card"` trazem `detail ∈ {"Yellow Card","Red Card","Yellow-Red
  Card"}` + time/player/minuto. **O normalizer só descarta.**
- **O normalizer é goal-only — por design.** `toNormalizedFixtureEvents` (`adapter.ts:539`) tem
  `if (ev.type !== "Goal") continue;` (linha 549). Card, subst e Var são jogados fora antes de
  qualquer retenção. Reter cartões = **mudança no normalizer**, não feed novo.
- **Escanteio NÃO é evento — é estatística.** Escanteio não é um evento discreto de jogador; não
  existe `type="Corner"` em `/fixtures/events`. A contagem de escanteios SÓ vem de
  `/fixtures/statistics` (string exata `"Corner Kicks"`), endpoint que **o codebase NÃO chama em
  lugar nenhum hoje** (grep: zero matches pra `fixtures/statistics`). Logo escanteio = **integração
  de endpoint novo** (mesmo vendor/chave) + ~1 request por fixture finalizado.
- **Cartão tem fonte dupla** — pode sair de `/fixtures/events` (contar os `detail` de Card) OU de
  `/fixtures/statistics` (`"Yellow Cards"` + `"Red Cards"`). As duas podem **divergir** (um
  "Yellow-Red" conta como 2 amarelos + 1 vermelho em algumas convenções). A regra de settlement
  tem que escolher UMA fonte autoritativa e fixar a semântica de contagem — decisão de ADR.

## 2. A realidade atual do código (o que está liquidável e onde está o portão)

**5 tipos de palpite SÃO liquidáveis hoje** (gol-derivados; `lib/ai/palpites/settleable.ts:15-21`,
migration `0036`), e isso aconteceu **sem provider novo**:

- `exact_score` (original) + `margin`, `clean_sheet`, `first_half_score`, `first_to_score` (4 novos
  do #354).
- A tupla `SETTLEABLE_PALPITE_TYPES` é a **fonte única** que gateia AMBOS a derivação de
  `settleable` (`deriveSettleable`, boundary de escrita) e o predicado da pending query do cron —
  defense-in-depth.
- Dos 5, só `first_to_score` precisa de `/fixtures/events` — está em
  `EVENT_BACKED_PALPITE_TYPES = {first_to_score}` (`palpite-dispatch.ts:33-35`). Os outros 4
  settlam só do placar de 90'/intervalo, sem egress extra.

> ⚠️ **Correção de mecanismo (verificação adversarial):** o caminho de PALPITE (#354) tem registry
> PRÓPRIO — `PALPITE_SETTLEMENT_RULES` + `EVENT_BACKED_PALPITE_TYPES` (`palpite-dispatch.ts`). NÃO
> é o `EVENT_BACKED_RULE_KEYS = {anytime_scorer, assist}` de `settle.ts:25` (esse é o caminho de
> VALOR/#290, DISJUNTO). Um ADR de cartão/escanteio estende o registry de **palpite**, não o de valor.

**Cartões/escanteios são "fun-only" (sem badge):**

- O enum de palpite tem `red_card` e `corners` (desde #315), mas ambos estão **FORA** de
  `SETTLEABLE_PALPITE_TYPES` → `settleable=false` derivado → nunca entram no cron, e a view força
  `{kind:"fun"}` (`lib/view/palpites.ts`).
- Os DTOs normalizados (`lib/providers/sports-data/types.ts`) só modelam gols/assists — **não há
  shape de cartão/escanteio** na camada normalizada.

**O portão Tier 3 (onde mora):**

- `CLAUDE.md:105` (seção "O que NÃO fazer"): *"❌ Adicionar mercado de **Tier 3** (correct score,
  escanteios, cartões, player props, handicap asiático) … sem ADR."* — proíbe explicitamente.
- ADR 0015 (decisão 3, **D2** — linhas 107-111): *"Tier 3 (cada um = 1 ADR próprio): correct
  score, escanteios, cartões, player props, handicap asiático fracionado. Exigem provider novo e
  nova forma de resultado."* A razão (linhas 73-74) é "expandir por disponibilidade de DADOS, não
  por edge teórico"; ADR 0015 rejeita expressamente "escanteios/cartões primeiro".
- ADR 0025 abriu Tier 3 (odds + settlement) pra `correct_score`/artilheiro/assist — mas
  cartões/escanteios ficaram de fora porque têm **0 odds** nos providers (`bet=45` escanteios e
  `bet=80` cartões → 0 resultados). O settlement de cartão/escanteio via stats foi descrito como
  viável mas **deliberadamente NÃO virou issue** — nunca foi cabeado.

> **Conclusão estrutural:** o gate é por **tipo de mercado**, não por fonte de dados. Mesmo que
> a api-football já devolva os campos, **dar badge cruza o Tier 3 → exige ADR novo**. Viabilidade
> de provider NÃO contorna o portão.

## 3. PUNCHLINE provável (qualificada pela verificação)

> **A api-football — que JÁ pagamos (Pro/7500-dia) — provavelmente já cobre cartões via
> `/fixtures/events` + escanteios via `/fixtures/statistics`. O gargalo NÃO é um provider novo —
> é (a) cobertura de World Cup [UNVERIFIED], (b) retenção no normalizer, (c) regras de settlement
> novas, e (d) o ADR Tier 3 obrigatório.**

Qualificadores que a verificação impõe (não exagerar):

- **"Já cobre" é capacidade do ENDPOINT, não wiring atual.** `/fixtures/statistics` NÃO é chamado
  hoje; o normalizer descarta cartões. "Já devolve" ≠ "já está cabeado".
- **"Pro/7500-dia" é o plano REAL** (observado via `GET /status: plan='Pro', limit_day=7500`; ADRs
  0025/0026, `.env.example:46`). O custo incremental de vendor é ~zero — o `.env.example`/ADR 0005
  antigos diziam "free 100/dia" mas isso já foi corrigido como errata.
- **Cobertura de Copa é UNVERIFIED e é o crux.** Endpoint-parity ("todas as competições incluídas")
  ≠ data-coverage. Buraco de cobertura (ex.: WC injuries) retorna arrays vazios INDEPENDENTE do
  plano. **Validar ao vivo (§0) antes de prometer badge pra liga ativa.**
- **Odds de cartão/escanteio são gap SEPARADO.** The Odds API não cobre; api-football tem 0. Um
  **badge de resultado pode existir sem odds**, mas um palpite *value-aware* (direção dos ADRs
  0031/0032) precisaria de fonte de odds — fora do escopo deste discovery, mas dependência real.

## 4. Comparação de providers (cobertura cartões/escanteios + World Cup + custo + veredito)

> Pricing/quota: páginas oficiais da api-football retornam 403 ao fetcher (Cloudflare) → números
> via WebSearch da página de preços + corroboração de terceiro. **SportMonks e football-data.org
> foram fetchados ao vivo.** Re-confirmar tudo na hora da compra.

| Provider | Cartões (FT) | Escanteios (FT) | World Cup (liga ativa) | Custo / quota | Veredito |
|---|---|---|---|---|---|
| **api-football** *(ATUAL — sports-data, ADR 0025/0026)* | ✅ `/fixtures/events` (`type="Card"`, já no feed pago) **e/ou** `/fixtures/statistics` (`"Yellow Cards"`/`"Red Cards"`) | ✅ só `/fixtures/statistics` (`"Corner Kicks"`) — **endpoint NÃO chamado hoje** | ⚠️ **UNVERIFIED** — `statistics_fixtures`/`top_cards` reportados `true` p/ liga 1/2026 via search, MAS flag-true ≠ dado-presente; precedente injuries=false. **Validar ao vivo (§0)** | **Pro $19/mo = 7.500 req/dia** (plano REAL de prod); free 100/dia *(UNVERIFIED — search-sourced)*. +1 req por fixture liquidado (cheap; só logos isentam quota) | **MAIS VIÁVEL.** Zero vendor/chave novos. Custo = 1 fetch extra + normalizer + settlement + ADR |
| **SportMonks** *(integrado key-gated, absences FALLBACK, ADR 0026)* | ✅ API expõe `statistics` include (`yellowcards`=84, `redcards`=83, `yellowred-cards`=85) — **mas o adapter atual só puxa `sidelined` (injuries), zero stats** | ✅ `statistics` include (`corners`=34) — idem, **não cabeado** | ⚠️ **UNVERIFIED.** Marketing afirma WC 2026 (Season 26618 / League 732) com stats+events, MAS população real de cartão/escanteio no FT não confirmada com key viva. Free plan **NÃO cobre WC** (só Danish Superliga + Scottish Premiership). WC via **plano dedicado** (Advanced €69/mo / All-In €129/mo), provavelmente NÃO slot comum | Starter €29/mo (5 ligas, 2K/h/entidade) · Growth €99/mo (30) · Pro €249/mo (120) · Enterprise custom; trial 14d; rate-limit **por-entidade/hora, sem teto mensal** *(prices fetchados; type_ids fetchados; tier real do nosso uso UNVERIFIED)* | **Fallback documentável.** Vendor conhecido (onboarding baixo), MAS reusar = **BUILD de path de stats novo** (o adapter atual é absences-only); WC exige plano dedicado |
| **football-data.org** *(integrado, sports-data FALLBACK, ADR 0005)* | ✅ v4 Match: `bookings[]` (YELLOW\|RED) — atrás do **Deep Data ~€29/mo** | ✅ v4 Match: `corner_kicks` — atrás do **Statistic Add-On ~€15/mo** | ❌ **provavelmente NÃO.** Tabela de cobertura ao vivo mostra FIFA World Cup com coluna **Stats em branco** (free-tier-only). Validar, mas tende a "não disponível" | Add-On só "em cima de plano regular" → piso REAL ~**€44/mo** (base €29 + add-on €15), possível €64 se exigir Standard *(UNVERIFIED na página oficial)* | **Não viável p/ liga ativa.** Custo real > "barato"; WC sem stats; bookings/corners em add-ons separados |
| **Sportradar / Opta (Stats Perform)** | ✅ gold-standard oficial | ✅ gold-standard oficial | ✅ (cobertura oficial completa) | **Enterprise only, contact-sales, sem self-serve.** ADR 0026 já rejeitou Sportradar ("$5k+/mês" — número é estimativa do ADR/terceiros, **UNVERIFIED** oficialmente) | **TOO EXPENSIVE / não-self-serve.** Rejeitado de cara |
| **FotMob (não-oficial)** | ✅ rico (endpoints internos) | ✅ rico | ✅ | nominalmente free | **NON-VIÁVEL.** ToS proíbe scraping/extração automatizada (verbatim em `fotmob.com/tos.txt`) — mesmo motivo de 0026 rejeitar Sofascore/Transfermarkt. Entra como **alternativa rejeitada** no ADR |
| **Soccersapi** | ⚠️ stats anunciadas, **campos cartão/escanteio NÃO confirmados** nos docs | ⚠️ idem | ⚠️ não confirmado | Free (3 ligas, 100 req/h) · $39/$79/$149/$279/mo *(UNVERIFIED — search-sourced; página JS-render/403)* | **Estritamente PIOR.** Vendor NOVO (chave+adapter+checklist) com cobertura UNVERIFIED vs reusar api-football que já devolve os campos. Considerado, não recomendado |

**Leitura da tabela:** reusar api-football domina pra um side-project solo — mesmo vendor, mesma
chave, custo incremental ~zero. O risco NÃO é "achar um provider"; é **provar a cobertura de Copa
ao vivo** e fazer o trabalho de normalizer + settlement atrás do **ADR Tier 3 obrigatório**.

## 5. Anatomia da mudança (se o dono decidir avançar)

Mapeado sobre os seams reais (ADR 0016 settlement-registry + ADR 0015 per-market flag):

1. **Normalizer:** reter eventos não-gol (`adapter.ts:549`) e/ou cabear `/fixtures/statistics`
   (endpoint novo, mesmo vendor) → **novo DTO normalizado de stats** (escanteios/cartões FT).
2. **Settlement:** adicionar regra(s) pura(s) em `lib/settlement/rules/` + registrar no
   `PALPITE_SETTLEMENT_RULES` (`palpite-dispatch.ts`) + (se event-backed) adicionar a
   `EVENT_BACKED_PALPITE_TYPES`. Estender `PalpiteResultData` com contagens FT de escanteio/cartão
   (Zod-validado por ADR 0016).
3. **Gate de palpite:** adicionar o(s) tipo(s) a `SETTLEABLE_PALPITE_TYPES` (`settleable.ts`) — a
   fonte única que liga o cron.
4. **Gate de cobertura (go/no-go):** reusar `coveredLeagues` no descriptor de mercado
   (`market-catalog.ts`) + feature-flag por-mercado (ADR 0015 D1/D6) — o mercado fica **inerte até
   a cobertura ser provada ao vivo**. NÃO embarcar badge pra liga sem stats verificadas.
5. **Custo:** +1 fetch `/fixtures/statistics` por fixture finalizado (cheap no Pro/7500-dia).

**Consequências (+/−/±):**
- (+) reusa chave api-football + registry de settlement (0016) + flag per-market (0015) → infra
  mínima nova, sem vendor novo.
- (+) badge fecha o gap "fun-only" de cartão/escanteio.
- (−) cruza o gate Tier 3 → **ADR obrigatório antes de código**.
- (−) normalizer passa a reter não-gol (era goal-only por design) → DTO de stats novo + Zod + testes.
- (−) `result_data` cresce + regra de settlement nova + entrada no registry de palpite.
- (−/RISK) **cobertura WC UNVERIFIED** — badge fica gated até um fixture WC finalizado ser checado.
- (−) odds de cartão/escanteio são gap separado — badge de resultado existe sem odds, value-aware não.
- (±) manchete palpite-first (ADR 0030) mantém o firewall de EV/stake; cartão/escanteio vira
  manchete liquidável + detalhe, igual aos gol-derivados.

## 6. Esqueleto de ADR proposto (PROPOSTA pro grill — NÃO é decisão)

- **Número:** **0033** (próximo livre; mais alto no disco = `0032-provider-de-noticias-via-claude-web-search.md`).
- **Título:** **ADR 0033 — Mercados Tier 3 liquidáveis por evento (cartões/escanteios) via estatística de FT**
- **Status:** Proposed (decisão do dono via grill).
- **Seções (formato da casa, confirmado em 0029–0032 — Consequências ANTES de Alternativas; SEM
  "Razão"):** `Status` / `Contexto` / `Decisão` / `Consequências` / `Alternativas consideradas` / `Referências`

**Conteúdo de cada seção (rascunho):**

- **Contexto:** normalizer goal-only (`adapter.ts:549`) + DTOs goal-only (`types.ts`) deixam
  cartão/escanteio fun-only; #354/migration 0036 já liquidou 4 tipos gol-derivados pelo registry de
  palpite — Tier 3 por evento ESTENDE esse padrão; CLAUDE.md:105 + ADR 0015 D2 colocam
  escanteios/cartões em Tier 3 ("cada um = 1 ADR próprio"); ADR 0025 abriu odds+settlement Tier 3
  pra correct-score/artilheiro mas cartões/escanteios ficaram sem stats cabeada (0 odds).
- **Decisão (alavancas ABERTAS pro grill):**
  - **L1 (provider):** recomendar reusar **api-football** (`/fixtures/events` p/ cartões +
    `/fixtures/statistics` p/ escanteios, zero vendor novo) como PRIMARY; SportMonks /
    football-data.org como fallbacks documentados; rejeitar de cara Soccersapi (vendor novo),
    Sportradar/Opta (enterprise), FotMob (ToS).
  - **L2 (qual mercado primeiro):** total escanteios O/U vs total cartões/bookings O/U vs cartões
    por-time — escolher por **disponibilidade de dado** (ADR 0015), o de stat mais confiável.
  - **L3 (regras de settlement):** rule pura + `settlement_rule_key`/registry de palpite + entrada
    event-backed + `result_data` com contagens FT + retenção no normalizer + DTO de stats novo;
    **semântica de contagem de cartão** (events vs statistics; Yellow-Red) precisa ser decidida aqui.
  - **L4 (gate de cobertura WC):** go/no-go duro — NÃO embarcar badge sem stats da liga verificadas
    ao vivo; reusar flag per-market + `coveredLeagues` (inerte até prova).
- **Consequências:** (ver §5).
- **Alternativas consideradas:** SportMonks (vendor conhecido, mas adapter atual é absences-only +
  WC via plano dedicado); football-data.org (WC sem stats, custo real ~€44+); Sportradar/Opta
  (enterprise, rejeitado); FotMob (ToS, rejeitado); Soccersapi (vendor novo, cobertura UNVERIFIED).
- **Referências:** #350, #354, CLAUDE.md:105, ADR 0015/0016/0025/0026/0030, `adapter.ts:549`,
  `settleable.ts:15-21`, `palpite-dispatch.ts:33-35`, `active-leagues.ts:14`.

## 7. Decisão central + perguntas em aberto

**A decisão central do dono** (uma só): *com `ACTIVE_LEAGUES=["world_cup"]` e a cobertura de Copa
**não verificada**, vale a pena pagar o custo (ADR Tier 3 + retenção no normalizer + settlement
novo) pra dar badge a cartão/escanteio AGORA — ou isso espera os clubes voltarem (jul/ago), quando
Brasileirão/Champions têm cobertura confiável de stats?*

A pré-condição inegociável pra QUALQUER "sim": **verificar a cobertura WC ao vivo (§0) primeiro.**
Se a stat não vem populada pra Copa, o badge não tem valor ao vivo hoje — e a decisão vira "esperar
os clubes" por construção.

### Perguntas em aberto (pro grill)
- A cobertura de cartão/escanteio EXISTE, populada, num fixture WC finalizado? (validar §0 — go/no-go)
- Qual o PRIMEIRO mercado Tier 3 a embarcar — escanteios O/U, cartões/bookings O/U, ou cartões por-time?
- Fonte autoritativa de cartões: `/fixtures/events` (contar details) ou `/fixtures/statistics`
  (somar counts)? E como contar "Yellow-Red"?
- Badge SÓ de resultado (sem odds) basta pra agora, ou o dono quer o palpite value-aware (precisa
  resolver odds de cartão/escanteio — gap separado, sem fonte hoje)?
- Embarcar agora (esperando provar Copa) ou parquear pós-pivot até os clubes voltarem (jul/ago)?

### Incertezas-chave a validar ao vivo (UNVERIFIED)
- **Cobertura WC de cartão/escanteio na api-football** (`statistics_fixtures`/`top_cards`=true via
  search, mas flag ≠ dado; precedente injuries=false). **Crux.**
- **Plano/quota REAL da api-football** — confirmado Pro/7500-dia via `GET /status` nos ADRs, mas
  prices Pro $19/mo / free 100/dia são **search-sourced** (página 403 ao fetcher).
- **Casing do `type` de evento no feed WC ao vivo** (schema do projeto usa "Goal"/"Card"
  capitalizado; um wrapper terceiro usa minúsculo) — validar contra um fixture WC real.
- **População real de stats SportMonks na Copa** (marketing afirma; sem key viva pra provar; WC via
  plano dedicado €69+/mo, não slot comum) + mapeamento `type_id` cartão (84 vs 83, transposto entre
  fetches; fixar contra `/types` ao vivo).
- **football-data.org WC stats** — tabela de cobertura ao vivo mostra coluna Stats em branco pra WC;
  e custo real do add-on (~€44+, não €15).
- **Odds de cartão/escanteio** — gap não-resolvido em todos os providers; dependência de qualquer
  futuro value-aware.
