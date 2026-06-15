# HANDOFF — Pivot multi-mercado · FASE 3 (UI multi-outcome + dashboard segmentado + ajuda · #169–#172)

> **Status:** **FASE 2 FECHADA (6/6)** — #163, #164, #165, #166, #167, #168 MERGEADOS em `origin/main`
> (squashes `42db949c`, `0fcfbefa`, `2f0faa7b`, **`2de66bf8`**, **`357ba374`**, **`f5bca18b`**).
> Falta a **Fase 3: #169 → #170 → #171 → #172** (UI). Mapa do pivot inteiro + decisões D1–D10:
> `HANDOFF-fase-1.md`/`HANDOFF-fase-0.md` + épico **#183**. Convenção de handoff/kickoff: CLAUDE.md.
> **Critério de saída da Fase 3 (de #172):** UI inteira data-driven por mercado, dashboard segmentado
> com paridade, ajuda market-aware — over/under **visualmente equivalente ao pré-pivot**. Ao fechar
> (#172), escrever `HANDOFF-fase-4.md` (ativação de mercados novos: 1X2/BTTS/dupla chance, #173+) + kickoff.

## O que a Fase 2 entregou (em `origin/main`) — o BACKEND multi-mercado está pronto

over/under roda **100% pelo caminho genérico** (math + ingestão + predict + settlement + staking +
override). **Critério de saída cravado (definição de BRANCHING):** zero predicado `if (market === X)` /
`switch (market)` fora dos registries — prova: `grep -rEn 'if \(market ===|switch \(market' lib app`
(sem testes) só acha COMENTÁRIOS. As 4 fronteiras de variação por mercado são registries keyed:

- **Cartucho** (`lib/ai/markets/{registry,types}.ts` + `over_under/`): `getCartridge(marketKey)`. #165.
- **Descriptor de odds** (`lib/odds/market-descriptor.ts`): provider/db/selection keys. #164.
- **Catálogo** (`lib/db/queries/market-catalog.ts`): `resolveMarketCatalog(dbMarketKey)`. #165.
- **Settlement** (`lib/settlement/registry.ts` + `rules/over_under.ts`): `getSettlementRule(ruleKey)`. #166.

Detalhe por issue:
- **#166** (`2de66bf8`): settlement plugável. `lib/settlement/{schemas,money,registry,compute}.ts` +
  `rules/over_under.ts`. Regra PURA `(selection, marketParams, resultData) → SettlementOutcome`; dinheiro
  num lugar só (`money.ts`, `round2` com `Number.EPSILON` — paridade); `OutcomeResult` widened com `push`;
  `result_data` coletado 1x/jogo e persistido (Zod via `resultDataFromRegulationScore`);
  `getPendingSettlementPredictions` faz LEFT JOIN markets+market_selections. Golden pglite de paridade.
- **#167** (`357ba374`): staking 1–3u. `lib/ai/staking.ts` `computeStakeUnits(edgePct, confidencePct)`
  (bandas ADR 0019); predict congela `stake_units` decidindo sobre os valores ARREDONDADOS a 2 casas (=
  os congelados na row, auditabilidade). `kpis.ts` já é stake-aware. Histórico fica 1u (imutável).
- **#168** (`f5bca18b`): override condicional ao mercado + push. `app/actions/settlement.ts` aceita push em
  `VALID_RESULTS`, valida `result_data` via Zod, e a regra "sem odd → só void" foi ESTENDIDA a push (guard
  `odd===null && result!=="void"`, pois `profitForResult(push,null)=0` não null). `override-form.tsx`
  oferece push (data-driven, sem hardcode de over/under). REGISTROU o critério de saída da Fase 2.

## Resíduo LEGADO (expand-migrate-contract) — NÃO é branching; o **contract é Fase 5**, NÃO Fase 3

Sobrevivem por design até o contract (NÃO mexer na Fase 3):
- Enum `market` de valor único `pgEnum("market", ["over_under_2_5"])` (`db/schema.ts:33`), escrito/lido em
  `predictions.market` (`predict.ts:688`) e `match_odds_snapshots.market`.
- Tabela binária `match_odds_snapshots` (par over/under) + o par `over/underOddAtPrediction` + escalar
  `total_goals` — coexistem com `selection_odds_snapshots` / `prediction_selection_odds` / `result_data`.
- **predict.ts lê odds da tabela VELHA** (`getLatestFreshOddsSnapshot`) por paridade; o candidate set
  deriva do bundle over/under. Migra quando existir cartucho não-over/under (Fase 4).
- `lib/dashboard/derive-view.ts:29` normaliza o `MarketFilter` pro literal `"over_under_2_5"` — é filtro de
  dashboard (Fase 3 #171 generaliza), NÃO branching de settlement/predict.

## As issues da Fase 3 (#169 → #170 → #171 → #172) — ordem, deps e ÂNCORAS NO CÓDIGO
> Aterre cada citação no CÓDIGO real (os nºs de linha das issues são de quando foram criadas — re-grounde).
> Use o **two-round plan-gate** (plan-review multi-lente → rework → lean re-verify) ANTES de codar.
> Subagent de contexto fresco por passo; worktree isolado **off `origin/main`** (a checkout compartilhada
> é stale, em `chore/neon-preview-branch-cleanup`).

- **#169 — View-layer multi-outcome (o PONTO DE ALAVANCA). Depende de #165,#166 (✓).** `lib/view/types.ts`
  define o binário que cascateia: `Recommendation = "OVER"|"UNDER"|"PASS"`, `ScenariosView` com campos
  fixos `over`/`under`, `OddsView`, `MatchRowView.odds {over,under}`, `H2HViewRow.tag`. Mappers acoplados:
  `lib/view/{analysis,odds,dashboard,recent-prediction,sections,match}.ts`. **Escopo:** view expõe
  `outcomes` como ARRAY (`{id,label,modelProb,marketProb,odd,edge,expectedReturn,breakEven,isRecommended}`)
  com labels vindos do **market registry (seed)**, nunca hardcode; `Recommendation` vira referência a
  seleção (+PASS); detail troca `total_goals` pela métrica de settlement do mercado (`result_data`);
  `toH2HView` parametriza o corte "3+ gols". Golden tests: `analysis.test.ts` (~90 O/U), `dashboard.test.ts`
  reescritos mantendo os casos binários como golden do over/under. Critérios incl. "mapper 1X2 produz 3
  outcomes com fixture mock" (antes do mercado existir no backend).
- **#170 — Redesign dos componentes data-driven. Depende de #169.** A estrutura binária está NO JSX:
  `analysis-scenarios.tsx` (2 colunas físicas `<ScenarioColumn side>`, hints só na coluna over),
  `analysis-result.tsx` (`isOver`, setas ↑/↓, "2.5 gols"), `odds-card.tsx`, `recent-pred-card.tsx`,
  `h2h-section.tsx`, `dashboard/{predictions-table,prediction-detail}.tsx`, `match-row.tsx`,
  `upcoming-matches-desktop.tsx`, `app/page.tsx` (subtitle), `app/match/[id]/page.tsx`. **Escopo:** cenários
  data-driven por array (2 vias lado a lado, 3 vias grid, N vias top-K ADR 0018); remover setas/prefixos
  O/U/strings "2.5"; **recomendação exibe mercado + seleção + linha + STAKE em unidades (integra #167)**.
  Golden reescritos: `analysis-scenarios.test` (~37), `analysis-result.test` (~33), `upcoming-matches.test`.
- **#171 — Dashboard KPIs segmentados por mercado + régua go/no-go (D9). Depende de #166,#162 (✓).** Hoje:
  `kpis.ts` tem `MarketFilter`/`DashboardRow.market` mas estreitados pro literal `"over_under_2_5"`;
  `derive-view.ts` `parseMarket` só aceita esse valor; **nenhuma segmentação de KPI** (KPIs globais);
  `dashboard-filters.tsx` `MARKET_OPTIONS` hardcoded; `getUserDashboardRows` já seleciona market. **Escopo:**
  KPIs (Yield/win rate/pass rate/lucro/nº apostas) **por mercado + agregado**; `winRate` acomoda `push`
  (não conta won+lost — ADR 0016); `MARKET_OPTIONS`/`parseMarket` dinâmicos da tabela `markets`; admin
  cross-user (ADR 0010) segmentado; **régua D9 visível**: "N resolvidas / 30" + Yield por mercado. Paridade:
  só over/under no histórico → agregado E segmento mostram os números atuais. **⚠️ ÓRFÃO A ADOTAR AQUI:** o
  **breakdown de Yield/nº por banda de stake (1u/2u/3u)** — mitigação de ruído do ADR 0019 §5 — foi
  **deferido do #167 pra Fase 3**; #171 é o lar natural (decidir no plan-gate: seção própria ou cair em #172).
- **#172 — Ajuda market-aware (REGISTRA o critério de saída da Fase 3). Depende de #169,#170.**
  `components/help/glossary.ts` é fonte única (22 termos; 5 O/U-específicos: `over-under-2-5`,
  `recomendacao`, `prob-implicita`, `overround`, `cenarios`). Hosts de hints: `kpi-cards.tsx`,
  `analysis-scenarios.tsx` (a convenção `showHints = side==="over"` CAI com o redesign do #170),
  `odds-card.tsx`, `analysis-result.tsx`. **Escopo:** glossário market-aware mantendo a fonte única (5
  O/U reescritas genéricas + conteúdo O/U preservado na parte do mercado); **fix:** `odd-minima` hardcoda
  "5pp" → interpolar `MIN_EDGE_PP` (como `edge` já faz); termos novos do pivot (mercado, seleção, linha,
  push, stake 1-3u). Contratos pinados: `como-funciona-page.test.tsx` (anchor→id no DOM), `help-hint.test.tsx`
  (`PLACEMENT_ANCHORS`), `glossary.test.ts`. Critério: 22 anchors atuais sobrevivem (links antigos não quebram).

**Ordem:** #169 (alavanca) → #170 (componentes, dep #169) → #172 (ajuda, dep #169+#170, REGISTRA a saída).
#171 é independente do par #169/#170 (depende só de #166/#162 ✓) — pode ir em paralelo/qualquer ponto.

## Princípios inegociáveis (carregam da Fase 2)
- **Registries são a fronteira.** Labels/ícones/linhas de mercado vêm do **registry/seed** via view-layer —
  **zero string de mercado hardcoded em componente** (é critério de aceite do #170). Zero `if (market===X)`.
- `lib/ai/predict.ts` é a ÚNICA porta pro LLM. **NENHUM teste chama o Anthropic PAGO.** O eval gate (#105)
  só dispara em mudança de **prompt/cartucho** — a Fase 3 é UI e **não** muda prompt (não dispara o pago).
- Toda forma JSONB (`result_data`, `market_params`) validada por Zod no boundary.
- **expand-migrate-contract:** NÃO remover o legado (enum `market`, `match_odds_snapshots`, `total_goals`,
  par over/under) — o contract é **Fase 5**.
- **Paridade é o critério:** over/under tem que ficar visualmente/numericamente equivalente ao pré-pivot;
  os testes binários atuais viram **golden tests do mercado over/under** (reescritos, não deletados).
- Predições imutáveis. `push` = profit 0, não conta won/lost (`kpis.ts` já exclui estruturalmente).

## Landmines (Fase 3)
- (a) **Cascata de tipos do #169:** mudar `lib/view/types.ts` quebra ~todos os mappers + componentes +
  ~90 ocorrências em `analysis.test`. É G de propósito. Resolver a cascata de tipos no #169, componentes no #170.
- (b) **Testes pinados densos:** `analysis.test` (~90), `analysis-scenarios.test` (~37), `analysis-result.test`
  (~33), `kpis.test`, `derive-view.test`, `glossary/help` contracts. Reescrever mantendo over/under como golden.
- (c) Componentes testam via **`renderToStaticMarkup`** (`react-dom/server`) — **NÃO há `@testing-library`**
  (não é dep). Componente "use client" que importa server action → mockar a action (next-auth não resolve
  sob vitest). `useActionState` renderiza no estado inicial sob markup estático.
- (d) 1X2/BTTS NÃO estão ativos no backend (só `over_under` é seedado/ativo; `match_result` existe só em
  dev/test no descriptor). Os critérios "1X2 com fixture mock" provam a UI N-vias **antes** da ativação
  (Fase 4 #173). Fase 3 provavelmente **não precisa de migration**.
- (e) `MIN_EDGE_PP` (`lib/odds/scenario.ts`) é importado por componentes — manter o single-source no #172.

## Ground truth verificado (bater com `origin/main` @ `f5bca18b`)
- **Migration head = `0012`** (Fase 2 não adicionou nenhuma; #166/#167/#168 são TS-only). Fase 3 = UI,
  provavelmente **0 migrations**.
- Backend genérico: cartucho/odds/catálogo/settlement/staking/override — todos keyed por registry. predict
  ainda dual-write no legado (enum `market`, `match_odds_snapshots`, par over/under) por expand.
- `getUserDashboardRows` já seleciona `market`; `DashboardRow.market`/`MarketFilter`/`RowStatus` já carregam
  `push`; `kpis.ts` já exclui push do yield/winRate — falta a SEGMENTAÇÃO (#171).

## Gotchas de ambiente (COMPROVADOS Fases 0–2; um NOVO desta sessão)
- **`pnpm install --ignore-workspace` no worktree** (NOVO/CRÍTICO): existe um `pnpm-workspace.yaml`
  untracked na raiz da checkout compartilhada (NÃO commitar). Como os worktrees ficam SOB a raiz
  (`.claude/worktrees/<nome>`), um `pnpm install` normal vira no-op contra o `node_modules` compartilhado
  (stale, sem `@electric-sql/pglite`). Instale com `--ignore-workspace` → node_modules isolado no worktree.
  NÃO `rm -rf` o node_modules compartilhado (outras sessões dependem).
- **Worktree:** `git worktree add -b <branch> <path> origin/main`; toolchain
  `bash -lc '. "$HOME/.nvm/nvm.sh"; nvm use 24; cd <wt>; corepack pnpm --config.verify-deps-before-run=false
  <install --ignore-workspace | run typecheck|run lint|run test>'`. Limpar com `git worktree remove --force`.
- **pglite** (real-DB tests): `// @vitest-environment node` + Proxy-mock de `@/lib/db` + shim de `.batch` +
  `migrate({migrationsFolder:"./db/migrations"})` + seed. Ex.: `lib/settlement/__tests__/settle-golden.pglite.test.ts`.
- **Vercel gate RÁPIDO (~20–80s) e passa**; gate = linha `Vercel` (`awk -F'\t' '$1=="Vercel"{print $2}'`);
  `pending` ~2–7 polls de 15s; `UNSTABLE`/pending não-bloqueante. `pr checks <N>`.
- `db:generate` offline; `db:migrate`/`--apply` = PROD. **PRETTIER não roda em CI → NÃO `prettier --write`.**
  `gh` sempre `-R fernandolisboa/palpiteiro-claude`. Paths com `[id]` precisam de **aspas** (git add/vitest).
  Squash-merge `--delete-branch`; `Closes #N`; verificar `origin/main` HEAD + issue CLOSED (ancestor-check no
  SHA original FALHA por design no squash). Co-author: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Fluxo (CLAUDE.md) — foi de altíssimo valor na Fase 2
Two-round plan-gate adversarial multi-lente (plan-review aterrado no código → rework → lean re-verify)
ANTES de codar → implementação em worktree isolado off `origin/main` → code-review multi-lente find→verify
(postado como PR comment via `gh pr comment`) → fixar ressalvas value-adding → merge quando Vercel=pass.
1 PR por issue. Os `PLAN-16N.md` ficam no worktree (não commitados). Na Fase 2 o gate pegou: parity de
round2 EPSILON + safeParse/SettlementError + golden não-tautológico (#166); rounding-seam edge/confiança
(#167); um teste que contradizia o novo contrato de push + premissa errada de infra de teste (#168).
