# PLAN — #180 CLV (closing line value), companheira do Yield

> Untracked — NUNCA commitar (como PLAN-*.md/HANDOFF-*.md).
> Última da cauda do pivot (épico #183). Aterrado no código real (refs verificadas).

## Decisões do dono (AskUserQuestion, 2026-06-15)
1. **Fórmula:** mostrar OS DOIS — razão-de-odds % E delta de prob no-vig (pp).
2. **Cadência/quota:** cron a cada 30min, captura jogos com KO em ≤90min.
3. **Rollout:** flag `enableClvCapture` em ai_config, **default OFF** (display sempre on).

## Princípio de arquitetura (NÃO-produto, decidido)
- **SEM migration de dados de CLV.** CLV é computado **read-time** das
  `selection_odds_snapshots` (append-only) — respeita "nunca mutar predição
  passada", board enxuto, reusa o padrão DISTINCT ON existente.
- **Closing line = snapshot com max(capturedAt) na janela `[KO−W, KO]`**; **null**
  se não houver snapshot genuíno perto do KO (honesto, [[prefer-skip-over-silent-wrong-settle]]).
  `W = CLV_CLOSING_WINDOW_MS` (~2h: cobre o lookahead 90min + frescor 30min, exclui
  snapshots de análise de horas/dias antes).
- **O cron só chama o `ensureOddsSnapshotsFresh` já existente** perto do KO; o gate
  de frescor de 30min naturalmente produz um snapshot a ≤30min do KO. Sem `force`,
  sem novo caminho de escrita de odds.
- **ÚNICA migration:** `0029` adiciona `ai_config.enableClvCapture boolean default false`
  (espelha `enableBestBetFanOut`, migration 0028-style). Nada de coluna de CLV.

## Fórmulas (read-time, puras)
Dados por predição non-pass: `oddRec`=oddAtRecommendation, `recImpliedPct`=impliedProbPct
(no-vig, já ×impliedSumTarget×100), e do snapshot de fechamento da seleção escolhida:
`oddClose`, `overroundPctClose` (= (Σ1/odd − 1)×100). `impliedSumTarget` vem do descriptor (1 default; dupla chance=2).
- **CLV% (razão de odds)** = `(oddRec/oddClose − 1) × 100`. Positivo = peguei preço melhor que o fechamento. Precisa só de oddRec+oddClose.
- **prob no-vig de fechamento** = `((1/oddClose)/(1+overroundPctClose/100)) × 100 × impliedSumTarget`.
- **CLV Δ no-vig (pp)** = `probNoVigClose − recImpliedPct`. Precisa de oddClose+overroundPctClose+recImpliedPct+impliedSumTarget.
- Cada um é **null independente** quando faltar insumo (oddRec null em pass; recImpliedPct null em rows antigas → só o Δ no-vig fica null, o CLV% segue).

## Refs verificadas (first-hand)
- `selectionOddsSnapshots` (schema.ts 376–411): odd/overroundPct/capturedAt; dedup UNIQUE(match,market,selection,capturedAt,bookmaker,marketParams) NULLS NOT DISTINCT. **Sem coluna "closing".**
- `predictions` (252–307): oddAtRecommendation, impliedProbPct (nullable), selectionId (NULL em pass), recommendation ('pass'|key), marketParams {line}, marketId.
- `matches.kickoffAt` (210, indexado), status enum (scheduled/live/finished/postponed/cancelled).
- `ensureOddsSnapshotsFresh(match,{now,markets})` (fetch-and-snapshot.ts 53): gate 30min; featured=1 crédito/liga (cobre todos os matches da janela 7d); additional(btts)=1 crédito/evento. capturedAt=now.
- `getLatestSelectionOddsSnapshots*` (odds-snapshots.ts): DISTINCT ON (selection) desc(capturedAt); line-aware via `market_params->>'line'`.
- ai-config: `getEnableBestBetFanOut()`/`getEnableOverUnderExtraLines()` lêem `aiConfig.enableX` (id=1, default false). Padrão a espelhar.
- cron settle-predictions/route.ts: runtime nodejs, dynamic force-dynamic, Bearer CRON_SECRET fail-closed 401, try/catch → JSON summary, console.error JSON. Padrão a espelhar.
- vercel.json: array `crons` (settle 0 9, spend-alert 0 23, sync-fixtures 0 */6).
- odds-api.ts quotaHeaders: `x-requests-remaining`/`x-requests-used` (linhas 40–42); `/sports` e `/events` NÃO contam quota (338).
- implied-probability.ts: `overround = Σ1/odd − 1` (FRAÇÃO). select-bookmaker grava `overroundPct = overround×100`. impliedProbPct (predict.ts deriveImplied) = probs[i]×100×impliedSumTarget (no-vig normalizado).
- market-descriptor.ts: `impliedSumTarget?` (default→1; dupla chance=2, linha 165).
- Migration mais nova: **0028** → próxima **0029**.
- dashboard: Yield em `lib/dashboard/kpis.ts:computeDashboardKpis()` (filtra settled won/lost), `computeSegmentedKpis()` por marketKey; view `lib/view/dashboard.ts` (RateView); componentes `components/dashboard/market-segments.tsx` (ruler+stake bands) e `prediction-detail.tsx` (outcome). Queries em `lib/db/queries/dashboard.ts` (getUserDashboardRows, getPredictionDetailForUser).

## Entregáveis (UMA PR, fecha #180)

### A. Flag (migration 0029)
- schema.ts: `enableClvCapture: boolean().notNull().default(false)` em aiConfig (com comentário no padrão #175/#178).
- `pnpm db:generate` → migration 0029 (NÃO db push). Verificar nº (storm: se outra PR pegar 0029, renumerar [[concurrent-storm-migration-renumber]]).
- ai-config.ts: `getEnableClvCapture()` (espelha getEnableBestBetFanOut).
- (Opcional, se /admin/settings já renderiza as outras flags) toggle de UI no mesmo padrão. Decidir na impl; não é AC.

### B. Captura closing line (forward-capture)
- `lib/db/queries/predictions.ts`: `getNonPassPredictionsNearKickoff({now, lookaheadMs})` → matches DISTINCT com ≥1 predição non-pass (recommendation!='pass' AND selectionId NOT NULL), kickoffAt em (now, now+lookahead], status IN (scheduled,live). Retorna matchId + set de marketKeys non-pass por match (só os mercados a buscar — economia).
- `lib/odds/closing-line.ts`: `captureClosingLines({now})`:
  1. `if (!await getEnableClvCapture()) return {enabled:false,...}` (ZERO quota).
  2. candidatos → por match: carregar DbMatch, resolver descriptors dos marketKeys (registry market→descriptor; mesmo usado por predict/fan-out), `ensureOddsSnapshotsFresh(match,{markets:descriptors,now})`.
  3. summary {enabled, consideredMatches, marketsFetched, skipped, errors, quotaRemaining, quotaUsedDelta} + console.log JSON (scope "capture_closing_odds"). Quota: ler x-requests-remaining/used (surface do odds-api) antes/depois.
- `app/api/cron/capture-closing-odds/route.ts`: espelha settle-predictions (Bearer, try/catch, JSON). maxDuration=60.
- vercel.json: `{path:"/api/cron/capture-closing-odds", schedule:"*/30 * * * *"}`.

### C. CLV puro
- `lib/odds/clv.ts`: `clvOddsRatioPct`, `noVigProbPct`, `clvNoVigDeltaPp`, e `computeClv({oddRec,oddClose,overroundPctClose,recImpliedPct,impliedSumTarget})→{oddsRatioPct,noVigDeltaPp}` (nulls graciosos). Number() no boundary do caller; aqui recebe number|null.

### D. Read query de fechamento
- `lib/db/queries/odds-snapshots.ts` (ou clv-snapshots.ts): `getClosingSnapshotsForPredictions(rows[], windowMs)` → Map<predictionId,{oddClose,overroundPctClose,capturedAt}>. UMA query: join snapshots↔matches, DISTINCT ON (matchId,marketId,selectionId,marketParams) desc(capturedAt), WHERE capturedAt<=kickoffAt AND capturedAt>=kickoffAt−windowMs AND matchId IN(...). JS-map por (matchId,marketId,selectionId,line). `CLV_CLOSING_WINDOW_MS` constante (~2h).

### E. Dashboard
- dashboard.ts: getUserDashboardRows/getPredictionDetailForUser também retornam impliedProbPct, selectionId, marketParams.line, kickoffAt, marketKey (já tem). Closing via follow-up batched `getClosingSnapshotsForPredictions` na camada derive (on-grain com deriveDashboardView).
- kpis.ts: `computeClv(rows)` → {oddsRatio:Rate, noVigDelta:Rate} sobre settled non-pass com closing; incluir no computeSegmentedKpis (por mercado). Respeitar dedup keepLatestPerMatch.
- view/dashboard.ts: clv (dois números) em DashboardKpiView, MarketSegmentView, PredictionDetailView. Formatters: CLV% sinalizado (formatEdge-like "+7.7%"); Δ no-vig sinalizado pp ("+3.2pp"). impliedSumTarget resolvido por marketKey→descriptor no boundary.
- market-segments.tsx: CLV (ambos) por mercado ao lado do Yield.
- prediction-detail.tsx: CLV (ambos) por predição na seção outcome/prediction (após 'lucro'/edge). null → "—" + tooltip "sem closing line capturada".
- (Opcional) KpiCards agregado global de CLV (barato; AC pede por-mercado+por-predição, global é bônus).

### F. Quota medida/documentada (AC)
- Cron loga x-requests-remaining/used por run (surface do odds-api).
- Doc: `docs/ops/` (curto) — modelo de pior caso: por run 30min, ≤1 crédito por (liga×mercado featured) com KO-próximo non-pass (frescor-gated) + 1 crédito/evento btts. Mensal ≈ dezenas (uso pessoal). Flag OFF = zero. Documentar também no corpo da PR e no fechamento de #180.

### G. Testes (sintéticos — sem teste-gate de "liga voltar")
- clv.test.ts (puro: razão, no-vig, nulls, Number).
- closing-line.test.ts (flag OFF→zero; filtro candidatos; exclui pass; counts) com ensureOddsSnapshotsFresh+getEnableClvCapture mockados.
- pglite: getNonPassPredictionsNearKickoff (janela/pass/settled); getClosingSnapshotsForPredictions (janela/latest/line-aware/null fora-janela).
- route test (401 sem/secret errado; happy path mockado).
- kpis computeClv + view mapper.

## Invioláveis (checklist)
- [ ] SEM backtest; tudo AFK; sem teste-gate "quando a liga voltar".
- [ ] Sem `fetch` fora de lib/providers; predict.ts única porta LLM; output Zod (N/A aqui — sem LLM novo).
- [ ] Drizzle numeric→string: Number() no boundary de todo cálculo de CLV.
- [ ] commenceTime segundo-precisão: reusa odds-api (já tratado); nenhum fetch novo cru.
- [ ] Pass: zero captura (filtro na query) + CLV null no read.
- [ ] NUNCA commitar PLAN-*/HANDOFF-*/pnpm-workspace.yaml/.playwright-mcp.

## Incorporação do plan-review (round 1) — deltas que VALEM
1. **Quota mensurável (era blocker):** `getOddsForSport/Event` descartam o quota.
   Adicionar recorder module-level `getLastOddsApiQuota()` no ponto onde `logCall`
   já extrai (`lib/providers/http/*` ou odds-api). ZERO call extra. `logCall` já loga
   `quota_monthly_used` por call = a telemetria "medida"; o recorder dá a linha de
   summary do cron. Summary inclui quotaMonthlyRemaining/Used do último fetch (null se tudo cache-hit).
2. **Janela de fechamento = 40min, NÃO 2h.** `CLV_CLOSING_WINDOW_MS = 40*60*1000`.
   "Closing = último snapshot em [KO−40min, KO]; null fora disso." Exclui snapshots de
   análise velhos (honesto). Reframe: o gate de 30min + cron 30min faz o último capture
   pré-KO cair em ~[KO−30min, KO]; a janela de 40min o pega e descarta análises >40min antes.
   SEM coluna de source-tag (mantém a snapshot table append-only/enxuta). Edge cases documentados:
   análise <40min do KO conta como closing (ok, é near-close); cron OFF → CLV null (honesto).
3. **Read query SEM DISTINCT-ON em jsonb (era blocker).** Buscar as rows da janela pra
   os (matchId,marketId,selectionId) candidatos (filtro de linha por `market_params->>'line'`
   text), ORDER BY capturedAt DESC, e **reduzir em JS** ao último por (match,market,selection,line).
   Espelha o padrão line-aware existente (odds-snapshots.ts 99/246). Fetch só do candidato escolhido (1 row), overroundPct é full-market por construção (write atômico).
4. **DashboardRow estendido (era blocker).** getUserDashboardRows + tipo DashboardRow ganham
   selectionId, marketId, marketParams(line), kickoffAt, impliedProbPct. Closing buscado
   **pós-dedup** (keepLatestPerMatch) na camada derive, por predictionId. computeClv recebe rows enriquecidas.
5. **Captura agrupada (anti-redundância de quota).** featured → 1 call por (liga, descriptor)
   (ensureOddsSnapshotsFresh já escreve pra TODA a liga); additional(btts/dc) → 1 call por (match, descriptor).
   getNonPassPredictionsNearKickoff retorna (matchId, league, marketKey[]) → agrupar no captureClosingLines.
6. **Sinal: positivo = bateu o fechamento (BOM) nos DOIS.** CLV% = (oddRec/oddClose−1)×100;
   Δ no-vig = probNoVigClose − recImpliedPct. (oddRec>oddClose ⟺ peguei preço melhor ⟺ +; prob de
   fechamento subiu ⟺ mercado concordou mais com meu lado ⟺ +.) Documentar em tooltip/PR.
7. **Puras defensivas:** retornam {oddsRatioPct:number|null, noVigDeltaPp:number|null}; odd≤1/null→null, nunca throw.
8. **Convenção best-vs-best** (book da rec ≠ book do fechamento) — documentar como intencional ("seu melhor preço vs melhor preço de fechamento", não house-vs-house).
9. **Sem toggle de UI** pra enableClvCapture (consistente: enableBestBetFanOut/enableOverUnderExtraLines também são DB-flip only). Documentar no comentário do schema + PR.
10. Verificado: fórmula no-vig é EXATAMENTE consistente com impliedProbPct (ambos (1/odd)/Σ×100×impliedSumTarget, Σ=1+overroundPct/100). dupla chance (impliedSumTarget=2) confere (~63%).

## Critério de saída
CLV (ambos) por predição + agregado por mercado no dashboard+detail; quota medida/documentada; zero captura pra pass; build+lint+typecheck+test verdes; PR merge. **Depois: fechar épico #183** + atualizar memória [[pivot-multimercado-phase-state]].
