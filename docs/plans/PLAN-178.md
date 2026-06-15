# PLAN-178 (FINAL) — "Modo melhor aposta do jogo" (fan-out cross-mercado EM CÓDIGO)

> Scratch de planejamento + spec de implementação. **FORA do commit**. Issue #178. Última fatia FUNCIONAL da Fase 4.
> Base: `origin/main @ 663953da` (passkey #275 entrou após af65541e; toca só `db/schema.ts` +tabela `authenticators`).
> **Migration head = 0023** → este PR adiciona **0024 (expand: coluna+getter) + 0025 (enable DML)**, geradas contra o
> checkout REAL pós-passkey (NÃO o explore worktree). Plan-gate: 10 blockers + 20 majors resolvidos; 1 correção de
> prosa pós-rework (§2 audiência) aplicada abaixo. Worktree de impl: `.claude/worktrees/178` (branch
> `feat/178-best-bet-fan-out`, off origin/main, deps instaladas, typecheck baseline verde).

## Decisões de produto LOCKED (usuário, 2026-06-15)
- **D-A Persistência = N predições REAIS** (cada mercado → predict(), logada, conta no seu segmento; keepLatestPerMatch
  por (matchId,marketKey) → zero dupla contagem; sem flag de yield; predict() é a única porta, não deletar).
- **D-B Escopo = todos os mercados ativos (audience ∩ liga) com CAP.**
- **D-C Ranking = sort toggle no CLIENTE**, 3 modos: **edge% (default)**, **EV**, **edge×confiança**. ⚠️ **EV
  superseded**: o plan-gate provou que `edge×odd` ≠ o EV exibido em cada card (que é `computeEvPerUnit =
  (conf/100)·odd − 1`, scenario.ts:24). Pra a ordenação BATER com o número que o card mostra, o modo "EV" ordena
  por `computeEvPerUnit` (o MESMO EV/unidade já renderizado). Mais fiel à intenção do usuário ("ordenar por EV") que
  `edge×odd`. Mencionar no PR. Se o usuário insistir em `edge×odd`, renomear o toggle (não "EV").
- **D-D UI = botão na página de detalhe do jogo** → best destacada + as demais ranqueadas, reusa AnalysisResult/AnalysisScenarios.

## Defaults LOCKED (sem objeção)
- Rate-limit: **1 slot por RUN** (último gate antes do spend). Flag reversível `enable_best_bet_fan_out`. Falha
  parcial = best-of-successful + erro por mercado. Custo visível: `llmCalls = nº entries com sucesso`.

## ⚠️ CORREÇÃO de audiência (re-verify blocker — DEFINITIVA, verificada em 663953da)
`marketsForAudience`: comum → `is_active AND is_graduated`; admin → `is_active` (inclui não-graduados). Migration
**0019 (#261)** graduou match_result/btts/double_chance → **TODOS os 4 candidatos são visíveis a TODOS os usuários**.
Logo (NÃO "admin-only"):
- **Qualquer usuário, non-WC:** over_under + match_result (ambos universais) = **2 candidatos** → CTA RENDERIZA.
- **Qualquer usuário, WC:** + btts + double_chance = **4 candidatos**.
- Admin só difere por ver mercados não-graduados — dos quais NENHUM está hoje no caminho de candidatos.
- Os números de candidatos/créditos são **audience-agnósticos**. Os guardrails de custo (rate-limit último gate 1
  slot/run + MAX_FANOUT_MARKETS + MAX_ADDITIONAL_FETCHES) valem pra TODOS. O gate da CTA `selectableMarkets.length
  > 1` esconde só ligas genuinamente single-candidate (nenhuma hoje, pois over_under+match_result são universais).

---

## 0. Shape (resumo)
Nova action `analyzeBestBet` (par de `analyzeMatch` em `app/actions/predictions.ts`) com gate ladder REORDENADO
(rate-limit é o ÚLTIMO gate antes do spend). Candidatos = `marketsForLeague(await marketsForAudience(isAdmin),
match.league)`. Cap `MAX_FANOUT_MARKETS` retendo Tier-1 (over_under, match_result). Lê AMBAS as flags
(`enable_best_bet_fan_out` + a pré-existente `enable_over_under_extra_lines`). Resolve `extraLines` UMA vez por
candidato no `FanOutMarket[]`; deriva os descriptors de pré-aquecimento dos MESMOS records; pré-aquece cada
descriptor additional INDEPENDENTE (try/catch). Chama `lib/ai/best-bet.ts#runFanOut()` SERIAL → `predict()` por
candidato (best-of-successful, TODO erro capturado por-mercado). Monta `BestBetView` lendo os números OFF do row que
predict() retornou. Retorna `{ok:true, view}` só se ≥1 sucesso (all-fail → `{ok:false}`). Painel cliente novo
renderiza best + as demais com sort toggle 3-modos, reusando `AnalysisResult` (NUNCA `OddsCard`). Gated pela flag
(default false); flag-off → CTA não renderiza E action curto-circuita ANTES do incremento do rate-limit.
`analyzeMatch` INTOCADO (`resolveExtraLines` é helper NOVO, não adotado por analyzeMatch neste PR).

Invioláveis honrados: predict() única porta (orquestrador chama predict() N×, nunca SDK — pinado por teste); edge
de-vigado dentro de predict()/view (ranking LÊ os mesmos números que os cards mostram); Zod dentro de cada
predict(); zero `if(market===X)` (candidatos data-driven via catálogo+descriptors; `resolveExtraLines`
descriptor-driven); keepLatestPerMatch dedup; golden DOM over/under-2.5 + 1X2 intocado (painel reusa
AnalysisResult, nunca OddsCard).

## 1. Orquestrador + action
- **`lib/ai/best-bet.ts` (novo):** `MAX_FANOUT_MARKETS=6`; `FanOutMarket={marketKey,extraLines}`;
  `FanOutOutcome = {ok:true,marketKey,result:PredictResult} | {ok:false,marketKey,message}`;
  `runFanOut(base, markets: FanOutMarket[], mapError)` — loop SERIAL, `predict({...base, marketKey, extraLines})`
  por mercado em try/catch capturando TODO erro (PredictError E inesperado) → nunca descarta irmão já pago. Nunca
  toca SDK. `capCandidates(candidates, max)` puro: se ≤max retorna; senão SEMPRE mantém Tier-1 (os 2 com
  `coveredLeagues:undefined` em ALL_DESCRIPTORS) + preenche resto em ordem determinística. `MAX_ADDITIONAL_FETCHES=4`.
- **Serial (não Promise.all):** neon-http sem `db.transaction`/sem `.returning()` em batch; N pequeno; cap = teto de
  spend concorrente; cache in-memory de odds só ajuda (featured 1×). `export const maxDuration = 300` na rota host.
- **`analyzeBestBet` gate order (LOAD-BEARING):** matchId/uuid → auth → access → **flag re-check (`getEnableBestBetFanOut`)
  → {ok:false} se off** → getMatchById → analisabilidade → isAdmin/modelOverride → candidatos
  (`marketsForLeague(await marketsForAudience(isAdmin), league)`) → `capCandidates` → **empty guard → {ok:false} se 0** →
  `extraLinesEnabled = await getEnableOverUnderExtraLines()` → build `fanOut = candidates.map(c=>({marketKey:c.key,
  extraLines: resolveExtraLines(c.key, league, extraLinesEnabled)}))` → **`checkAnalysisRateLimit` (ÚLTIMO gate, 1×)** →
  pré-aquece additional (por-descriptor try/catch) → `runFanOut(...)` → `toBestBetView` (+`getAiCallById` por sucesso) →
  **all-fail (`entries.length===0`) → {ok:false}** → `revalidatePath(/match/[id]) + revalidatePath("/")` → `{ok:true,view}`.
  `friendlyMessageFromUnknown` server-side (envolve `friendlyMessage` p/ PredictError).

## 2. Pré-aquecimento de odds + créditos (flag-conditional)
- Deriva o set do MESMO `fanOut`: `additionalDescriptors = fanOut.map(m=>getCartridge(m.marketKey,{extraLines:m.extraLines})
  .descriptor).filter(d=>d.oddsSource==='additional')` — byte-idêntico ao que predict() resolve (pinado por teste).
- Pré-aquece **cada** descriptor: `ensureOddsSnapshotsFresh(match,{markets:[d]})` em try/catch (ele HARD-THROWS em seed
  faltante: fetch-and-snapshot.ts:154-160,232-240) → throw vira `BestBetMarketError` daquele mercado, não aborta os outros.
  Assert `additionalDescriptors.length <= MAX_ADDITIONAL_FETCHES`; loga a contagem/run.
- Featured (over_under 2.5 + match_result h2h) NÃO precisam pré-aquecer (predict() resolve via featured; página já aqueceu).
- **Créditos/run:** non-WC = 0. WC extra-lines OFF (default) = btts+double_chance = **≤2**. WC extra-lines ON =
  +over_under_alt = **≤3**. Cada um pode ser no-op se fresco (<30min). NUNCA batch de liga.
- **AC#2 custo:** `llmCalls = entries.length` (pago de fato); `unavailableMarkets = errors.length` (inclui rejeições
  pré-spend que NÃO pagaram Anthropic — não afirmar "predict já logou spend" pra erro capturado).

## 3. View/return + ranking (números = os que o card mostra)
- Por sucesso: `AnalysisView` via o MESMO `toAnalysisView(...)` shape do analyzeMatch (lê `aiCall` via
  `getAiCallById(result.prediction.aiCallId)`). SEM mudar analysis.ts/odds.ts/odds-card.tsx.
- Ranking lido OFF `result.prediction` (sem re-query): `confidencePct` NOT NULL → number; `edgePct`/`oddAtRecommendation`
  nullable → `Number()` só se não-null.
- **Chaves de rank (= display):** (1) **edge** = edge da seleção recomendada via `computeMarketScenarios({selections,
  recommendedKey, impliedSumTarget})` (importa a fn pura de `lib/odds/scenario.ts`, client-safe) — o número que o card
  imprime; `impliedSumTarget = getDescriptor(marketKey)?.impliedSumTarget ?? 1`. (2) **EV** = `computeEvPerUnit(confidencePct,
  oddAtRecommendation)` (= `expectedReturn` do card; NÃO edge×odd). (3) **comparabilidade cross-mercado:** EV/unit é
  cross-comparável; modo edge normaliza por `impliedSumTarget` (÷2 p/ double_chance) → base Σ=1 por outcome coberto
  (comentário citando ADR 0018). (4) **edge×confiança:** sem fallback `?? stakeUnits` (confidencePct NOT NULL); normaliza
  confiança pelo mesmo impliedSumTarget; passes guardados por `isPass`. (5) **odd FROZEN** (ADR 0012), nunca live;
  non-pass com edge presente + odd null → ranqueia por edge, EV vira "—", NÃO afunda como pass. (6) **ordem total
  determinística:** passes por último em todo modo; primário = chave ativa desc; tiebreak = EV/unit desc, depois
  marketKey alfabético. best = `entriesSorted[0]`.
- **`lib/view/best-bet.ts` (novo, client-bundle-safe — só importa scenario, market-descriptor(getDescriptor),
  markets/presentation; SEM db/ai):** `BestBetEntry {marketKey, marketLabel, analysis, rank{edgePct, evPerUnit,
  confidencePct, oddAtRecommendation, impliedSumTarget, isPass}}`; `BestBetMarketError {marketKey, marketLabel, message}`;
  `BestBetView {entries[], errors[], llmCalls, unavailableMarkets}`. `toBestBetView(outcomes, aiCallByMarketKey,
  preWarmErrors)` — NÃO chama `friendlyMessage` (server-only); recebe messages prontas.
- **`components/best-bet-panel.tsx` (novo, "use client"):** props `BestBetView`; `useState<"edge"|"ev"|"edgeConf">("edge")`;
  ordena sobre os numerics de `rank` (zero recompute); #1 destacado via `<AnalysisResult view={entry.analysis}/>`; resto em
  lista/accordion; **`marketLabel` acima de TODO card (inclui pass** — o branch pass do AnalysisResult não imprime label);
  erros via `<AnalysisErrorCard/>`; header "N análises geradas" + "(M indisponível)". REUSA AnalysisResult/AnalysisScenarios,
  NUNCA OddsCard (golden intocado).

## 4. Flag (commits 1 e 7)
- Schema `aiConfig.enableBestBetFanOut: boolean().notNull().default(false)` (sem enum widening). Getter
  `getEnableBestBetFanOut()` copiando `getEnableOverUnderExtraLines` — ship JUNTO ($inferSelect).
- **0024 expand** (gerado: `DATABASE_URL='postgres://x:x@localhost:5432/x' pnpm db:generate`, contra o checkout real →
  drizzle auto-numera 0024). Espelha 0021. **0025 enable DML** (`drizzle-kit generate --custom --name
  enable_best_bet_fan_out` → preenche `UPDATE ai_config SET enable_best_bet_fan_out=true WHERE id=1`). Pode land dark.
- `page.tsx`: + `getEnableBestBetFanOut()` no Promise.all; CTA renderiza só se `bestBetEnabled && analyzable &&
  selectableMarkets.length>1`; CTA é ADICIONAL ao AnalysisPanel (não substitui), `useActionState` independente.

## 5. Tracking + ADR (commit 7)
- keepLatestPerMatch SEM mudança (keyed `matchId|marketKey`). Cadeia: predict() persiste `predictions.marketId` →
  dashboard re-deriva marketKey via JOIN markets → key; invariante `cartridge.marketKey===descriptor.dbMarketKey===markets.key`
  vale p/ todos os candidatos. over_under multi-linha compartilha 1 slot (mesma dbMarketKey, pipeline não keya por linha).
- Settlement ZERO mudança (predictions só tem índices simples, sem UNIQUE(matchId,marketId); prediction_outcomes UNIQUE(predictionId)).
- **ADR 0020 update REQUIRED:** §Decisão.2/§Referências de `(matchId,userId)` → `(matchId,userId,marketKey)`; #178 é o
  1º a materializar N mercados/match num run; confirmar que kpis.ts:140 já implementa (sem mudança de código).

## 6. Sequência de commits (cada um verde sozinho)
1. `feat(db): ai_config.enable_best_bet_fan_out flag (expand) + getter` — schema+0024+journal+ai-config.ts+test.
2. `feat(ai): best-bet fan-out orchestrator` — best-bet.ts (runFanOut serial, capCandidates Tier-1, MAX_*)+2 tests.
3. `feat(view): BestBetView + toBestBetView mapper` — lib/view/best-bet.ts+test (ranking=display, Number boundary, bundle-safe).
4. `feat(action): analyzeBestBet` — predictions.ts (gate order, dual-flag, per-descriptor pré-warm, all-fail)+test.
5. `feat(ui): best-bet panel com sort toggle edge%/EV/edge×confiança` — best-bet-panel.tsx+test.
6. `feat(match): monta CTA atrás da flag` — app/match/[id]/page.tsx.
7. `feat(db): enable best-bet fan-out (DML 0025) + docs(adr-0020)` — 0025+journal+ADR 0020.

## 7. Testes (vitest; pglite onde DB; golden intocado)
best-bet.test (ordem serial, array iterado, PredictError 1, non-Predict não descarta irmão, predict spy = única porta);
best-bet-cap (MAX=6/4, capCandidates nunca dropa Tier-1 mesmo fora da frente); predictions-best-bet (flag-off→rate-limit
NÃO chamado; empty→rate-limit NÃO chamado; happy→rate-limit 1×; WC=4; extra-lines OFF→[BTTS,DC] sem ALT, ON→+ALT; pré-warm
descriptor === o que predict resolve; pré-warm throw degrada 1 sem abortar; all-fail→{ok:false}; resolveExtraLines parity);
best-bet view (Number boundary; edge=display; EV=computeEvPerUnit≠edge×odd; Σ-norm DC; null-odd não afunda; llmCalls/unavailable;
bundle-safety); best-bet-panel (default edge; toggle EV reordena; pass por último; tie estável; #1=entriesSorted[0]; label sobre
pass; AnalysisErrorCard); ai-config-best-bet (default false/true); tracking pglite (N distintos (matchId,marketKey); mixed-run a/b);
golden NÃO tocado.

Verificação: green = local `pnpm typecheck && lint && test` (`--ignore-workspace`); Vercel preview UNSTABLE não-bloqueante;
prod deploy = critério de saída. Critério de saída #178: fluxo ponta-a-ponta, custo limitado+visível, auditável, sem dupla
contagem, Vercel+prod verdes, 1 PR. Ao fechar: atualizar HANDOFF-fase-4-cont.md + emitir kickoff Fase 5 (#179) ou sinalizar
Fase 4 completa.
