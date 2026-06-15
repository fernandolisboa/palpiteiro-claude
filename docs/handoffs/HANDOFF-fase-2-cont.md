# HANDOFF — Pivot multi-mercado · FASE 2 (continuação: #166–#168)

> **Status:** Fase 2 **3/6 fechada** — **#163, #164, #165 MERGEADOS** em `origin/main`
> (squashes `42db949c`, `0fcfbefa`, `2f0faa7b`). Falta **#166 → #167 → #168**.
> Mapa do pivot inteiro + decisões D1–D10: `HANDOFF-fase-1.md` + `HANDOFF-fase-0.md` + épico **#183**.
> Convenção de handoff/kickoff: CLAUDE.md ("Handoffs entre sessões").
> **Critério de saída da Fase 2 (inalterado):** over/under roda 100% pelo caminho genérico com paridade
> comprovada; **zero `if (market === ...)` fora dos registries**. Quando fechar (#168), escrever
> `HANDOFF-fase-3.md` (UI multi-outcome + dashboard segmentado, #169–172) + kickoff.

## O que a Fase 2 já entregou (em `origin/main`)
- **#163** (PR #218, `42db949c`): odds math N-vias. `computeMarketImpliedProbabilities(odds[]) →
  {probs, overround:FRAÇÃO}` (canônico) + `computeImpliedProbabilities(over,under)` (wrapper binário
  bit-exato). `computeSelectionEdgePp`, `computeMarketScenarios` em `lib/odds/scenario.ts`. `MIN_EDGE_PP`
  fica em scenario.ts. Paridade N=2 bit-a-bit; N=3 (1X2) coberto.
- **#164** (PR #219, `0fcfbefa`): ingestão genérica. `lib/odds/market-descriptor.ts` (`MarketDescriptor`,
  `OVER_UNDER` ativo, `MATCH_RESULT` dev/test) — separa 3 vocabulários (providerKey `totals`/`h2h` /
  dbKey `over_under`/`match_result` / selectionKey). `pickBestBookmaker` + wrapper `pickBestTotalsBookmaker`
  bit-exato. Queries genéricas em `lib/db/queries/odds-snapshots.ts` (`getLatestSelectionOddsSnapshots`,
  `getLatestFreshSelectionOddsSnapshots`, `insertSelectionOddsSnapshotsBatch`) lendo/gravando
  `selection_odds_snapshots`. **dual-write atômico via `db.batch`** (neon-http; `captured_at` write-time
  compartilhado). Read coerente (DISTINCT-ON + predicado jsonb de line + guarda de coerência/completude).
  Testes real-DB via **pglite** (1X2 ponta-a-ponta). Quota inalterada (produção só busca totals).
- **#165** (PR #220): registry de cartucho. `lib/ai/markets/{types,registry}.ts` (`MarketCartridge`,
  `getCartridge`); `lib/ai/markets/over_under/` (prompt, schemas, build-input, user-message, index montando
  `overUnderCartridge`). `predict({ marketKey="over_under" })` despacha por cartucho; bump
  `over_under_v2.0` (payload **byte-idêntico** ao v1.3). predict preenche `market_id`/`selection_id`/
  `market_params` + `prediction_selection_odds` (candidate set, **inclusive pass**). Colunas legadas
  byte-idênticas. Resolver de catálogo consolidado: **`lib/db/queries/market-catalog.ts`**
  (`resolveMarketCatalog(dbMarketKey) → {marketId, idByKey, keyById}`), consumido por predict +
  odds-snapshots.ts + fetch-and-snapshot.ts. Persistência **SEQUENCIAL** (ai_call→prediction→PSO; NÃO
  db.batch — PSO.predictionId precisa do id server-gen). Deletados: `lib/ai/prompts/over_under_v1.ts`,
  `lib/ai/schemas/{input,output}.ts`, `lib/ai/build-input.ts`.

## Decisões cravadas na Fase 2 (NÃO re-litigar)
- **Registries são a fronteira**: cartucho (`lib/ai/markets/`), descriptor de odds
  (`lib/odds/market-descriptor.ts`), catálogo (`lib/db/queries/market-catalog.ts`). #166 adiciona o
  registry de **settlement** (regra pura por `settlement_rule_key`) no mesmo espírito.
- **neon-http NÃO tem `db.transaction`** (LANÇA); `db.batch([builders não-awaited])` é o atômico, MAS só
  pra statements INDEPENDENTES (não consome `.returning()` id). Quando há FK parent→child com id
  server-gen → SEQUENCIAL + log/degrade (re-preenchível por backfill idempotente). Precedente: invites.ts:65-71.
- **Odds READ do over/under no predict fica na tabela VELHA** (`getLatestFreshOddsSnapshot`) por paridade
  (o read genérico muda bytes de `captured_at` + tem nova classe de erro). Migra quando existir cartucho
  não-over/under. O candidate set deriva do bundle over/under.
- **expand-migrate-contract continua**: legado (enum `market="over_under_2_5"`, par
  over/under_odd_at_prediction, match_odds_snapshots, total_goals) PERMANECE até o contract (Fase 5).

## As issues restantes (#166 → #167 → #168) — ordem e dependências
> Aterre cada citação no CÓDIGO real (não no doc). Use o **two-round plan-gate** (plan-review → rework →
> lean re-verify) ANTES de codar — pegou 7 blockers no #164, 2 no #165. Subagent de contexto fresco por
> passo; worktree isolado **off `origin/main`** (a checkout compartilhada é stale, em outra branch).

- **#166 — Settlement plugável (registry + push). O MAIS ARRISCADO restante.** ADR 0016. Hoje:
  `lib/settlement/compute.ts` assume "linha 2.5 nunca dá push" (`OVER_UNDER_LINE=2.5`), `SettlementInput`
  só tem `totalGoals`, `OutcomeResult` é **narrow won/lost/void de propósito** (Fase 1 deixou assim — #166
  é quem WIDENA p/ incluir `push`). `lib/settlement/settle.ts` busca resultado 1x/match, `insertOutcomeIfAbsent`
  (idempotente via UNIQUE), `SETTLEMENT_MIN_ELAPSED_MS=150min`. `getPendingSettlementPredictions`
  (`lib/db/queries/predictions.ts`) **NÃO seleciona a coluna market** — precisa passar a carregar `market*`.
  Escopo: registry de regra PURA por `markets.settlement_rule_key` (`(selection, market_params, result_data)
  → {result, profit_units}`); regra `over_under` extraída do compute (`OVER_UNDER_LINE`→`market_params.line`);
  `settle.ts` coleta `result_data` padronizado 1x/jogo e persiste em `prediction_outcomes.result_data`
  (Fase 1 deixou nullable; shape `{homeScore,awayScore,totalGoals}` camelCase, Zod no boundary); suporte a
  push (profit 0, não conta won/lost; `kpis.ts` JÁ exclui push estruturalmente); `profitForResult`
  generalizado (usado pelo override). Idempotência + override preservados. Tabela de cenários da ADR 0016 =
  suíte de testes (won/lost/void/push por mercado). Depende de #153 (ADR 0016) + #162.
- **#167 — Staking 1–3u por confiança em código.** ADR 0019. Hoje stake flat default `"1"`
  (`predictions.stake_units` numeric). `kpis.ts` JÁ é stake-aware (soma profit / soma stake). Escopo:
  função PURA em `lib/` (bandas confiança/edge→1|2|3u, ADR 0019) com testes de fronteira; aplicada em
  `predict()` na recomendação (congela em `stake_units`; pass sem stake); UI exibe o stake (integra com
  Fase 3); validar KPIs com stakes mistos (1u histórico + 1-3u novos) + reportar nº de apostas por banda.
  Histórico imutável (sem backfill). Depende de #156 (ADR 0019) + **#165 (✓ feito)**. **#165 deixou
  `stake_units` no default "1"** — #167 é quem popula.
- **#168 — Override/admin condicional ao mercado.** `app/actions/settlement.ts` exige `homeScore`/`awayScore`
  do 90' obrigatórios, deriva `totalGoals`, `VALID_RESULTS` fechado won/lost/void;
  `app/admin/predictions/[id]/override-form.tsx` inputs fixos de gols + select won/lost/void. Escopo: action
  aceita `result_data` conforme o contrato do mercado (ADR 0016) + Zod por mercado; form renderiza
  condicionado ao mercado da predição; `push` entra em `VALID_RESULTS`/`RESULT_LABEL` (depois do #166);
  regra preservada: predição sem odd de entrada só pode ser anulada (void). **Aqui se REGISTRA o critério
  de saída da Fase 2.** Depende de #166.

## Landmines (Fase 2)
- (a) `lib/ai/predict.ts` continua a ÚNICA porta pro LLM (logging em `ai_calls` no sucesso + cada classe de
  erro; Zod sempre). Nenhum teste/CI chama o Anthropic PAGO (replay-prompt-eval é manual; tem guarda CI throw).
- (b) Toda forma JSONB (`market_params`, `result_data`) validada por Zod no boundary.
- (c) `push` no enum desde Fase 1, mas `OutcomeResult` (compute.ts) narrow de propósito — **#166** widena +
  faz o registry emitir push. `kpis.ts` já exclui push do yield/winRate.
- (d) eval gate por análise (#105) ao mexer em prompt/cartucho — passo PAGO, manual do usuário.
- (e) custo de token: cada chamada LLM custa.

## Ground truth verificado (bater com o CÓDIGO em `origin/main`)
- **Migration head = `0012`** (nenhuma nova na Fase 2 até aqui — o enum `push` já existe da 0011). #166
  pode precisar de 0013 SE precisar de schema (provavelmente não — `result_data` já existe nullable; o
  widening de `OutcomeResult` é TS, não DB).
- **Dashboard** (`getUserDashboardRows`) ainda lê o enum `market` — segmentação por `market_id` é #171 (Fase 3).
- **Acoplamento mercado-único restante** (o que #166–168 generalizam): `lib/settlement/{compute,settle}.ts`,
  `lib/db/queries/predictions.ts` (getPendingSettlementPredictions), `app/actions/settlement.ts`,
  `app/admin/predictions/[id]/override-form.tsx`. Tudo de odds/predict/ingestão JÁ é genérico (#163–165).

## Gotchas de ambiente (COMPROVADOS Fases 0–2)
- **Vercel gate agora é RÁPIDO (~20–80s) e passa** — #216 (ignora `.claude/` em eslint+vitest) e #217
  (deleta preview branch no PR close) mitigaram o limite de Neon branch. O gate = linha `Vercel`
  (`awk -F'\t' '$1=="Vercel"{print $2}'`); `UNSTABLE`/pending é não-bloqueante até resolver.
- **Worktree isolado off `origin/main`** (`git worktree add -b <branch> <path> origin/main`) — a checkout
  COMPARTILHADA (`/home/ferna/projects/palpiteiro-claude`) fica em outra branch (sessão concorrente);
  NUNCA codar nela. Merge via `gh pr merge --squash --delete-branch`; verificar `origin/main` HEAD +
  issue CLOSED (o ancestor-check no SHA original FALHA por design no squash — confira o HEAD/título).
  Limpar o worktree depois (`git worktree remove --force`).
- **Toolchain:** `bash -lc '. "$HOME/.nvm/nvm.sh"; nvm use 24; cd <worktree>; corepack pnpm
  --config.verify-deps-before-run=false <install|run typecheck|run lint|run test>'`. `pnpm install` no
  worktree primeiro; NÃO commitar `pnpm-workspace.yaml`.
- **pglite** (real-DB tests): `// @vitest-environment node` docblock + `.batch` shim; roda migrations reais
  + seed no schema de teste. Ver `lib/db/queries/__tests__/selection-odds-snapshots.pglite.test.ts`.
- **`db:generate` offline; `db:migrate`/backfill `--apply` = PROD** (`.env.local`). Validação de migration
  = Vercel preview. PRETTIER não roda em CI → NÃO `prettier --write` em `.ts`. `gh` sempre com
  `-R fernandolisboa/palpiteiro-claude`. Paths com `[id]` precisam de aspas. Squash-merge; `Closes #N`.
  Co-author: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Fluxo (CLAUDE.md)
Two-round plan-gate adversarial (plan-review multi-lente → rework → lean re-verify) ANTES de codar →
implementação em worktree isolado → code-review multi-lente (postado como PR comment via `gh pr comment`) →
fix das ressalvas value-adding → merge quando verde (Vercel=pass). 1 PR por issue, off `origin/main`.
Os artefatos `PLAN-16N.md` na raiz da checkout compartilhada documentam os planos finais de #163–165.
