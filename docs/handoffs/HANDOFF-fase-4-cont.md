# HANDOFF — Pivot multi-mercado · FASE 4 (CONTINUAÇÃO · restante após #173 PR-2)

> ## ✅ FASE 4 FUNCIONALMENTE COMPLETA (2026-06-15) — #178 foi a ÚLTIMA fatia funcional.
> **#178 "melhor aposta do jogo" MERGED (PR #280) + LIVE DARK em `origin/main`** (migration **0027**). Fan-out cross-mercado EM
> CÓDIGO: `analyzeBestBet` (`app/actions/predictions.ts`) → N `predict()` SERIAIS/jogo (`lib/ai/best-bet.ts#runFanOut`, predict é
> a ÚNICA porta, best-of-successful) → ranking por edge (sort toggle CLIENTE edge%/EV/edge×conf, `components/best-bet-results.tsx`)
> → best + as demais reusando `AnalysisResult` (NUNCA OddsCard → golden intocado). N predições REAIS, dedup `(matchId,marketKey)`
> sem dupla contagem (ADR 0020 emendado). Custo: 2 calls/0 créditos non-WC, ~4 calls/≤3 créditos WC; rate-limit POR ÚLTIMO gate.
> **Flag `ai_config.enable_best_bet_fan_out` OFF (DARK)** — migration 0027 só adiciona a coluna; SEM DML de enable. **Flip = 1 DML
> reversível** (`UPDATE ai_config SET enable_best_bet_fan_out=true WHERE id=1`). **ANTES de ligar:** rederivar o teto diário de
> rate-limit (1 slot autoriza até 6 calls+4 créditos/run — code-review minor, comentado no gate). Plan-gate adversarial (10
> blockers+20 majors) + code-review (1 major: edgeConf não normaliza confiança). **PRÓXIMA FASE: contract #179 → ler `HANDOFF-fase-5.md`.**
>
> **Histórico abaixo (#173 PR-2 e anteriores):**
> **Status:** Fase 4 **EM ANDAMENTO**. Nesta sessão (2026-06-15): **#173 PR-2 (odds card N-vias ao vivo
> over/under 2.5 + 1X2 + chips N-vias)** MERGEADO (#273) e **LIVE em prod** (HEAD `af65541e`). Migration head
> **0022** (PR-2 NÃO teve migration — só view/componentes/reader). Sessões anteriores: #175 (linhas extras) +
> #261 (graduação) LIVE.
> **TODOS os mercados disponíveis pra TODOS os usuários** (não admin-only):
>   - **over/under 1.5/2.5/3.5** (multi-linha v3.0, flag ON) — só **world_cup**.
>   - **1X2 (match_result)** — todas as ligas. **Card+chips ao vivo N-vias LIVE (#173 PR-2).**
>   - **BTTS + dupla chance** — só **world_cup**.
> **Card de odds ao vivo agora é N-vias** (over/under 2.5 + 1X2, featured; NUNCA btts/dc — additional). A match
> page pré-aquece h2h: **+1 crédito de liga por refresh stale** (quota: restam **~420/500**, conferir antes de rodar).
> Paridade over/under 2.5 / 1X2 **byte-idêntica** (golden DOM). Mapa do pivot: `HANDOFF-fase-4.md` + épico **#183**.
> **NÃO escrever HANDOFF da Fase 5 ainda** — a Fase 4 continua (resta **#178** + follow-ups LOW + backtest #173 AC#3/#4).

## O que JÁ está em `main` (a infra genérica que o restante REUSA)
Toda a fundação multi-mercado + agora **multi-linha** está pronta. Ativar um mercado/linha/variante = registrar
nas fronteiras keyed + flag/seed. O grosso existe:
- **Cartuchos** (`lib/ai/markets/`): `over_under` (v2.0, N=2, featured 2.5), **`over_under` v3.0 (NOVA variante multi-linha,
  #175)**, `match_result` (N=3), `btts` (N=2), `double_chance` (N=3 sobreposta). `registry.ts`:
  **`getCartridge(marketKey, { extraLines })`** — tabela data-driven `EXTRA_LINES_VARIANTS` devolve a v3 só com a flag
  (zero `if(market===X)`). Novo mercado = pasta + 1 linha no registry; nova variante = +1 entry no variant map.
- **Descriptor** (`lib/odds/market-descriptor.ts`): + **`candidateLines?: number[]`** + **`OVER_UNDER_ALT`** (additional,
  `providerMarketKey:'alternate_totals'`, `candidateLines:[1.5,2.5,3.5]`, `coveredLeagues:['world_cup']`) — **FORA de
  ALL_DESCRIPTORS** (mesma dbMarketKey de OVER_UNDER; getDescriptor/coveredLeagues/view resolvem a featured). `OVER_UNDER`
  (featured 2.5) intocado.
- **select-bookmaker** (`lib/odds/select-bookmaker.ts`): `pickBestBookmaker(..., params?:{line})` — override de linha;
  uma chamada por linha candidata contra a escada `alternate_totals`. Ausente → `descriptor.params` (byte-idêntico).
- **fetch-and-snapshot** (`lib/odds/fetch-and-snapshot.ts`): caminho `additional` é **multi-linha** — UM `getOddsForEvent`
  (escada, 1 crédito) → 1 bundle/linha (`marketParams:{line}`). Gate de frescor **POR linha**; discrimina featured-over_under
  (legado) de `over_under_alt` (additional, mesma dbMarketKey) por **`oddsSource`**. NUNCA batch.
- **predict.ts** (`lib/ai/predict.ts`): ramifica por **`descriptor.candidateLines`** (data-driven). Single-line = caminho de
  hoje **BYTE-IDÊNTICO** (`deriveImplied` espelha o cálculo). Multi-linha: resolve bundle/linha → monta a escada
  (`GenericOddsArgs.lineLadder`) pro v3 → após o output, `resolveParams(output)` dá a linha escolhida (**OBRIGATÓRIO**, sem
  fallback que settlaria errado), valida ∈ escada, **RE-DERIVA** edge/odds/PSO/oddAtRec da linha escolhida. `marketParams =
  linha escolhida`. Enum legado `over_under_2_5` **só** se `chosenLine===2.5`; `over/underOddAtPrediction` p/ TODAS as linhas.
  `PredictArgs.extraLines` → `getCartridge(marketKey,{extraLines})`.
- **Contrato** (`lib/ai/markets/types.ts`): `GenericOddsArgs.lineLadder?` + `LineLadderEntry` + `MarketCartridge.resolveParams?`
  (additivos, inertes pros outros cartuchos).
- **Flag** (`ai_config.enable_over_under_extra_lines`, default false → flipado true pela 0022): `getEnableOverUnderExtraLines()`
  em `lib/db/queries/ai-config.ts`. `analyzeMatch` deriva `extraLines = flag ∩ candidateLines-presente ∩ liga-coberta`
  (data-driven, sem literal de mercado) → repassa a predict + pré-aquece o descriptor efetivo. **Flip = 1 DML** (reversível).
- **Apresentação** (`lib/view/markets/presentation.ts`): labels over_under **line-driven** (a view já threadava `marketParams.line`):
  betSummary/scenarioLabel/framingLabel usam `line` (ceil p/ "pelo menos N gols", plural `gol`/`gols`). 2.5 byte-idêntico.
  H2H ao vivo segue 2.5 default (FORA do escopo do #175).
- **Settlement** (`lib/settlement/`): **ZERO mudança** — regra over_under já line-paramétrica; meia-linha nunca dá push.
  A linha ESCOLHIDA cai em `marketParams.line` (provado e2e pglite: mesmo placar de 3 gols settla 2.5 over-won e 3.5 under-won).
- **Audiência** (`lib/db/queries/market-catalog.ts`): graduação = flip `is_graduated=true` (DML, sem código). #261 graduou
  match_result/btts/double_chance. Gate de LIGA (`coveredLeagues`) intacto. `marketsForAudience ∩ marketsForLeague`.
- **Dedup snapshots** (migration 0020): `selection_odds_snapshots_dedup_key` inclui `market_params` com **NULLS NOT DISTINCT**
  (1.5/2.5/3.5 coexistem; NULL=NULL preserva o dedup de btts/dc). `onConflictDoNothing` target (live + backfill) espelha.
- **Migrations**: `db:generate` (enum/schema) + DML via `drizzle-kit generate --custom --name <slug>`. `build = drizzle-kit
  migrate && next build` → merge→prod aplica. Head **0022**.
- **Backtest**: `scripts/backtest-cartridge.ts --marketKey=<m>` (dev-only). Multi-linha = acumular ≥20 jogos finished/linha (PAGO).

## Issues restantes da Fase 4 — escopo, como reusam o existente

### #173 — **PR-2 ✅ FEITO (odds card N-vias LIVE @ af65541e, #273)**
- **odds CARD ao vivo N-vias + chips N-vias** ENTREGUE. `OddsView` virou genérico (`outcomes[]`); `OddsCard` renderiza
  `grid-cols-{n}` (contrato por-célula congelado: HelpHint+`flex` só na cell 0, `border-r` em toda cell menos a última);
  paridade over/under byte-idêntica via **golden DOM full-string** capturado ANTES do refactor. Card detalhe **empilha** um 2º
  card 1X2; match page pré-aquece `[OVER_UNDER, MATCH_RESULT]` (`lib/odds/live-card-markets.ts`). Chips home **preferem 1X2**
  (h2h capturado) senão over/under. Reader **best-effort** `getLatestSelectionOddsSnapshotsForMatches` (ordem por `sortOrder`,
  omite incompleto/incoerente, nunca crasha render — distinto do `getLatestSelectionOddsSnapshots` que `throw`a, só p/ predict).
  `toNwayOddsView` re-deriva Σ=1, labels do registry puro. NUNCA additional/btts/dc no card ao vivo.
- **Backtest (AC#3/#4):** PAGO + só com **≥20 jogos finished c/ odds** — acumula, NÃO roda hoje. Script entregue. #173 segue
  OPEN só por causa disso (PR-2 usou `Ref`, não `Closes`).

### #178 — Modo "melhor aposta do jogo" · ✅ **FEITO (PR #280, MERGED + LIVE DARK @ migration 0027)**
- Entregue: ver o bloco no topo deste handoff. Fan-out cross-mercado EM CÓDIGO, N predições reais, ranking por edge (sort
  toggle cliente), reusa a view N-vias, custo controlado + visível, flag DARK. **7 commits** (flag/orquestrador/view/action/UI/
  page/ADR). Decisões de produto confirmadas com o dono (N predições reais; todos os mercados+cap; sort toggle; botão na página).

### Follow-ups LOW herdados do #175 (documentados no code-review do PR #265 — NÃO bloqueiam)
- **Linha schema-válida fora da escada parcial** (predict.ts): flag ON + escada parcial (uma linha sem book) + LLM escolhe a
  ausente → `PredictError` **após** 1 call paga (fail-closed; nunca settla errado). Fix: enum/refine do tool DINÂMICO por
  análise (só as linhas resolvidas), em vez do estático `[1.5,2.5,3.5]`.
- **Dedup de frescor por-linha numa escada parcial** (fetch-and-snapshot): linha genuinamente ausente nunca é persistida → o
  gate por-linha re-busca dentro do TTL. Limitado pelo cache in-memory de 15min e só world_cup. Fix: gate por TIME de captura
  (`max(capturedAt)`) em vez de presença por-linha.
- **Expandir cobertura das linhas extras** além de world_cup: validar `alternate_totals` por liga (live, events grátis +
  getOddsForEvent 1 crédito) → +1 liga em `OVER_UNDER_ALT.coveredLeagues` (mesma disciplina de btts/dc; ADR 0015).
- **Verificar 1 análise real flag-on em prod**: rodar over/under num jogo da Copa e conferir que o cartucho vê 1.5/2.5/3.5 e
  emite 1 rec com a linha escolhida (custa 1 crédito + 1 LLM call). Reverter o flip = 1 DML (`SET ... = false`).

## Fatiamento sugerido (UMA fatia por sessão)
1. ✅ #174 · ✅ #176 (dupla chance) · ✅ **#261 (graduação)** · ✅ **#175 + #269 (linhas extras over/under)** · ✅ **#173 PR-2 (#273, odds card N-vias ao vivo)**.
2. **PRÓXIMA — #178 sozinha** (G, cross-mercado, "melhor aposta do jogo"). ÚLTIMA fatia funcional da Fase 4.
3. Follow-ups LOW (#175) + backtest #173 AC#3/#4 — acumulam, não bloqueiam.

## Princípios inegociáveis (carregam)
- **Edge N-vias** (ADR 0018 + emenda não-partição): implícita de-vigada pelo overround do mercado COMPLETO; **POR linha** no
  multi-linha; nunca `1/odd` cru; sem `100−x` em N≥3. Partição → Σ=1; cobertura sobreposta → Σ=`impliedSumTarget`. **Zod** em
  todo output (over_under v3 valida `line ∈ {1.5,2.5,3.5}`). **predict.ts é a única porta** pro LLM (backtest = dev-only).
- **Zero `if (market === X)` fora dos registries.** Identidades permitidas: legacy-write `=== OVER_UNDER.dbMarketKey` +
  roteamento binário-congelado da view por `marketKey === 'over_under'`. Dispatch novo = campo de descriptor
  (`oddsSource`/`coveredLeagues`/`impliedSumTarget`/`candidateLines`) ou flag genérica.
- **expand-migrate-contract:** NÃO remover legado (enums, `match_odds_snapshots`, par over/under). Contract = Fase 5 (#179).
- **Paridade over/under 2.5 E 1X2** não regride (byte-idêntico: flag-OFF é o caminho de hoje; goldens v2 do prompt/user-message/
  predict/presentation/settlement intactos). Settlement só meias-linhas (nunca push).
- **Tier 3** e **provider/liga novos** AINDA exigem ADR/checklist. Linhas extras NÃO precisaram de ADR (ADR 0015 §3 antecipa
  over/under multi-linha 1.5/2.5/3.5).
- **Quota** (500/mês, ~422 restam): additional só por evento, NUNCA batch. `getSports`/`getEventsForSport` = 0 créditos.
  Extra over/under flag-on = +1 crédito/análise (escada `alternate_totals`), só world_cup.

## Flow (de altíssimo valor — pegou 24 blockers no plan-review do #175 + 5 LOW no code-review)
Two-round plan-gate adversarial multi-lente aterrado no CÓDIGO (exploração → blockers → plano → plan-review → rework → lean
re-verify) **ANTES** de codar → **validação live controlada** quando o provider tem incógnita (eventos-list grátis,
getOddsForEvent 1 crédito) → worktree isolado off `origin/main` (`--ignore-workspace`) → implementação **commit por
preocupação, verde a cada passo** (golden-freeze do 2.5 ANTES do refactor) → code-review find→verify (postado como **PR
comment**) → fixar ressalvas value-adding → merge squash `--delete-branch` com Vercel verde → confirmar prod deploy
(`gh api .../commits/<sha>/status --jq '.state'` até success; migration = ativação). 1 PR por issue. `PLAN-*.md`/`HANDOFF`
ficam fora do commit. **Decisões de produto/contrato (sourcing/quota/labels/rollout) → PERGUNTAR** (no #175: sourcing
ALL-ADDITIONAL, rollout pra todos os usuários). Subagents de contexto fresco por passo (exploração/cartucho-v3/presentation/
tests delegados; predict — o mais arriscado — feito à mão).

## Gotchas de ambiente (PROVADOS)
- **Worktree por issue** off `origin/main`: `git worktree add -b <branch> .claude/worktrees/<n> origin/main`. Toolchain:
  `bash -lc '. "$HOME/.nvm/nvm.sh"; nvm use 24; cd <wt>; corepack pnpm --config.verify-deps-before-run=false
  <install --ignore-workspace | run typecheck | run lint | exec vitest run [paths]>'`. `--ignore-workspace` SEMPRE.
  Copiar `.env.local` da raiz. Limpar: `git worktree remove --force <wt>` + `git branch -D <branch>`. **A checkout raiz está
  STALE** (`chore/neon-preview-branch-cleanup`, NÃO ancestral de main) — NUNCA codar nela. **Outras sessões concorrentes têm
  worktrees ativas** (`.claude/worktrees/250`, `/found`, `palpiteiro-114`) — NÃO mexer.
- **`.env.local` da raiz quebra `source`**. Extrair: `grep '^ODDS_API_KEY=' .env.local | cut -d= -f2-`.
- **`db:generate` offline** precisa `DATABASE_URL=postgres://u:p@localhost:5432/x` (dummy). DML via `--custom`. Enum widening
  FORÇA alargar as closed unions no MESMO commit. `ai_config` row id=1 garantida pela 0004 → flip = `UPDATE ... WHERE id=1`.
- **PRETTIER não roda em CI → NÃO `prettier --write`.** numeric do Drizzle volta string → `Number()` no boundary. pglite test
  = 1ª linha `// @vitest-environment node`. Snapshot inline: vazio + `vitest run -u`. **NULLS NOT DISTINCT** em unique exige
  PG15+ (Neon + pglite ok) + `.nullsNotDistinct()` no drizzle. Co-author: `Co-Authored-By: Claude Opus 4.8 (1M context)
  <noreply@anthropic.com>`. `pnpm-workspace.yaml` (untracked) aparece no `git status` da worktree — NUNCA commitar.
- **Vercel gate (~45s-min)** é o único check; `UNSTABLE`/pending/sem-status não-bloqueante (o que vale é o prod deploy).
  `gh` sempre `-R fernandolisboa/palpiteiro-claude`. Paths `[id]` com aspas.

## Ground truth (bater com `origin/main @ af65541e`)
- **~1121 testes verdes** (varia com merges concorrentes; #173 PR-2 += ~17). Cartuchos: over_under v2.0 **+ v3.0** +
  match_result + btts + double_chance. Migration head **0022**. `getCartridge(marketKey,{extraLines})` + `OVER_UNDER_ALT` +
  `candidateLines` + `pickBestBookmaker(params)` + `ai_config.enable_over_under_extra_lines` (=true). Dedup com NULLS NOT DISTINCT.
- **#173 PR-2 (LIVE):** `OddsView` genérico (`outcomes[]`) + `OddsCard` grid-cols-{n} + `toOddsView`/`toNwayOddsView`/
  `toMatchRowResultOdds` (`lib/view/odds.ts`) + `MatchRowView.odds` N-vias + `getLatestSelectionOddsSnapshotsForMatches`
  (best-effort, `lib/db/queries/odds-snapshots.ts`) + `PAGE_LIVE_MARKETS` (`lib/odds/live-card-markets.ts`). Golden DOM em
  `components/__tests__/odds-card-parity.golden.test.tsx`. **#178 REUSA isto** pra UI cross-mercado (a view já é N-vias).
- **Provider alternate_totals (validado live 2026-06-14):** featured `totals` traz só a linha principal (3.5 ausente);
  `alternate_totals` (additional/por-evento) traz a escada completa 1.5/2.5/3.5; custo = #markets × #regions; ~6 books cobrem
  alternate vs 14 o featured.
- **Pendência alheia à Fase 4:** PR **#91** (docs/ops Fase 2) OPEN — não é desta fase. #267 (cache-control) + #248 (Sonnet/
  remoção Fable) + #240/#241/#247 já em main (não-Fase-4).
- Re-checagem Brasileirão pós-Copa = +1 linha em `coveredLeagues` (btts/dc E over_under_alt; ADR 0015) — abrir issue se/quando voltar.
- Reescrever este handoff ao fim de cada fatia, atualizando o "restante".
