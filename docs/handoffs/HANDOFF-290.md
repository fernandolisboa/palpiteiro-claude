# HANDOFF-290 — correct score + artilheiro/assistência end-to-end (ADR 0025)

> Snapshot de um ponto no tempo (não spec viva — ver README de `docs/handoffs/`).
> **#290 é a ÚLTIMA issue do arco api-football de odds** (#288→#289→#290). Concluída
> em uma sessão, duas PRs. Este handoff registra o estado final + os landmines que só
> aparecem quando a liga 71 (Brasileirão) voltar.

## O que shippou

Ligou os DOIS mercados que só a api-football precifica pro Brasileirão, **admin-only**
(`is_active=true`, `is_graduated=false`), graduando depois por **D9 viva** (sem backtest):

- **PR1 (#304, MERGED)** — **correct score**: slice limpo e aditivo. Migration `0030`
  (16 células `cs_0_0..cs_3_3`), `CORRECT_SCORE` em `ALL_DESCRIPTORS`, cartucho
  `correct_score_v1` (mirror de `match_result`, OPTION-B sobre a grid), settlement sobre
  o placar de 90' já coletado (off-grid 4-0 → lost; split null → pending), presentation +
  flips de teste pinados. Zero mudança em adapter/UI/tracking.
- **PR2 (scorer/assist)** — **artilheiro (bet_92) + assistência (bet_212)** como mercados
  `independent_binary`. Migration `0031` (linhas `markets` só, SEM `market_selections` —
  crescem lazy). `bet_93` (first scorer) **diferido** (vencedor único, não binário
  independente; ratificado na emenda). Emenda à ADR 0025 anexada.

## Arquitetura da perna scorer (independent_binary) — o que ler primeiro

1. **Emenda ADR 0025** (`docs/decisions/0025-...md`, seção "## Emenda (2026-06-17)") — a
   metodologia de edge. Núcleo: cada jogador é um binário independente cotado só no `yes`;
   implícita = **teto** `(1/odd)*100` (margin-inclusivo, NUNCA prob de-vigada, NUNCA
   sintetiza a odd `no`); edge = `modelProb − teto` é um **PISO** (conservador); piso de
   `minEdgePp=8` no PROMPT (não no `computeStakeUnits`, que é byte-idêntico). Edge scorer
   **NÃO** é comparável a edge partition — Yield segmentado por mercado.
2. **`docs/plans/PLAN-290.md`** — o plano + a seção "Correções do plan-review (PRECEDÊNCIA)"
   (3 BLOCKERs + 8 MAJORs achados ANTES de codar) + a sequência de commits revisada.
3. **`lib/odds/market-descriptor.ts`** — discriminante `marketKind ?? "partition"`,
   `dynamicSelections`, `minEdgePp`. `ANYTIME_SCORER`/`ASSIST` em `ALL_DESCRIPTORS`.
4. **`lib/odds/collect-independent-binaries.ts`** (`deriveIndependentImplied`) — book único,
   N jogadores yes-only, sem complete-market gate, sem overround. NUNCA chama
   `computeMarketImpliedProbabilities` (invariante testado).
5. **`lib/ai/predict.ts`** — fork `isIndependentBinary` (off descriptor, não marketKey):
   binding condicional de `selectionKeys` (:~960), bypass do seed-completeness guard,
   `ensureScorerSelections` pré-paid, PSO sobre o set dinâmico.
6. **`lib/settlement/{rules/scorer.ts,settle.ts}`** — spine skip-over-wrong-settle via
   `eventsAvailable`; `/fixtures/events` regulation-90, own goals não creditam.

## Paridade #288 (inegociável, mantida)

`lib/odds/implied-probability.ts`, `lib/odds/select-bookmaker.ts`, `lib/ai/staking.ts` e
`lib/providers/odds/the-odds-api/` têm **ZERO diff**. Tier 1/2 + correct_score são
partition (`marketKind` ausente) → nunca entram no fork scorer. Verificado por `git diff`.

## Landmines (aparecem só quando a liga 71 voltar — liga pausada pelo Mundial de Clubes)

- **Fio `bet_92`/`bet_212` NÃO verificado ao vivo** (ADR risk-accepted, sem teste-gate). O
  shape do `value` (traz `playerId` numérico ou só nome?) é desconhecido. Hoje o matching de
  settlement é por **nome canônico slugado** (sem playerId estável). **Inspecionar o 1º
  payload real** antes de confiar; mismatch confiante-errado mis-settla. Tratar como BUG
  quando surfaçar.
- **Shape de `/fixtures/events` NÃO verificado** (own goal / penalty / ET / shootout). O
  normalizer (`lib/providers/sports-data/api-football/adapter.ts`, `toNormalizedFixtureEvents`)
  filtra regulation-90 + exclui own goals — validar contra payload real.
- **Gap PARCIAL de feed = risco residual conhecido.** A guarda em `mergeFixtureEvents`
  (settle.ts) só pega o feed **vazio** (placar com gols + lista de regulação vazia →
  PENDING). Um feed com MENOS gols que o placar (gap parcial) ainda pode mis-settlar um
  scorer ausente como LOST — aceito até o fio ser verificado (não dá pra distinguir gap de
  discrepância benigna no fio não-verificado sem over-pending). Override manual
  (`app/actions/settlement.ts`) é a saída interina.
- **`minEdgePp=8` é chute sem backtest** (D9-live-only). Alto demais → scorer quase nunca
  dispara non-pass → D9 data-starved; ajustar pela observação viva.
- **`ensureScorerSelections`** cresce `market_selections` 1 linha por canonical player; drift
  de nome (acentos) sem `playerId` estável pode dividir o histórico — mitigado só se o fio
  trouxer id.
- **Migration renumber**: 0030 (PR1) + 0031 (PR2) geradas via `db:generate` em sequência.
  Se PRs concorrentes pegarem o número, ver [[concurrent-storm-migration-renumber]].

## Critério de saída (atingido)

typecheck + lint + test (`--no-file-parallelism`, 153 files / 1415 tests) verdes; rede #288
byte-parity intacta; ambos os mercados selecionáveis por admin pro Brasileirão; settlement
prefer-skip comprovado por teste nos casos won/lost/unavailable-pending/empty-feed-pending +
own-goal/ET excluídos. PR2 fecha #290.

## Próximo trabalho (NÃO é #290 — arco api-football encerrado)

Ordem fixa do dono ([[work-order-post-pivot]]): **resto pós-pivot (#203, arcos #225–#231) →
#246 (polish visual, por ÚLTIMO, com /impeccable + Claude Design)**. A cauda aberta do pivot
(#182/#180/#181) e a graduação D9 viva dos mercados Tier 3 seguem como observação contínua,
não como tarefa de board.
