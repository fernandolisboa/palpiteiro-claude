# HANDOFF — Pivot multi-mercado · FASE 2 (math + plumbing plugável)

> **Status:** Fase 1 FECHADA no schema (PRs #211–214 mergeados; issues #159–162 closed; migrations
> 0009–0012 + backfill script em `main`). **Falta só o passo operacional de paridade** (`--apply`
> + diff before/after) — ver "Pendência operacional" abaixo. Fase 2 ainda **não começou**.
> **Pré-requisito:** Fase 1 fechada. Mapa do pivot inteiro + decisões D1–D10: `HANDOFF-fase-1.md`
> + `HANDOFF-fase-0.md` + épico **#183**.
> **Escopo da Fase 2:** fazer o over/under rodar **100% pelo caminho GENÉRICO** (registries), com
> **paridade comprovada** — math de N vias, seletor de bookmaker genérico, cartucho de mercado +
> `predict()` por `marketKey`, settlement plugável (registry + push), staking 1–3u em código, override
> condicional ao mercado. **Zero `if (market === X)` fora dos registries.** Over/under continua o
> ÚNICO mercado ativo; mercados novos (1X2/BTTS/…) são Fase 4.

---

## O que a Fase 1 entregou (em `main`)

- **migration 0009** (#159/#211): `markets` (`key` unique, `label`, `settlement_rule_key`, `is_active`,
  `is_graduated`, `created_at`) + `market_selections` (`market_id` FK cascade, `key`, `label`,
  `sort_order`; `UNIQUE(market_id,key)`). **Seed idempotente embutido na migration** (não no
  `db/seed.ts` dev-only): `over_under` (active+graduated) + seleções `over`(0)/`under`(1).
- **migration 0010** (#160/#212): `predictions` ganhou (nullable) `market_id` FK→markets (restrict),
  `selection_id` FK→market_selections (restrict; NULL em pass), `market_params` jsonb
  (`.$type<{line:number}>`); + índices `market_id`/`selection_id`. Nova tabela
  `prediction_selection_odds` (`prediction_id` cascade, `selection_id` restrict, `odd`;
  `UNIQUE(prediction_id,selection_id)`).
- **migrations 0011+0012** (#161/#213): `0011` ISOLADA = `ALTER TYPE outcome_result ADD VALUE 'push'`
  (espelha o precedente `0002`; seguro por PG12+/Neon-PG15). `0012` = tabela `selection_odds_snapshots`
  (`UNIQUE(match_id,market_id,selection_id,captured_at,bookmaker)` — dedup + índice de leitura) +
  `prediction_outcomes.result_data` jsonb (`.$type<{homeScore,awayScore,totalGoals}>`, nullable).
- **backfill** (#162/#214): `db/scripts/backfill-mappings.ts` (puro, 11 testes) +
  `backfill-multimarket.ts` (dry-run default / `--apply`, idempotente, hard-fail) +
  `dashboard-kpis-snapshot.ts` (prova de paridade read-only).

## Decisões cravadas na Fase 1 (NÃO re-litigar na Fase 2)

- **Registry key COMMITTED:** `markets.key = markets.settlement_rule_key = "over_under"`. O registry de
  settlement (#166) e o de cartucho (#165/#167) resolvem por ESSA string literal. Seleções: `over`/`under`.
- **`result_data` shape:** `{ homeScore: number|null, awayScore: number|null, totalGoals: number }`
  (camelCase — supersede a ilustração snake_case da ADR 0016 D2). `totalGoals` é o escalar settled
  verbatim; `homeScore/awayScore` degradam a null quando `home+away ≠ totalGoals` (split não confiável).
  O escalar legado `total_goals` permanece até o contract (Fase 5). **Zod no boundary do settlement = #166.**
- **`market_params` shape:** `{ line: number }` (number, não string "2.5") — consistente em `predictions`
  e `selection_odds_snapshots`. Zod no boundary = #164/#165.
- **`push` na Fase 1:** existe no enum, mas NENHUM caminho o emite/seleciona. Tipos derivados do enum
  foram widenados (`DashboardRow.result`, `RowStatus`, `PredictionRowView.status`, view de detalhe,
  `STATUS_META`). `OutcomeResult` (compute.ts) **ficou won/lost/void** de propósito — o override não
  oferece push (guard em `app/admin/predictions/[id]/page.tsx`). `kpis.ts` já exclui push do yield/winRate
  estruturalmente (como o void). **Fase 2 (#166) é quem widena `OutcomeResult` + faz o registry emitir push.**
- **`prediction_selection_odds` = candidate set:** guarda as odds congeladas de TODAS as seleções do
  mercado na análise (inclusive em pass), independente de `predictions.selection_id` (o lado escolhido).
  NÃO é "a odd da aposta". O par legado `over/under_odd_at_prediction` permanece até o contract.

---

## Pendência operacional (fechar a paridade da Fase 1)

O `--apply` do backfill é o passo do USUÁRIO (escolha "read-only first, then I apply"). Read-only já
rodado contra o DB real: **9 preds, 4 com par→8 odds, 5 outcomes (5 split confiável), 290 snaps→580
(2x, zero colisão)**. Paridade é **estrutural** (o backfill só escreve colunas/tabelas novas; o
dashboard não lê nenhuma). Pra fechar formalmente:

```bash
pnpm tsx db/scripts/dashboard-kpis-snapshot.ts > before.json
pnpm tsx db/scripts/backfill-multimarket.ts            # dry-run, confere contagens
pnpm tsx db/scripts/backfill-multimarket.ts --apply    # hard-fail se divergir
pnpm tsx db/scripts/dashboard-kpis-snapshot.ts > after.json
diff before.json after.json   # VAZIO = paridade provada (critério de saída da Fase 1)
```

---

## As issues da Fase 2 (#163–#168) — ordem e dependências

> Princípio transversal: **expand-migrate-contract continua** — Fase 2 GENERALIZA o caminho do
> over/under sem remover o legado (contract = Fase 5). Cada passo prova **paridade** (over/under pelo
> caminho genérico = mesmos números/decisões que hoje). **Zero `if (market === X)` fora dos registries.**

- **#163 — Odds math p/ N seleções (paridade exata de arredondamento).** Generaliza
  `lib/odds/scenario.ts` (hoje 2-arg `computeImpliedProbabilities(overOdd, underOdd)` + "lado oposto =
  100−x", ADR 0018) pra N seleções: implícita por seleção = `(1/odd_i) / Σ(1/odd_j)` (overround do
  mercado COMPLETO); edge_i = `modelProb_i − implied_i`. **Paridade:** em N=2 (over/under) os números
  têm que bater BIT-A-BIT com o cálculo atual (mesmo arredondamento). EV/break-even na odd CRUA
  (ADR 0012 decisão 6) sobrevive. Funções puras + testes (sem DB/LLM).
- **#164 — Seletor de bookmaker + snapshot + queries genéricos.** Generaliza
  `lib/odds/select-bookmaker.ts` (hoje `pickBestTotalsBookmaker`, filtra `point===2.5`) +
  `lib/db/queries/odds-snapshots.ts` (hoje par fixo over/under, `market='over_under_2_5'`) pra ler/gravar
  `selection_odds_snapshots` por `market_id`+`market_params`. DISTINCT ON "última por (match,market,
  selection)" usa o `UNIQUE` da 0012. Zod no boundary de `market_params`.
- **#165 — Cartucho de mercado + `predict()` por `marketKey`.** Generaliza `lib/ai/predict.ts` (hoje
  hardcoda `./prompts/over_under_v1` + `OverUnderOutputSchema` + `markets:["totals"]`). Registry de
  cartucho resolvido por `markets.key` (ADR 0017): prompt + input/output Zod + seletor de bookmaker por
  mercado. `predict()` passa a preencher `market_id`/`selection_id`/`market_params`/
  `prediction_selection_odds` (que a Fase 1 deixou nullable e o predict NÃO preenchia). **Fronteira
  `lib/ai/predict.ts` continua a única porta pro LLM** (logging em `ai_calls`). Eval gate por análise (#105).
- **#166 — Settlement plugável (registry + push).** ADR 0016: regra PURA por
  `markets.settlement_rule_key` (`(selection, marketParams, resultData) → outcome`), dinheiro num lugar
  só (`profitFor...`). Widena `OutcomeResult` p/ incluir push (Fase 1 deixou narrow de propósito).
  `getPendingSettlementPredictions` passa a selecionar `market*`. `result_data` validado por Zod.
  Consome `prediction_outcomes.result_data` (Fase 1) — NÃO o `total_goals` sozinho. Idempotência +
  override preservados. Tabela de cenários da ADR 0016 = a suíte de testes.
- **#167 — Staking 1–3u por confiança em código.** ADR 0019: a regra de stake (hoje flat default "1")
  vira função de confiança→unidades (1–3u). `predictions.stake_units` já comporta. Paridade: o
  histórico é imutável (não re-stakea).
- **#168 — Override/admin condicional ao mercado.** O override (`app/admin/predictions/[id]`,
  `override-form.tsx`, `app/actions/settlement.ts`) passa a oferecer as seleções/resultados do MERCADO
  da predição (não o over/under fixo). Aqui push pode entrar como opção de override (depois do #166).

**Saída da Fase 2:** over/under roda 100% pelo caminho genérico com paridade comprovada; zero
`if (market === ...)` fora dos registries. Depois vem a Fase 3 (UI multi-outcome + dashboard segmentado,
#169–172) e Fase 4 (mercados novos, #173–176).

---

## Ground truth verificado (bater com o CÓDIGO real em `main`, não com este doc)

- **Migrations:** head = `0012_zippy_dakota_north` → a 1ª da Fase 2 (se precisar de schema; #166 pode
  precisar de migration p/ widening de tipo, mas o enum `push` já existe) é **`0013`**.
- **Acoplamento mercado-único restante** (o que a Fase 2 generaliza): `lib/ai/predict.ts` (cartucho
  hardcoded), `lib/odds/scenario.ts` (2-arg), `lib/odds/select-bookmaker.ts` (`point===2.5`),
  `lib/settlement/compute.ts` (`OVER_UNDER_LINE=2.5`, won/lost binário) + `settle.ts`,
  `lib/db/queries/odds-snapshots.ts` (par fixo). `lib/ai/request-builder.ts` + generation-params/models
  JÁ são market-agnostic.
- **Colunas novas que o predict/settle ainda NÃO preenchem** (Fase 1 deixou nullable; Fase 2 preenche):
  `predictions.market_id/selection_id/market_params`, `prediction_selection_odds.*`,
  `prediction_outcomes.result_data`, `selection_odds_snapshots.*`.
- **Dashboard:** `getUserDashboardRows` ainda lê o enum `market` (não `market_id`) — a segmentação por
  mercado + o JOIN por `market_id` são #171 (Fase 3). `kpis.ts` já tem `push` nos tipos e na exclusão
  do yield.

---

## Gotchas de ambiente (COMPROVADOS nas Fases 0–1)

- **Neon preview branch limit (~10):** cada PR cria uma preview branch; ao bater ~10, o deploy da
  Vercel FALHA RÁPIDO (mesmo em PR SEM migration — o `drizzle-kit migrate` do build não conecta).
  Aconteceu no #214. **Fix:** deletar preview branches stale no dashboard do Neon → re-trigger
  (`git commit --amend --no-edit` + `git push --force-with-lease`) → o gate volta a `pending→pass`.
  Há ~30 branches remotas stale acumuladas — vale uma limpeza antes da Fase 2.
- **`pnpm lint`/`pnpm test` poluídos por `.claude/worktrees/` (gitignored, 8 checkouts stale):** o
  eslint/vitest varrem essas cópias e dão centenas de erros/falhas FANTASMA. Rode SEMPRE com
  `--exclude "**/.claude/**"` (vitest) / `--ignore-pattern ".claude/**"` (eslint). Código de projeto:
  `.claude/worktrees` = 100% dos erros; real source fica limpo. (Considerar um PR pequeno adicionando
  `.claude/` ao exclude do vitest.config + eslint ignores — fora de escopo até agora.)
- **Toolchain:** `bash -lc '. "$HOME/.nvm/nvm.sh"; nvm use 24; corepack pnpm
  --config.verify-deps-before-run=false run <typecheck|lint|test>'`. `pnpm install` cria
  `pnpm-workspace.yaml` na raiz (artefato) — **NÃO commitar** (sempre `git add` por path explícito).
- **`db:generate` é offline** (diff schema↔snapshot; precisa só de DATABASE_URL no `.env.local` p/ o
  config carregar). **`db:migrate`/backfill `--apply` mexem no DB de PROD** (`.env.local` = prod; sem
  dev DB ainda). Read-only (snapshot, dry-run) é seguro. Validação de migration = **Vercel preview**
  (Neon branch + `drizzle-kit migrate`). Build local NÃO roda.
- **`tsx` resolve `@/`** (tsconfig paths) — os scripts da Fase 1 importam `@/`/relativo e rodam via
  `pnpm tsx`. `pnpm tsx <script>` funciona.
- **`main` local é STALE** → base com `git checkout -b <branch> origin/main`; diffs `origin/main...HEAD`.
- **`gh pr checks <n>`:** o gate é a linha `Vercel` (`awk -F'\t' '$1=="Vercel"{print $2}'`);
  `UNSTABLE`/deploy pending é não-bloqueante. NÃO há CI de teste → "verde" = typecheck+lint+test local
  (com os excludes) + Vercel=pass.
- **PRETTIER não roda em CI** (trailing-comma `all` no código vs `.prettierrc` es5) → NÃO `prettier
  --write` em `.ts`; seguir o estilo ao redor. Squash-merge é o padrão; `Closes #N` fecha a issue.
- **`gh` sempre com `-R fernandolisboa/palpiteiro-claude`.** Paths com `[id]` (rotas dinâmicas) no
  `git add` PRECISAM de aspas (zsh glob).
- **Caminho do LLM nos testes:** NENHUM teste pode chamar o Anthropic pago.

## Fluxo (CLAUDE.md)

Subagent de contexto fresco por passo: explorar → plano → review do plano → ajustes → implementar →
code review → correções. Aterre cada ADR/citação no CÓDIGO real. 1 PR por issue, mergeando off
`origin/main` conforme cada um fica verde (Vercel=pass). Plan-review e code-review adversariais
(multi-lente) foram de altíssimo valor na Fase 1 — repetir na Fase 2 (math de N vias e settlement
plugável são os pontos mais arriscados).
