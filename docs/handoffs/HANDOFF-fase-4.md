# HANDOFF — Pivot multi-mercado · FASE 4 (ativação dos mercados novos · #173+)

> **Status:** **FASE 3 FECHADA (4/4)** — #169, #170, #171, #172 MERGEADOS em `origin/main`
> (squashes `013ed7e5`, `7ef1a8b2`, `bb89d939`, `6f08ea6b`). HEAD de `origin/main` = **`6f08ea6b`**.
> Mapa do pivot inteiro + decisões D1–D10: `HANDOFF-fase-1.md`/`HANDOFF-fase-0.md` + épico **#183**.
> Convenção de handoff/kickoff: CLAUDE.md. **Critério de saída da Fase 4:** ≥1 mercado novo (1X2) ATIVO
> em produção atrás de feature-flag, rodando 100% pelo caminho genérico, com odds N-vias ao vivo + UI
> N-vias + dashboard segmentando-o + régua D9 graduando-o — **com a paridade over/under intacta**.

## O que a Fase 3 entregou (em `origin/main`) — a UI está PRONTA pra N-vias
A UI inteira é **data-driven por mercado**; ativar um mercado novo é majoritariamente BACKEND + seed + flag.
- **View-layer** (#169, `013ed7e5`): `AnalysisView.outcomes: OutcomeView[]` + `recommendation: BetReference|null`
  (+ `betSummary`, `framing`, `note`, `stakeUnits`, `scenarioLabel` no #170). Registry de apresentação PURO/client-safe
  `lib/view/markets/presentation.ts` (`getMarketPresentation(marketKey)` → marketLabel, selectionLabel, outcomeLabel,
  scenarioLabel, betSummary, framingLabel, settlementMetricLabel, classifyH2H, defaultLine). **Já tem `over_under` E
  `match_result` (Casa/Empate/Fora).** Labels curtos espelham o seed (pglite seed-parity test).
- **Componentes** (#170, `bb89d939`): cenários array-driven (2/3 vias + **top-K=5**, recomendado + modelProb desc),
  recomendação = mercado+seleção+linha+**stake**; sem setas/prefixos/"2.5" hardcoded. Os campos binários da view
  (`kind`/`scenarios`/`betSummary`) foram CONTRAÍDOS. Page (`getLatestPredictionForMatch` join markets) + action passam
  marketKey/line/stake pro mapper. **O caminho N-vias está PROVADO por fixture-mock** (`toOutcomesView` +
  `computeMarketScenarios` + `getMarketPresentation("match_result")` → 3 outcomes) ANTES do backend existir.
- **Dashboard** (#171, `7ef1a8b2`): KPIs segmentados por `markets.key` (dedup `(matchId, marketKey)`), régua D9
  ("resolvidas = yield.n / 30" + yield>0, display-only), breakdown por banda de stake (1u/2u/3u). `availableMarkets`
  das rows-com-histórico. Ativou um mercado → o segmento aparece quando tiver predições.
- **Ajuda** (#172, `6f08ea6b`): glossário market-aware fonte única (`GlossaryEntry.markets?: Record<key,string>`);
  5 termos O/U genéricos + conteúdo O/U em `markets.over_under`; termos novos (mercado/seleção/linha/push/stake-confiança);
  `odd-minima` interpola `MIN_EDGE_PP`. 22 anchors intactos.

## O que a Fase 4 É — ativar um mercado de ponta a ponta (o modelo)
Cada mercado novo = registrar nas 5 fronteiras keyed + seed + flag. predict.ts despacha por `marketKey` via
`getCartridge` e **NÃO ramifica** (`predict.ts:235` default `over_under`, `:240` getCartridge). Passos:
1. **Cartucho** `lib/ai/markets/<market>/` + registrar em `lib/ai/markets/registry.ts`: prompt versionado (ADR 0017),
   schemas Zod input/output, `buildPredictionInput`, `buildUserMessage`, `selections`, `descriptor`. (Espelha `over_under/`.)
2. **Descriptor** `lib/odds/market-descriptor.ts`: provider/db/selection keys + `resolveSelectionKey` + `selectionKeys`.
   **`MATCH_RESULT` já existe (dev/test, `is_active=false`)** — promover a produção. (1X2 usa `teamsMatch` p/ grafia divergente.)
3. **Apresentação** `lib/view/markets/presentation.ts`: já tem `match_result`; adicionar os demais (BTTS, dupla chance).
4. **Regra de settlement** `lib/settlement/registry.ts` + `rules/<market>.ts`: PURA `(selection, params, resultData) → outcome`.
5. **Seed migration** `db/migrations/` (segue o modelo da 0009): `INSERT markets (key,label,settlement_rule_key,
   is_active=true,is_graduated=false)` + `INSERT market_selections (key,label,sort_order)`. **É A ATIVAÇÃO** (`is_active`).
   `resolveMarketCatalog` (lib/db/queries/market-catalog.ts) já é genérico — lê as rows seedadas, sem mudança.
6. **Glossário** `components/help/glossary.ts`: adicionar os addenda do mercado em `markets[<key>]` (estrutura pronta).
7. **Feature-flag / graduação**: `is_active` libera; a régua D9 (≥30 resolvidas + yield>0) gradua (`is_graduated`).

## ⚠️ O passo expand→migrate que a Fase 4 OWNS (odds ao vivo N-vias)
`predict.ts` ainda LÊ odds da tabela **LEGADA binária** (`getLatestFreshOddsSnapshot`, par over/under) por paridade, e
o **candidate set deriva do bundle over/under** (`build-input`). Um mercado não-over/under exige:
- o **reader N-vias** de `selection_odds_snapshots` (a ingestão já ESCREVE lá desde #164 — falta o READ no predict + na UI),
- o candidate set genérico por seleção.
- A **`OddsView` ao vivo é binária por construção**; `odds-card.tsx` é binário (e o blurp de overround ainda hardcoda
  "over% + under%" — genericiza JUNTO com o reader N-vias). `match-row`/`upcoming` chips idem.

## Ordem e dependências sugeridas
- **#177** (spec-mãe do contrato genérico + spec por mercado) — o contrato, primeiro.
- **#173 (1X2 / h2h)** — 1º mercado de 3 seleções, o **pathfinder**: exercita odds N-vias ao vivo, settlement, apresentação,
  seed, e o **eval pago** do novo prompt. Atrás de feature-flag.
- **#174 (BTTS)** + **#176 (dupla chance)** — Tier 2, atrás de flag.
- **#175 (linhas extras O/U 1.5/3.5)** — mais linhas no over/under (note: meias-linhas, sem push).
- **#178 (modo "melhor aposta do jogo")** — fan-out cross-mercado em código (depende de ≥2 mercados ativos).
- **#182** (reformular o tutorial `/como-funciona` — PROSA, não o glossário) — independente, qualquer hora.
- **#158** (validação de cobertura de odds região eu p/ mercados additional) — pré-req de cobertura do provider.

## Princípios inegociáveis (carregam das Fases 1–3)
- **Edge N-vias (ADR 0018):** cada seleção tem seu edge `model_i − implied_i`; implícita NORMALIZADA pelo overround do
  mercado COMPLETO (Σ1/odd sobre TODAS as seleções). NUNCA `1/odd` cru. SEM `100−x` fora do caso N=2.
- **Zero `if (market === X)` / `switch (market)` fora dos registries** — prova: `grep -rEn 'if \(market ===|switch \(market' lib app`
  (sem testes) só acha COMENTÁRIOS. As fronteiras de variação são registries keyed (cartucho/descriptor/apresentação/settlement).
- `lib/ai/predict.ts` é a ÚNICA porta pro LLM (loga em `ai_calls`). Output do LLM SEMPRE validado por Zod.
- **expand-migrate-contract:** NÃO remover o legado (enum `market`, `match_odds_snapshots`, coluna `total_goals`, par
  over/under) — o contract é **Fase 5 (#179)**. predict ainda dual-write o enum (`predict.ts:688`).
- **Paridade over/under** não regride (visual e numérica). `push` = profit 0, fora de yield/winRate (kpis exclui).
- **Tier 3** (handicap asiático, escanteios, cartões, player props) e provider/liga novos AINDA exigem ADR/checklist.

## Landmines (Fase 4) — resíduo over/under-específico a generalizar conforme ativa mercado
- (a) **Odds ao vivo binárias** (acima): `OddsView`/`match_odds_snapshots`/`getLatestFreshOddsSnapshot`/`odds-card`/chips.
- (b) **Candidate set** do predict deriva do bundle over/under (build-input) — precisa do genérico por seleção.
- (c) **h2h goal-lens**: `h2h-section.tsx` badge "3+ gols"/"< 3" + summary "over X%" é over/under. `toH2HView` JÁ tem o
  param `classify` (#169) + `presentation.classifyH2H` (null p/ não-gols) — wirar por mercado analisado.
- (d) **`predictions-table.tsx` REC_CLASS** colore por OVER/UNDER/PASS — generalizar p/ recomendações N-vias.
- (e) **1X2 `resolveSelectionKey` usa `teamsMatch`** (grafia divergente do provider) — validar cobertura (#158).
- (f) **`/como-funciona` tutorial PROSA** (#182) ≠ glossário (#172, feito). Não confundir escopos.

## Ground truth (bater com `origin/main` @ `6f08ea6b`)
- **Migration head = `0012`** (Fase 3 não adicionou migration — só TS/glossário). 1º mercado novo ADICIONA uma migration de seed.
- `predict.ts`: `marketKey = "over_under"` default (`:235`), `getCartridge(marketKey)` (`:240`), dual-write enum `over_under_2_5` (`:688`).
- `markets`/`market_selections` seedados SÓ `over_under` (`is_active=true`, migration 0009). `MATCH_RESULT` descriptor existe
  dev/test (`is_active=false`, `market-descriptor.ts:64`). Apresentação tem `over_under` + `match_result`.
- **Eval pago:** `scripts/replay-prompt-eval.ts` (+ guard `scripts/__tests__/replay-prompt-eval-guard.test.ts`).

## ⚠️ Gotcha NOVO da Fase 4 — o EVAL PAGO (#105) dispara
A Fase 3 foi UI → **não** disparou o eval. A Fase 4 adiciona **prompts/cartuchos novos** → `scripts/replay-prompt-eval.ts`
roda os prompts contra o **LLM REAL (custa dinheiro)**. **Orçar** o eval por mercado novo; mencionar o custo no PR (gotcha
de tokens da CLAUDE.md). NENHUM teste de unidade deve chamar o LLM pago — o eval é o passo deliberado e pago, à parte.

## Gotchas de ambiente (COMPROVADOS Fases 0–3)
- **`pnpm install --ignore-workspace` no worktree**: o `pnpm-workspace.yaml` untracked na raiz da checkout compartilhada
  faz um `install` normal virar no-op contra o `node_modules` compartilhado stale (sem `@electric-sql/pglite`). Instale
  isolado com `--ignore-workspace`. NÃO commitar `pnpm-workspace.yaml`. NÃO `rm -rf` o node_modules compartilhado.
- **Worktree:** `git worktree add -b <branch> <path> origin/main`; toolchain
  `bash -lc '. "$HOME/.nvm/nvm.sh"; nvm use 24; cd <wt>; corepack pnpm --config.verify-deps-before-run=false
  <install --ignore-workspace | run typecheck | run lint | run test -- --run>'`. Limpar: `git worktree remove --force <wt>`.
  A checkout compartilhada está STALE (branch `chore/neon-preview-branch-cleanup`) — NUNCA codar nela; sempre worktree off `origin/main`.
- **pglite** (real-DB): `// @vitest-environment node` + Proxy-mock de `@/lib/db` + shim `.batch` + `migrate({migrationsFolder:"./db/migrations"})`
  + seed. As migrations rodam os INSERTs (markets/market_selections) — daí o seed-parity test funciona.
- **Vercel gate RÁPIDO (~45–105s) e passa**; gate = a linha `Vercel` (`awk -F'\t' '$1=="Vercel"{print $2}'`); `UNSTABLE`/`pending`
  não-bloqueante. `gh pr checks <N>`. mergeable pode ser MERGEABLE com state UNSTABLE (Vercel pendente).
- `db:generate` offline; `db:migrate`/`--apply` = **PROD** (o seed do mercado novo É uma migration de prod). **PRETTIER não
  roda em CI → NÃO `prettier --write`.** `gh` sempre `-R fernandolisboa/palpiteiro-claude`. Paths com `[id]` precisam de **aspas**.
  Squash-merge `--delete-branch`; `Closes #N`; verificar `origin/main` HEAD + issue CLOSED (ancestor-check no SHA original
  FALHA por design no squash). Co-author: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Fluxo (CLAUDE.md) — foi de altíssimo valor nas Fases 2–3
Two-round plan-gate adversarial multi-lente (plan-review aterrado no CÓDIGO → rework → lean re-verify) ANTES de codar →
implementação em worktree isolado off `origin/main` → code-review multi-lente find→verify (postado como PR comment via
`gh pr comment`) → fixar ressalvas value-adding → merge quando Vercel=pass. 1 PR por issue. Os `PLAN-*.md` ficam no
worktree (não commitados). Na Fase 3 o gate pegou: dedup-by-matchId-só (#171, viola ADR 0015 D6 — segmentação só
coincidentemente-correta); scenario-column-label ≠ outcome.label + a 2ª call site de `toAnalysisView` (action) + o
consumer de `totalGoals` na admin page (#170); label-source vs client-bundle-safety (#169); e o renderer-não-exibe-os-addenda
do glossário (#172). O code-review pegou: frase leiga órfã + `betSummary` dead-code (#170), coalesce marketId-null sem teste (#171).
