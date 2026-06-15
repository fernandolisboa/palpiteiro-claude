# PLAN-175 (REWORKED) — over/under linhas extras 1.5/3.5 · `over_under_v3.0`

> Scratch (untracked, NÃO commitado). Base: `origin/main` (refrescar após #262 graduação mergear).
> Worktree: `.claude/worktrees/175`. Decisões TRAVADAS abaixo; 24 blockers do plan-review resolvidos.

## DECISÕES TRAVADAS
- **D-A = ALL-ADDITIONAL** (usuário). Flag ON → as 3 linhas (1.5/2.5/3.5) vêm de `alternate_totals` (additional, 1 crédito/evento, pool justo). Flag OFF → featured `totals` 2.5 (byte-idêntico). Live-validado.
- **D-B = V2-FROZEN via DOIS cartuchos** (consenso review; "um cartucho que troca versão por nº de linhas" é INFEASÍVEL — campos do MarketCartridge são estáticos e predict lê `cartridge.systemPrompt/tool/version` direto). v2.0 = o cartucho atual `over_under` (INTOCADO). v3.0 = NOVA instância (multi-linha), selecionada por flag.
- **Audiência:** extra lines p/ TODOS os usuários quando flag ON (sem gate admin) — alinhado com #261.
- **Sem ADR** (ADR 0015 §3 lista "over/under multi-linha 1.5/2.5/3.5" como Tier 1 antecipado). Revisar comentário "Linha fixa em 2.5" no descriptor.
- **Settlement: ZERO mudança de código** (regra já line-paramétrica; meia-linha nunca dá push). Só ADICIONAR testes 1.5/3.5.
- **Sem migration** (linha vive em `marketParams.line`; selection_odds_snapshots já multi-linha; v3.0 = bump de prompt). Flag = DB ai_config se houver tabela singleton (flipável por migration in-session) OU env var (decidir no commit do flag).

## SEAM RESOLVIDO — contradição view×legacy (era CRÍTICO)
`predict.ts:806-807` escreve `over/underOddAtPrediction` gated em `isOverUnder` (market-keyed, NÃO line). A view binária-congelada (`analysis.ts:154-155`) consome essas colunas + `marketParams.line` (labels já line-driven via `framingLabel(altKey, line)`). Resolução:
- **MANTER** `over/underOddAtPrediction` escritas pra TODAS as linhas over_under (carregam o par da linha ESCOLHIDA). View funciona p/ 1.5/3.5 sem re-rotear. ✅
- **GATE só no enum legado:** `market = (isOverUnder && chosenLine === 2.5) ? 'over_under_2_5' : null`. 1.5/3.5 → `market=null` + `marketKey='over_under'` + `marketParams.line`.
- **`marketParams = resolveParams(output)` (OBRIGATÓRIO no caminho multi-linha; SEM `?? descriptor.params`)** — fallback ao descriptor.params settla a linha errada (top risk). Hard-fail PredictError se resolveParams ausente no multi-linha.
- Dashboard dedup `(matchId, marketKey)` SEM linha → **NÃO mudar** (review consenso): re-análise colapsa pra a última, qualquer linha (intenção ADR 0020). KPI segmenta por mercado, não por linha.

## ARQUITETURA (descriptor-driven, zero if(market===X) fora dos registries)
- **v3 descriptor `OVER_UNDER_ALT`** (NÃO mutar o singleton OVER_UNDER): `oddsSource:'additional'`, `providerMarketKey:'alternate_totals'`, `candidateLines:[1.5,2.5,3.5]`, `params:{line:2.5}` (default/primary), coveredLeagues = mesmo de over_under (universal). Os 3 sites que dispatcham por `oddsSource==='additional'` (predict.ts:382, fetch-and-snapshot.ts:188, predictions.ts:144) passam a ver 'additional' via o descriptor do cartucho v3 — sem branch novo.
- **Registry variant:** `getCartridge(marketKey, { extraLines })` → retorna v3 quando `extraLines` e existe variante (lookup data-driven `variantMap`, sem literal de market). v2 (default) intocado. Flag lida na action → `extraLines` threadado a getCartridge + pre-warm + predict (fonte única).
- **Candidate lines:** predict resolve bundles p/ `cartridge.descriptor.candidateLines ?? [params.line]`. N=1 (v2/outros mercados) = caminho de HOJE byte-idêntico.

## COMMITS (tracer-bullet, verde a cada passo; golden-freeze ANTES de produção)
0. **GOLDEN-FREEZE (test-only):** ADICIONAR `over_under/__tests__/build-input.test.ts` (down-map 2.5 + user-message v2.0 byte) + tool-schema snapshot v2.0 + um **sentinela flag-OFF** (request='totals', marketParams={line:2.5}, colunas legadas) que fica verde por TODOS os commits. Rodar verdes os goldens existentes (predict.test inline, presentation.test, analysis.test, settle-golden.pglite, registry/compute, scenario, sections, select-bookmaker, persisted-parity, fetch-and-snapshot.pglite, selection-odds-snapshots.pglite, components analysis-*/preview-a11y).
1. **Provider:** `ALTERNATE_TOTALS:'alternate_totals'` const + odds-api-constants test (additivo).
2. **select-bookmaker per-line param (LINCHPIN):** `pickBestBookmaker(..., params?:{line})` que sobrepõe `descriptor.params` no `resolveSelectionKey`; `pickBestTotalsBookmaker` segue passando nada (=2.5). Teste: payload alternate_totals multi-rung → bundle por linha; overround por linha; linha ausente → null. Callers atuais inalterados (N=1).
3. **Descriptor `OVER_UNDER_ALT`** (additional/alternate_totals/candidateLines) + `candidateLines?` no tipo MarketDescriptor + tests. Revisar comentário "Linha fixa 2.5".
4. **fetch-and-snapshot multi-linha additional:** `fetchAndWriteAdditional` faz UM getOddsForEvent (1 crédito) e itera candidateLines → pickBestBookmaker por linha → escreve um bundle por linha (`marketParams:{line}`). Freshness gate POR linha (pior-fresca; se qualquer linha stale → 1 fetch reescreve todas). pglite test (3×2=6 rows; read fresca por linha; completeness por linha).
5. **Tipos do contrato (additivos):** `GenericOddsArgs.lineLadder?` (NÃO mexer em `selections`) + `MarketCartridge.resolveParams?(output)`. Typecheck contra os 4 build-inputs.
6. **Cartucho `over_under_v3.0`** (2ª instância): inputSchema = lineLadder; outputSchema += `line` (Zod refine ∈ {1.5,2.5,3.5}); prompt v3.0 (vê todas as linhas, escolhe 1); buildUserMessage renderiza a escada; selectionProbs; `resolveParams(output)→{line}`; descriptor=OVER_UNDER_ALT. v2.0 INTOCADO. Registry variant. Novos snapshots p/ v3.
7. **predict.ts multi-linha:** resolve `Map<line,bundle>` p/ candidateLines; implied/oddByKey por linha (de-vig Σ=1 por linha); passa ladder ao buildUserMessage; APÓS output: `chosenLine` via resolveParams (OBRIGATÓRIO multi-linha; valida ∈ ladder resolvida, senão PredictError); RE-DERIVA oddByKey/impliedByKey/oddAtRec/impliedPct/edge/psoRows/selectionId/carrier do bundle escolhido; `marketParams = resolveParams(output)`; enum gate `(isOverUnder && chosenLine===2.5)`; over/underOddAtPrediction p/ TODAS as linhas. Sentinela flag-OFF segue verde.
8. **Flag + wiring:** lê flag (ai_config DB OU env, default off) → `extraLines` em analyzeMatch → getCartridge variant + pre-warm additional + predict. Teste default-off parity. Pre-warm additional só APÓS short-circuit de analisabilidade (sem spend em jogo encerrado).
9. **Presentation line-driven:** betSummary/scenarioLabel/framingLabel USAM o arg `line` (hoje as closures `(key)=>` o descartam) — `ceil(line)` p/ "pelo menos N gols". defaultLine 2.5 fallback. Snapshots 1.5/3.5 + 2.5 inalterado. (H2H ao vivo FORA do escopo — fica 2.5 default.)
10. **Settlement boundary tests (no code):** 1.5 (1→under,2→over) e 3.5 (3→under,4→over) via marketParams persistido; nunca push. pglite + unit.
11. **Backtest (AC#4):** script #173 existe; ≥20/linha PAGO acumula; NÃO bloqueia merge.

## INVARIÁVEIS (carregam)
Edge de-vig Σ=1 por linha (ADR 0018, nunca 1/odd cru). Zod em todo output. predict.ts única porta LLM. Zero if(market===X) fora dos registries (únicas identidades: legacy-write ===OVER_UNDER.dbMarketKey + view marketKey==='over_under'; novo dispatch = campo de descriptor/flag genérico). expand-migrate-contract. Paridade 2.5 flag-OFF byte (sentinela + goldens). Quota additional só por evento, NUNCA batch. Settlement só meia-linha (nunca push). `.strict()` settlement params → marketParams = {line} só.

## CRITÉRIO DE SAÍDA
1.5/3.5 analisáveis ponta-a-ponta atrás da flag (cartucho avalia, emite 1 rec c/ linha); settlement correto (1/2 p/1.5; 3/4 p/3.5); 2.5 intacto byte (flag-off); flag ON → todos os usuários; Vercel + prod verdes. Flip da flag ON in-session + 1 análise real flag-on verificada em prod (decisão usuário: "já feito"). Backtest acumula.
