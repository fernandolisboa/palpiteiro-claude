# ADR 0015 — Pivot multi-mercado: modelo de domínio (markets/selections como tabelas de referência)

## Status

Accepted (2026-06-12) — **supersede o ADR 0003** (over/under 2.5 como único mercado do MVP)

## Contexto

O Palpiteiro foi construído mercado-único, e a premissa está cravada no **schema**, não só
na UI:

- `marketEnum` tem **um único valor** `"over_under_2_5"` (`db/schema.ts:32`) e é consumido em
  **duas** tabelas — `predictions.market` (`schema.ts:211`, default `"over_under_2_5"`) e
  `match_odds_snapshots.market` (`schema.ts:159`), que ainda carrega `line numeric(4,2)`
  default `"2.5"` à parte do enum.
- `lib/ai/predict.ts` hardcoda over/under em ~6 pontos: import estático do cartucho
  `./prompts/over_under_v1` **e** do `OverUnderOutputSchema` (`schemas/output`);
  `markets: ["totals"]` + `pickBestTotalsBookmaker` (que filtra `outcome.point !== 2.5` em
  `lib/odds/select-bookmaker.ts:29`); edge binário `confidence_pct − impliedPct`;
  `market: "over_under_2_5"` + `overOddAtPrediction`/`underOddAtPrediction` no insert.
- O settlement é gol-específico e binário (`lib/settlement/compute.ts:9`
  `OVER_UNDER_LINE = 2.5`; docstring "the 2.5 line never pushes"); o enum `outcome_result`
  é fechado em `won/lost/void` — **sem push**.
- A matemática de cenários assume 2 seleções (`lib/odds/scenario.ts:120` deriva o lado
  oposto por `100 − x`; `computeImpliedProbabilities(overOdd, underOdd)` é 2-arg).

A decisão de produto está tomada: o Palpiteiro deixa de ser um tipster de over/under 2.5 e
vira um **motor de seleção de edge multi-mercado**. Dada uma partida e um leque de mercados
candidatos, o LLM emite **uma recomendação por análise** (mercado + seleção + linha + stake)
ou `pass`, sempre com racional auditável e Yield **segmentado por mercado**. Over/under 2.5
vira **o primeiro mercado**, não **o** mercado — e o tracking de Yield histórico é
**preservado**.

Este ADR funda o **modelo de domínio** do pivot e **supersede o ADR 0003**. Os ADRs irmãos deste
mesmo lote da Fase 0 (issues #153–156) detalham cada eixo: settlement por mercado (0016, #153),
cartuchos de prompt (0017, #154), edge/EV/cenários de N vias (0018, #155 — emenda o ADR
0012-cenários) e staking 1–3u por confiança (0019, #156).

**Princípio transversal (vale pra todos os ADRs do pivot):** o pivot **não é aditivo**. Nada
de `if (market === X)` espalhado pelo código. É **expand-migrate-contract** com **registries
de adaptação por mercado** (cartucho de prompt, regra de settlement, seleções) — a camada de
adaptação vem **antes** de qualquer mercado novo. A ajuda atual (`/como-funciona` + o glossário
de 22 termos, fonte única em `components/help/glossary.ts`) é **reaproveitada** como a ajuda do
mercado over/under, não descartada.

## Decisão

1. **`markets` e `market_selections` como tabelas de referência (seed + FK), não enums (D3).**
   - `markets`: `key` (text único, ex. `over_under`, `match_result`, `btts`,
     `double_chance`), `label`, `settlement_rule_key` (text — ver ADR 0016), e flags de
     ativação/graduação (feature-flag por mercado — ver decisão 6). `market_selections`:
     FK pra `markets`, `key` (ex. `over`/`under`, `home`/`draw`/`away`, `yes`/`no`), `label`,
     `sort_order`. `predictions` passa a referenciar `market_id` (FK) + `selection_id` (FK,
     nullable em `pass`) + `market_params` jsonb (a forma do mercado, ex. `{ "line": 2.5 }`).
   - **Razão:** o enum `league` já precisou de `ALTER TYPE ADD VALUE` (mesma fricção que um
     enum de mercado teria a cada mercado novo); e o próprio schema **já adota** a convenção
     "text + validação na app, não enum" pra `defaultModelId`/`preferredModelId`
     (`schema.ts:63-68,254-260`, validados contra `MODEL_REGISTRY` na query layer pra evitar
     migration por modelo). Tabelas de referência + FK levam essa convenção ao limite:
     catálogo editável por seed/migration, integridade garantida por FK. **Custo aceito:**
     +1 JOIN no dashboard.
   - O enum `market` atual (consumido em `predictions` **e** `match_odds_snapshots`) é
     congelado e só **contraído** ao fim do expand-migrate-contract (decisão 5).

2. **Uma recomendação por análise (D1).** O LLM devolve **um** par mercado+seleção (ou `pass`)
   por chamada. Preserva `pass` como sinal de calibração de 1ª classe e mantém custo/jogo
   previsível (cada análise gera **uma** predição persistida — ADR 0010). O modo "melhor aposta do jogo"
   (avaliar N mercados e escolher o de maior edge) vem **depois** como **fan-out em código**
   (#178), nunca como um prompt único multi-mercado — preserva a comparabilidade de calibração
   por mercado e o gate de eval por análise (#105).

3. **Mercados do MVP e tiers de viabilidade (D2).** O eixo de expansão é **disponibilidade de
   dados**, não edge teórico (o input do modelo é rico pra gols/resultado, pobre pra
   eventos como escanteios/cartões; e odds/resultado são o gargalo real).
   - **Tier 1 (MVP):** 1X2 (`h2h`) + over/under multi-linha (1.5 / 2.5 / 3.5). Settlam com o
     placar de 90' (`regulationScore`, já obtido pelo provider) e têm odd **featured** na
     região `eu` (entregue via `/odds`).
   - **Tier 2 (na sequência):** BTTS + Dupla chance. Settlam com o placar, mas a odd é
     **"additional"** (só via `/events/{id}/odds`, 1 request por jogo). Cobertura `eu`
     **validada empiricamente em 2026-06-12** (#158): `btts` e `double_chance` retornaram
     odds de Pinnacle/William Hill/1xBet/Matchbook/Codere em jogos da Copa 2026 — o medo
     "additional = só casas US" foi **refutado**. **Ressalvas registradas:** (a) casas
     BR-facing (Betano/bet365/Betfair) **não** apareceram nos additional — aceitável, o edge é
     calculável e o apostador compara a linha na casa dele; (b) a re-checagem do **Brasileirão**
     está **pendente** (0 eventos na API durante a pausa pela Copa do Mundo — re-rodar os mesmos
     2 requests quando o campeonato voltar, #158). **Se a re-checagem do Brasileirão for
     negativa, BTTS/Dupla chance ficam restritos às ligas com cobertura comprovada** — a flag de
     ativação por mercado (decisão 1/6) é o ponto de controle.
   - **Ativação do BTTS (#174, 2026-06-14):** BTTS entrou ATIVO atrás de flag (admin-only),
     **restrito a `world_cup`** via `MarketDescriptor.coveredLeagues = ['world_cup']` (filtrado por
     `marketsForLeague`, aplicado na page E na action `analyzeMatch` — a fronteira de segurança).
     A re-checagem do Brasileirão **segue pendente**: `getSports()` (0 créditos) em 2026-06-14
     confirmou `soccer_brazil_campeonato` **AUSENTE** de `/sports` (e `soccer_uefa_champs_league`
     também) durante a Copa — só `soccer_fifa_world_cup` está `active=true`. Adicionar o Brasileirão
     (ou Champions) à cobertura quando voltarem = **1 linha** em `coveredLeagues` no descriptor, sem
     migration. A odd do BTTS é buscada **lazy por evento** (`getEventsForSport` grátis → `getOddsForEvent`
     `markets=['btts']`, 1 crédito), **nunca em batch** (`oddsSource: 'additional'`).
   - **Ativação da Dupla chance (#176, 2026-06-14):** dupla chance (1X/X2/12) entrou ATIVA atrás de
     flag (admin-only), **restrita a `world_cup`** (`coveredLeagues = ['world_cup']`, mesma fronteira
     do BTTS — page + action), pelo caminho 100% genérico (cartucho `double_chance_v1` + descriptor +
     settlement + seed + odds *additional* por evento). A odd é *additional* (`getOddsForEvent`
     `markets=['double_chance']`, 1 crédito, **nunca batch**); os outcomes do provider vêm com nomes
     de time COMPOSTOS (`'{home} or Draw'`/`'{away} or Draw'`/`'{teamA} or {teamB}'`, validados em
     payload real), mapeados por `resolveSelectionKey`. Mesma pendência do Brasileirão (#158).
     **Edge não-partição:** as 3 duplas se sobrepõem (Σ prob real ≈ 200%) → de-vig com
     `impliedSumTarget = 2` (emenda ao ADR 0018), não a normalização Σ=1 de partição.
   - **Tier 3 (cada um = 1 ADR próprio):** correct score, escanteios, cartões, player props,
     handicap asiático fracionado (0.25/0.75). Exigem **provider novo** e **nova forma de
     resultado** — hoje só **persistimos** o placar 90' agregado (`prediction_outcomes.total_goals`);
     o provider já entrega `regulationScore.{home,away}`, mas não gravamos o placar por lado nem
     eventos (escanteios/cartões). Ficam **fora** deste ADR.

4. **Híbrido colunas tipadas / JSONB (D4).** Colunas **tipadas** pra tudo que é agregável e
   consultável: `selection_id`, `odd_at_recommendation`, `implied_prob_pct`, `edge_pct`,
   `confidence_pct`, `stake_units`, `result`, `profit_units`. JSONB **só** pra: `market_params`
   (forma do mercado, ex. `{ "line": 2.5 }`) e `result_data` (fatos do jogo coletados 1x por
   jogo — MVP: o placar 90'; contrato genérico detalhado no ADR 0016). **Nunca** profit/result/
   edge/stake em JSONB.
   - **Razão:** Yield, win rate e edge são somados/filtrados/ordenados (`lib/dashboard/kpis.ts`
     soma `profit_units`/`stake_units`; o dashboard filtra e dedup por jogo) — pôr isso em JSONB
     mata índice e tipagem. Já convivemos com o gotcha "Drizzle numeric volta string" (exige
     `Number()` no boundary antes de qualquer conta); JSONB só pioraria. Toda forma em JSONB é
     **validada por Zod no boundary** (como já fazemos com a saída do LLM).

5. **Expand-migrate-contract com backfill determinístico (D6).** Sem big-bang.
   - **Expand:** criar `markets`/`market_selections` + colunas novas em `predictions`
     (`market_id`, `selection_id`, `market_params`) **nullable**; seed do `over_under` e das
     seleções `over`/`under`.
   - **Migrate (backfill em código, sem LLM):** toda predição histórica recebe `market_id` do
     `over_under`; `selection_id` derivado de `recommendation` (`over`→seleção `over`,
     `under`→`under`, `pass`→`null`); `market_params = { "line": 2.5 }`; `result_data` derivado
     de `prediction_outcomes.total_goals`.
   - **Contract:** tornar as colunas notNull e contrair o enum `market` **só** quando o caminho
     genérico estiver provado em paridade (Fase 2).
   - **Yield histórico preservado:** `profit_units`/`stake_units`/`result` são **imutáveis** e
     **não** são tocados pelo backfill. Predições passadas nunca são mutadas (regra do repo); o
     dashboard mostra exatamente os mesmos números antes/depois do backfill.

6. **Go/no-go por mercado (D9).** Um mercado só **gradua do feature-flag** (flag em `markets`)
   com **≥ 30 apostas resolvidas naquele mercado** **e** **Yield positivo naquele mercado**.
   Evita que um mercado imaturo polua o sinal do over/under maduro. O dashboard passa a
   **segmentar KPIs por mercado** (#171) — o `keepLatestPerMatch` já antecipa estender a chave
   de dedup pra `(matchId, market)` (`kpis.ts:100-104`).

7. **Princípio não-aditivo: registries de adaptação por mercado.** A variação por mercado mora
   em **registries** resolvidos por lookup a partir de `markets.key`/`settlement_rule_key` —
   cartucho de prompt (ADR 0017), regra de settlement (ADR 0016), seleções (`market_selections`).
   **Nada de `if (market === X)` fora dos registries.** O seam já é meio-limpo:
   `lib/ai/request-builder.ts` e a camada de `generation-params`/`models` são **market-agnostic**;
   o acoplamento se concentra em `lib/ai/predict.ts` + 3 módulos-cartucho
   (`prompts/over_under_v1`, `schemas/output`+`schemas/input`, `odds/select-bookmaker`).

8. **ADR 0003 marcado Superseded por este.** As premissas binárias que o 0003 sustentava
   ("lado oposto = 100 − x", "linha 2.5 nunca dá push") são emendadas no **ADR 0018**; a decisão
   de break-even/EV na **odd crua** (ADR 0012-cenários, decisão 6) **sobrevive** intacta.

## Razão

- **O acoplamento mercado-único é de schema, não de feature.** Como o enum `market` e as colunas
  binárias (`over_odd_at_prediction`/`under_odd_at_prediction`) estão no banco, generalizar exige
  modelo de domínio antes de qualquer prompt novo — daí este ADR ser a espinha.
- **Reference tables vencem enums** pela mesma razão que o repo já escolheu `text` validado pra
  ids de modelo: evitam `ALTER TYPE` a cada item e tornam o catálogo editável.
- **Híbrido (coluna pro agregável, JSONB pra forma)** mantém o Yield rápido e tipado e ainda
  acomoda a forma variável dos mercados — sem cair no schemaless que corromperia a agregação.
- **Expand-migrate-contract** é a única forma de pivotar schema+settlement+odds+prompt+UI juntos
  sem virar big-bang; o backfill é determinístico (zero token, zero risco de regressão de prompt).
- **Graduação por mercado** protege o sinal: misturar mercado novo (imaturo) com over/under maduro
  num Yield agregado corromperia o go/no-go.

## Alternativas consideradas

- **Enums pra `market`/`selection`:** rejeitado — `ALTER TYPE ADD VALUE` friccional a cada
  mercado/seleção; catálogo cresce; a convenção do repo já prefere `text` + validação pra ids de
  modelo. Tabelas de referência são a evolução natural dessa convenção.
- **Refactor aditivo (`if (market === X)`):** rejeitado — espalha a variação por settlement, odds,
  prompt e UI; vira dívida e big-bang. Registries isolam a variação num ponto por eixo.
- **Tudo em JSONB (schemaless):** rejeitado — mata índice/tipo da agregação do Yield; D4 separa
  o **agregável** (coluna tipada) da **forma** (jsonb validado por Zod).
- **Big-bang — recriar schema/settlement/odds/prompt de uma vez (vs D6):** rejeitado — janela de
  inconsistência e risco de regressão do Yield; o expand-migrate-contract com backfill
  determinístico (zero token) preserva o Yield histórico imutável.
- **Ativar mercado novo sem gate, num Yield agregado único (vs D9):** rejeitado — mistura mercado
  imaturo com o over/under maduro e corrompe o go/no-go; a graduação exige ≥30 resolvidas + Yield
  positivo **naquele** mercado.
- **N recomendações por análise (multi-bet no prompt):** rejeitado pro MVP — multiplica custo/jogo
  e embaralha a calibração por mercado; o "melhor aposta do jogo" vira **fan-out em código** (#178).
- **Expandir por edge teórico (escanteios/cartões primeiro):** rejeitado — o input do modelo é
  pobre pra eventos e odds/resultado desses mercados são o gargalo; expandir por **disponibilidade
  de dados** (Tiers 1→2→3).

## Consequências

- (+) Domínio **mercado-agnóstico por design**: over/under 2.5 vira o **primeiro registro** do
  registry, não um caso especial.
- (+) Yield histórico **preservado**; backfill determinístico, sem custo de token.
- (+) Catálogo de mercados/seleções **editável sem migration de enum**.
- (−) **+1 JOIN** no dashboard (`markets`/`market_selections`) — aceito.
- (−) **Refactor em cascata** (schema/settlement/odds/prompt/UI) — mitigado por
  expand-migrate-contract + registries; cada eixo tem seu ADR irmão.
- (−) `market_params`/`result_data` em JSONB saem do alcance do type-checker do Postgres —
  mitigado por validação **Zod no boundary** (mesmo padrão da saída do LLM).
- (±) Durante a migração, o enum `market` (em `predictions` **e** `match_odds_snapshots`) coexiste
  com `market_id` até a fase de **contract**.

## Referências

- Épico **#183**; issues **#152** (este ADR), **#153–156** (ADRs 0016–0019), **#157** (docs),
  **#158** (validação de cobertura de odds).
- **Supersede o ADR 0003** (over/under como único mercado). Detalhado pelos ADRs irmãos da Fase 0
  **0016** (settlement/push, #153), **0017** (cartuchos de prompt, #154), **0018** (cenários
  N-vias — emenda o ADR 0012-cenários, #155), **0019** (staking 1–3u, #156).
- **Preserva:** ADR 0012-cenários decisão 6 (EV/break-even na odd crua), ADRs 0013/0021 (cascata e
  estratégia de modelo), ADR 0008 (generation-params).
- Código: `db/schema.ts` (`marketEnum:32`, `predictions:198+`, `match_odds_snapshots:159`,
  `prediction_outcomes:241`), `lib/ai/predict.ts`, `lib/settlement/compute.ts`,
  `lib/odds/scenario.ts`, `lib/dashboard/kpis.ts`.
- Validação de odds: **#158** (Copa ✅ 2026-06-12; Brasileirão pendente, re-checar na volta do
  campeonato).
