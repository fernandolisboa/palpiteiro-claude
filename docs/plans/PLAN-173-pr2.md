# PLAN — #173 PR-2 · Odds card N-vias ao vivo (over/under 2.5 + 1X2) + chips N-vias
## v2 — reworked após plan-gate round 1 (6 lentes; 6 blockers + risks resolvidos)

> Worktree: `.claude/worktrees/173` (branch `feat/173-odds-card-n-vias`, off `origin/main @ 460ff34d`, migration head 0022).
> Doc FORA do commit. Migration 0014 seeda match_result sortOrder home=0/draw=1/away=2; 0009 over/under 0/1.

## Escopo (decisões do usuário travadas)
1. **Quota:** SIM — match page passa `markets:[OVER_UNDER, MATCH_RESULT]` → h2h batch ao vivo, pré-análise, TODAS as ligas. +1 crédito de liga/30min/liga stale.
2. **Card detalhe:** EMPILHAR. Card over/under (byte-idêntico) + NOVO card 1X2 (3 col) abaixo, server-rendered, Mobile+Desktop.
3. **Chips home:** N-vias. Regra "PREFERE 1X2 (h2h capturado) senão over/under senão sem odd". Um mercado/linha.

## NÃO-escopo (PR mention)
- btts/double_chance ao vivo (additional/world_cup/dc Σ=2). Card = featured Σ=1 só. Switcher/tabs. Settlement/analysis/predict/cartuchos INTOCADOS. Backtest AC#3/#4 PAGO não roda.

## Invioláveis
- **Paridade over/under byte-idêntica** via GOLDEN full-string `toBe` capturado ANTES do refactor (deviar do idiom substring do repo DE PROPÓSITO). Sobre markup NORMALIZADO (strip de ids do Radix `useId`) p/ não flakar em id churn, pinando todo o resto byte-a-byte.
- **ZERO `if(market===X)` fora dos registries.** Exceção sancionada: roteamento de FONTE na view (over/under=tabela legada vs 1X2=selection_odds_snapshots) + a política de display "prefere 1X2" (source-routing, não dispatch de normalização) — comentada como tal.
- **presentation.ts NÃO importa market-descriptor** (pin presentation.test.ts:167-179). **odds.ts (toNwayOddsView) usa SÓ getMarketPresentation + computeMarketImpliedProbabilities — NUNCA getDescriptor/market-descriptor** (odds.ts não tem pin → CI não pega; match_result é Σ=1, não precisa de impliedSumTarget).
- **Card/chip lê via reader BEST-EFFORT** (degrada por omissão), NUNCA o `getLatestSelectionOddsSnapshots` que `throw`a (crasharia o server render). O GATE de frescor DENTRO de `ensureOddsSnapshotsFresh` mantém o hard-fail atual p/ match_result (pre-existente, write atômico ⇒ parcial impossível) — NÃO mexer.
- numeric=string→`Number()` no boundary. expand-migrate-contract (nada legado removido).

## Design central — componente unificado + parity traps explícitos
- **`OddsView` genérico:** `{ marketLabel, outcomes: {label, odd, pct}[], bookmaker, overround, updatedAgo }`.
- **`OddsCard`** renderiza grid estático por N (`{2:"grid-cols-2",3:"grid-cols-3"}[n]`). **CONTRATO POR-CÉLULA (parity trap — blocker):**
  - Cell i: `border-r border-border-subtle` SE `i < n-1`, senão sem border. (cell 0 over/under tem border-r; última não.)
  - pct span da cell `i===0`: className = `"flex items-center gap-1 " + BASE` E renderiza o HelpHint `prob-implicita`. Cells `i>0`: className = `BASE` (sem `flex items-center gap-1`), SEM HelpHint. (BASE = `font-mono text-[10.5px] tabular-nums text-muted-foreground`.) Dirigir AMBOS (className + HelpHint) por `i===0` — NÃO unificar a classe.
  - Footer: bookmaker + overround + HelpHint `overround` (incondicional, n≥2) — INTOCADO.
  - null-state ("Odds indisponíveis") intocado.
- **Branch binário-congelado vive na VIEW:** `toOddsView(binarySnapshot)` (over/under, frozen: `computeImpliedProbabilities` + labels over_under) vs `toNwayOddsView(snapshot, marketKey, now)` (genérico). Ambos emitem o shape genérico.
- **`toNwayOddsView` RECOMPUTA probs+overround** via `computeMarketImpliedProbabilities(odds.map(Number))` — IGNORA o `overroundPct` armazenado (string em PERCENT `.toFixed(2)`; usá-lo com `*100` infla 100x). Formata idêntico a toOddsView: `formatPct(prob*100,{decimals:1})`, `formatPct(overround*100,{decimals:1})`. (over/under SEGUE em computeImpliedProbabilities; N=2 é bit-exato com a N-ária — provado.)

## Chips
- **`MatchRowView.odds`** → `{ outcomes: { label, odd }[] } | null` (label = `selectionLabel(key)` curto; ordem por sortOrder). Chip itera N spans `{label}{" "}{odd}` (whitespace `{" "}` preservado; key={i} não-renderizante → n=2 byte-idêntico, confirmado).
- `match-row.tsx` (mobile) + `upcoming-matches-desktop.tsx` (`"use client"`, só strings serializáveis) iteram outcomes.
- **`ToMatchRowArgs.matchResultOdds?` OPCIONAL** (`?: {selections:{key,odd}[]} | null`, default null) — só app/page.tsx passa; heroView + 6 sites de match.test.tsx compilam sem mudar. **8 call sites de toMatchRowView:** app/page.tsx (passa), app/match/[id]/page.tsx heroView (não passa), match.test.tsx:29,42,54,70,84,99 (não passam). toMatchHeroView herda a prioridade (hero não tem chip → inócuo; confirmar hero NÃO recebe matchResultOdds).
- **`toMatchRowOdds`** aplica prioridade: `matchResult ? 1X2-outcomes : overUnder ? ou-outcomes : null`. Comentar como política de display (única market-literal sancionada na view).

## Reader novo (best-effort, batch, ordenado) — C3
`getLatestSelectionOddsSnapshotsForMatches(matchIds: string[], dbMarketKey: string): Promise<Map<string, { bookmaker; capturedAt; overroundPct; selections: {key, odd}[] }>>` em `lib/db/queries/odds-snapshots.ts`. **Função SEPARADA (não reusa o corpo que throw-a).** Mecânica:
- **Projeção como 2º ARG de `selectDistinctOn`** (NÃO um `.select()` chain — assinatura Drizzle `selectDistinctOn(on, fields)`): `db.selectDistinctOn([snap.matchId, snap.selectionId], { matchId: snap.matchId, key: marketSelections.key, sortOrder: marketSelections.sortOrder, capturedAt: snap.capturedAt, bookmaker: snap.bookmaker, overroundPct: snap.overroundPct, odd: snap.odd }).from(selectionOddsSnapshots).innerJoin(marketSelections, eq(snap.selectionId, marketSelections.id)).where(...).orderBy(snap.matchId, snap.selectionId, desc(snap.capturedAt))` (`snap` = selectionOddsSnapshots).
- **`ORDER BY matchId, selectionId, desc(capturedAt)`** — leading cols = DISTINCT ON cols (Postgres exige). **`sortOrder` é COLUNA SELECT ordenada em JS após agrupar — NUNCA no leading ORDER BY** (quebraria DISTINCT ON).
- `WHERE marketId = (resolveMarketCatalog(dbMarketKey).marketId) AND matchId IN (…)`. **SEM predicado de `line`** → uso match_result ONLY (no-line). Comentário + guard: caller over/under Frankenstein-mergearia 1.5/2.5/3.5 sob o mesmo selectionId.
- JS: agrupa por matchId; **best-effort `continue` (OMITE)** o match se (a) `count !== keyById.size` (incompleto), (b) capturedAt/bookmaker divergem (incoerente), (c) selectionId órfão. Ordena selections por sortOrder. `keyById.size` de UMA chamada `resolveMarketCatalog` (só p/ tamanho). Retorna Map só de matches completos+coerentes.
- Usado por: home (todos matchIds) E card detalhe (`[match.id]`).

## Mudanças por arquivo
- `lib/view/types.ts`: `OddsView` genérico (outcomes[]); `MatchRowView.odds` → `{outcomes:{label,odd}[]}|null`.
- `lib/view/odds.ts`: `toOddsView` (over/under frozen, shape novo); NOVO `toNwayOddsView` (recompute, getMarketPresentation only); `toMatchRowOdds` prioridade. **NENHUM import de market-descriptor.**
- `lib/view/match.ts`: `ToMatchRowArgs.matchResultOdds?` opcional default null; `toMatchRowView` aplica prioridade.
- `lib/db/queries/odds-snapshots.ts`: NOVO `getLatestSelectionOddsSnapshotsForMatches` (best-effort).
- `components/odds-card.tsx`: grid-cols-{n} + contrato por-célula (acima).
- `components/match-row.tsx` + `components/upcoming-matches-desktop.tsx`: chip itera outcomes.
- `app/match/[id]/page.tsx`: `import { OVER_UNDER, MATCH_RESULT } from "@/lib/odds/market-descriptor"`; const `PAGE_LIVE_MARKETS=[OVER_UNDER, MATCH_RESULT]`; `ensureOddsSnapshotsFresh(match,{markets:PAGE_LIVE_MARKETS})`; lê 1X2 via `getLatestSelectionOddsSnapshotsForMatches([match.id],"match_result").get(match.id)` → `toNwayOddsView` → `matchResultOddsView: OddsView|null`. **Threading:** add `matchResultOddsView` ao type `Common` (l.196-214) + destructure em MobileMatch + DesktopMatch + AMBAS invocações em MatchPage (l.159-191) + render 2º `<OddsCard view={matchResultOddsView}/>` abaixo de cada card (l.256 mobile, l.382 desktop). heroView NÃO recebe matchResultOdds.
- `app/page.tsx`: chama `getLatestSelectionOddsSnapshotsForMatches(matchIds,"match_result")` no Promise.all ao lado do binário; **merge por match:** `mr.get(id) ? {matchResultOdds: mr} : legacy.get(id) ? {odds: ou} : ambos null`; passa ao toMatchRowView.
- **MatchHero** confirmado: não referencia m.odds (grep vazio) — nada a mudar.

## Sequência de commits (verde a cada passo)
- **C1 — golden-freeze (só testes):** helper `normalizeMarkup(html)` (strip ids Radix/useId). Captura FULL-STRING `toBe` (normalizado) do `OddsCard` over/under (header+2 cells+footer incl. overround HelpHint) + chip over/under mobile + desktop. VERDE.
- **C2 — generaliza shape+componente (over/under-only):** `OddsView` genérico + `toOddsView` reescrito + `OddsCard` grid-cols-{n} (contrato por-célula). Atualiza INPUT dos goldens p/ shape novo; BYTES esperados (normalizados) INALTERADOS. VERDE.
- **C3 — reader batch best-effort** + pglite test. VERDE.
- **C4 — card 1X2 detalhe:** `toNwayOddsView` + page (PAGE_LIVE_MARKETS, threading Common, 2º card). Tests: toNwayOddsView (scaling pinado), OddsCard n=3, **markets arg = [OVER_UNDER, MATCH_RESULT]** (unit do const PAGE_LIVE_MARKETS), degrade quando 1X2 null. VERDE.
- **C5a — generaliza shape do chip (over/under-only):** `MatchRowView.odds`→outcomes[]; match-row + upcoming-desktop iteram; atualiza INPUT dos chip-goldens (bytes inalterados); fixtures `upcoming-matches.test.tsx:19-26` + `match.test.tsx` (mantém :142-143 1.85/1.95; **remove/reescreve a regex morta :127 `>O<`**). VERDE.
- **C5b — chip 1X2:** `toMatchRowOdds` prioridade + home merge + chip 1X2 mobile+desktop. Unit toMatchRowOdds 3 branches (1X2 / over-under / ambos-ausentes→null). VERDE.

## Plano de testes (com idiomas do repo)
- Goldens (C1, frozen): full-string `toBe` sobre markup normalizado — OddsCard over/under; chip mobile; chip desktop. (Deviar do substring idiom de propósito.)
- C3 pglite (`// @vitest-environment node` 1ª linha + .batch shim): **LÊ** match_result seedado pela migration 0014 (sortOrder 0/1/2) — NÃO hand-seeda (markets_key_unique). Asserts: ordem = [home,draw,away] (não alfabético/UUID); match incompleto/incoerente OMITIDO; multi-match.
- C4: toNwayOddsView (triple 1X2 conhecido → pcts+overround esperados, pin de SCALING, Number coercion, labels, ordem); OddsCard n=3; const PAGE_LIVE_MARKETS == [OVER_UNDER,MATCH_RESULT]; page degrade (1X2 null → não empilha).
- C5: toMatchRowOdds 3 branches; chip 1X2 mobile+desktop (3 spans). Fixtures atualizadas.
- **Fora do blast radius (notar):** analysis-scenarios.test.tsx (OutcomeView/analysis path, NÃO OddsView) — OddsCard refactor não toca AnalysisScenarios. match-row-finished-prediction.test.tsx (odds:null) — válido nos 2 shapes. odds.ts tests são NET-NEW (sem arquivo a migrar).

## Quota / gotchas
- +1 crédito liga/30min/liga stale na match page. Home só LÊ (chips 1X2 = last-known de visitas anteriores que aqueceram a liga; mesma semântica latest-not-fresh do chip over/under atual — não é bug de frescor; PR mention).
- Toolchain worktree `--ignore-workspace`; NÃO prettier --write; NÃO commitar PLAN/HANDOFF/pnpm-workspace.yaml. Vercel = único check; prod deploy = verdade. `gh -R fernandolisboa/palpiteiro-claude`.

## Plan-gate round 1 — blockers resolvidos (rastreio)
1. Golden full-string `toBe` (não substring) → C1 + normalizeMarkup.
2. pct-span class asymmetry (cell 0 `flex items-center gap-1`+HelpHint; i>0 plain) → contrato por-célula.
3. `matchResultOdds?` OPCIONAL (8 call sites enumerados) → match.ts.
4. Threading `matchResultOddsView` por Common+Mobile+Desktop+invocações+2 render sites → C4.
5. Test do markets arg ([OVER_UNDER,MATCH_RESULT]) via const PAGE_LIVE_MARKETS → C4.
6. Reader: 1 fonte de catálogo, sortOrder=coluna SELECT ordenada em JS (nunca leading ORDER BY), projeção explícita, no-line guard → C3.
