# PLAN-412 — "Analise minha aposta": leitor de valor selection-pinned (build do ADR 0034)

> Plano de build cacheado (design-workflow 2026-06-20, ultracode: explore→plan→review adversarial→finalize). Aterrado no worktree off `origin/main` (inclui #394). Implementa o **ADR 0034** (`docs/decisions/0034-analise-minha-aposta-leitor-de-valor-selection-pinned.md`, presente em main — o "ADR ausente" da explore foi falso alarme: `git ls-tree origin/main` lista, worktree limpo o contém). Issue #412.

## Sanity-check

**PROCEED.** Reuso quase total do motor de valor (ZERO matemática nova — compõe `scenario.ts`+`money.ts`+`staking.ts`+`implied-probability.ts`, todas puras já consumidas por `lib/view/best-bet.ts`). Fronteira `predict.ts` intacta (cache-first; `predict()` só no MISS). Firewall da manchete NÃO tocado (registro Análise = números de valor legítimos). Todas as decisões duras estão travadas no ADR 0034 — não re-derivar, só aterrar.

## Decisões do dono (2026-06-20, pós-design)

1. **Entry-point = ABA/MODO na match page** (NÃO rota dedicada). Segmented `[ Análise | Minha aposta ]` na zona de análise; default "Análise"; "Minha aposta" mostra o form + leitura de valor inline. Gateado em `analyzable` (só `scheduled` E kickoff>now) — em jogo não-analisável a aba nem aparece (a action rejeitaria). DROP os 3 arquivos de rota dedicada do draft.
2. **Form PRÉ-PREENCHIDO** da recomendação atual (mercado/seleção/linha da última predição) — usuário só digita a odd que pegou. Fallback sensato (over_under/over/2.5) quando não há predição.
3. **Cobertura "analise tudo"**: a superfície cobre TODOS os mercados com modelo de valor (over_under, match_result/1X2, btts, double_chance) via `marketsForAudience ∩ marketsForLeague` — NÃO é restrição over/under deliberada. Pra dar 1X2 ao usuário comum: **flip `match_result.is_graduated=true` no go-live** (DB-only, reversível, padrão `owner-no-manual-feature-gates`). Mercados sem modelo de odds/edge (cards/corners/scorer-dynamicSelections, btts/dc fora de world_cup) → "não avalio ainda" (skip-not-fabricate, NÃO uma escolha — é realidade de dado).

## Arquivos (file-by-file)

### 1. `lib/view/grade-my-bet-input.ts` (NEW)
Schema Zod NET-NEW + parse PT-BR. Módulo SEM `"use server"` (importável client+server). `parsePtBrOdd(raw: string): number` = `Number.parseFloat(raw.replace(",", "."))` (vírgula→ponto ANTES do parse; grep confirmou que NÃO há parse PT-BR no repo). `GradeMyBetInputSchema = z.object({ marketKey: z.string().min(1), selectionKey: z.string().min(1), line: z.coerce.number().optional() /* FormData é string '2.5'; coerce ANTES de comparar com o number do jsonb senão MISS espúrio→predict pago — BLOCKER */, odd: z.string().transform(parsePtBrOdd).pipe(z.number().finite().gt(1)) })`. odd≤1/NaN/não-finita → fail ANTES das primitivas (`assertValidOdd` LANÇA p/ odd≤1). Validação de mercado∈audiência∩liga e seleção∈selectionKeys NÃO mora aqui (precisa `match.league`+`isAdmin` async) — fica na action.

### 2. `lib/view/grade-my-bet.ts` (NEW)
Mapper PURO (espelha `lib/view/best-bet.ts`): server-side, importa SÓ `@/lib/odds/scenario` + `@/lib/odds/market-descriptor` (`getDescriptor`) + `@/lib/settlement/money` + `@/lib/ai/staking` + `@/lib/view/markets/presentation` (`getMarketPresentation`) + tipos. **NUNCA** `@/lib/db` / `@/lib/ai` (valor) / `value-language-guard`. `toGradeMyBetView(input): GradeMyBetView` onde `input` traz números CONGELADOS+`Number()'d` pela action: `{ selections:{key;modelProbPct;odd:number|null}[]; pinnedKey; userOdd:number; marketKey; line:number|null; recommendation:string|null; persisted:{edgePct:number|null;impliedProbPct:number|null;stakeUnits:number|null}|null; createdAt }`.

Lógica:
1. `descriptor=getDescriptor(marketKey)`; `impliedSumTarget=descriptor?.impliedSumTarget??1`; `marketKind=descriptor?.marketKind??"partition"` — **THREADAR ambos** (best-bet.ts:42,46).
2. `pinnedModelProbPct=selections.find(s=>s.key===pinnedKey)?.modelProbPct`; ausente → `{kind:'nao-avalio', reason}` (skip-not-fabricate §8).
3. **persisted-vs-recompute UMA VEZ por seleção, alimentando edge EXIBIDO E stake do MESMO número** (landmine MAJOR — band boundaries em edge>=8/>=12): SE `pinnedKey===recommendation && persisted!==null` → display `persisted.edgePct`/`persisted.impliedProbPct` E stake `persisted.stakeUnits` (frozen). SENÃO → `scen=computeMarketScenarios({selections,recommendedKey:recommendation,impliedSumTarget,marketKind})`; `pinnedScen=scen.selections.find(s=>s.key===pinnedKey)`; `edge=pinnedScen.edgePct` (display+stake ambos recomputados).
4. **CANAL ODD-DO-USUÁRIO (PRIMÁRIO, price-only §2/§3):** `evPerUnit=computeEvPerUnit(pinnedModelProbPct,userOdd)` DIRETO (NÃO de `computeMarketScenarios` que usa `s.odd` NOSSA, scenario.ts:135); `breakEvenProbPct=computeBreakEvenProbPct(userOdd)`. **`userOdd` NUNCA entra no array Σ1/odd** de `computeMarketImpliedProbabilities`.
5. STAKE do número do passo 3: recomendado-cache-hit → `persisted.stakeUnits`; senão `computeStakeUnits(edge, pinnedModelProbPct)` (2º arg = proxy de confiança §4a). Sem snapshot E não-recomendada → `edge=null` → `computeStakeUnits(null,…)=1u` rotulado "dimensionamento de mercado" (§4b).
6. LUCRO: `profitForOutcome('won', userOdd, stakeUnits)`.
7. **GUARDA DE COERÊNCIA (§4c):** `coherenceWarning = edge!==null && Math.sign(evPerUnit)!==Math.sign(edge)`; `evPerUnit` AQUI é SEMPRE o EV@userOdd (passo 4), NUNCA EV@nossaOdd.
8. **`valueReading` TEMPLATE-DERIVADO de `Math.sign(evPerUnit)` SÓ** (nunca `sign(edge)`): mapa const `VALUE_READING = { positive, zero, negative } as const` — descritivo/backward-looking ("Pelo nosso modelo, nessa odd, essa aposta TEM/NÃO TEM valor"), NUNCA imperativo/nota/score/chip/superlativo. Sob `coherenceWarning` → `valueReading` é a frase negative/no-value (governada pelo EV@userOdd) E o stake-de-nosso-edge sai SÓ sob `secondaryStakeLabel`, nunca primário. Nome de campo `valueReading` (≠ `verdict`, §11).
9. `edge=null` quando snapshot incompleto (`allOddsPresent=false` → `pinnedScen.edgePct null`) — EV+breakEven+lucro AINDA presentes (canal odd-do-usuário independe do board), `edgeLabel='—'` → `{kind:'degradado-sem-snapshot'}`.

### 3. `lib/view/types.ts` (EDIT)
`GradeMyBetView` UNION DISCRIMINADO (tipos PUROS client-safe, espelha `BestBetView`): `{kind:'grade-coberto'; pinnedLabel; marketLabel; line:number|null; userOdd; valueReading:string; edge:number|null; edgeLabel:string; evPerUnit:number; breakEvenProbPct:number; stakeUnits:number; stakeLabel:string; secondaryStakeLabel:string|null; profitIfWon:number; coherenceWarning:boolean; modelProbPct:number; impliedProbPct:number|null; createdAt:string} | {kind:'degradado-sem-snapshot'; …(edge null, EV+breakEven+lucro presentes, stake 1u "dimensionamento de mercado")} | {kind:'nao-avalio'; reason:string}`. **NB:** rate-limited/input-invalido/nao-analisavel/match-nao-encontrado moram no union de RETORNO da ACTION (`GradeMyBetResult` com `ok:boolean`), NÃO neste View (espelha `AnalyzeMatchResult`).

### 4. `app/actions/predictions.ts` (EDIT) — Server Action `gradeMyBet`
`gradeMyBet(_prev, formData): Promise<GradeMyBetResult>` (async; helper de parse puro fica em grade-my-bet-input.ts). **GATES EM ORDEM EXATA** (espelha `analyzeMatch:116-217`; pinar a ordem em teste com spies):
1. `matchId` via `z.uuid().safeParse`.
2. `auth()`; sem sessão → erro.
3. `getUserAccessState` + floor `isEmailAllowed`.
4. `getMatchById` → "Jogo não encontrado."
5. `notAnalyzableMessage(match.status)` → `nao-analisavel` (copy por status VERBATIM).
6. **ZOD BOUNDARY** (`GradeMyBetInputSchema`) parse de `{marketKey,selectionKey,line,odd}` → odd≤1/malformado → `input-invalido` (CHEAP, ANTES de qualquer DB; spy: `getLatestPredictionForPin` NÃO chamado).
7. **RE-VALIDAÇÃO server-side** (firewall POST forjado): `isAdmin=role==='admin'`; `allowedMarkets=marketsForLeague(await marketsForAudience(isAdmin), match.league)`; SE `marketKey ∉ allowedMarkets` → `nao-avalio` — **NÃO coercir a over_under** (DIVERGÊNCIA DELIBERADA de analyzeMatch:215: a seleção é fixada; coercir avaliaria OUTRA aposta). SE `selectionKey ∉ getDescriptor(marketKey).selectionKeys` ESTÁTICO → `nao-avalio` (dynamicSelections `[]`→inerte).
8. **GATE DE LINHA-MODELÁVEL ANTES DE GASTAR** (landmine MAJOR): SE `marketKey==='over_under'`, computar `extraLines` como a action de análise (`getEnableOverUnderExtraLines` + `candidateLines ∩ coveredLeagues incl match.league`); linha modelável = `{2.5}(featured) ∪ candidateLines(quando extraLines resolve)`. Linha fixada ∉ modeláveis → `nao-avalio` SEM gastar (over 3.5 em brasileirao → nao-avalio, NO rate-limit, NO predict; `OVER_UNDER_ALT.coveredLeagues=['world_cup']`).
9. **CACHE-FIRST:** `hit=await getLatestPredictionForPin(matchId,userId,marketKey, marketKey==='over_under'?line:null)`. HIT → SEM rate-limit (leitura grátis) → montar `persisted` **`Number()`'ANDO na fronteira drizzle** (BLOCKER): `persisted = hit.prediction.recommendation===selectionKey ? {edgePct: hit.prediction.edgePct===null?null:Number(...), impliedProbPct:…, stakeUnits:…} : null` → `toGradeMyBetView`. MISS → `checkAnalysisRateLimit(userId,role)` (`@/lib/rate-limit`; `rate-limited` discriminando `reason:'fail-closed'` vs teto real, copy verbatim) → `predict({matchId,userId,isAdmin,marketKey,extraLines})` → `persisted=null` (recompute) → `toGradeMyBetView`.
10. `revalidatePath(/match/[id])` no sucesso.

`GradeMyBetResult = {ok:true; view:GradeMyBetView} | {ok:false; error:string; kind?:'rate-limited'|'input-invalido'|'nao-analisavel'}`. **`predict.ts` NÃO é tocado** (a fixação é 100% no mapper via `selections.find`; NÃO estender `PredictArgs`).

### 5. `lib/db/queries/predictions.ts` (EDIT) — reader market+line-keyed
`getLatestPredictionForPin(matchId, userId, marketKey, line: number|null): Promise<PredictionWithAiCall | null>`. Impl: chama `getPredictionHistoryForMatch` (já desc(createdAt),desc(id)), filtra em JS com **discriminante de linha KEYED no `marketKey` FIXADO** (landmine MAJOR, NÃO heurística per-row): coalesce `row.marketKey null→'over_under'` (espelha a view), exige `===marketKey`; SE `marketKey==='over_under'` exige `Number(row.prediction.marketParams?.line)===Number(line)` STRICT (row com `marketParams=null` legado OU linha diferente → skip, continua escaneando); pra TODO outro mercado ignora linha (casa só por marketKey; rows têm `marketParams=null`, caller passa `line=null`). NUNCA um único `?.line===line` (confunde undefined×null). Retorna a primeira (mais recente) que casa, ou null.

### 6. `components/grade-my-bet.tsx` (NEW) — `"use client"`
`<form action={formAction}>` com `useActionState(gradeMyBet,null)` (precedente: override-form.tsx). `<input type=hidden name=matchId>`, seletor de mercado (só `allowedMarkets` props server-side), seletor de seleção (`descriptor.selectionKeys`), input de linha (só quando `marketKey==='over_under'`), input de odd-da-casa (aceita vírgula PT-BR). **PRÉ-PREENCHIDO** das props `prefill={marketKey,selectionKey,line}`. Button `disabled={pending}`. RENDER do resultado (registro Análise DESGUARDADO, espelha analysis-result.tsx — números de valor LEGÍTIMOS): `valueReading` (do view), edge OU '—' (`edgeLabel`), **EV@userOdd PRIMÁRIO**, break-even, stake (`stakeLabel`/`secondaryStakeLabel` — sob coherence o stake-de-nosso-edge é SECUNDÁRIO), lucro-se-ganhar (R$). A GOVERNANÇA vive nos DADOS do view (o componente só RENDERIZA, não re-decide). **PROIBIDO (§10):** nota/letra/score/medidor/chip verde-vermelho/superlativo; SEM CTA "faça esta aposta", SEM link/deep-link/banner pra casa (§6/§12) — `userOdd` é input inerte ecoado. Estados de erro via state discriminado (`role=alert`). **FIREWALL: ZERO import de value-language-guard** (invariante). Renderiza o **disclaimer §3 COMPLETO** verbatim (ver landmine).

### 7. `components/match-analysis-tabs.tsx` (NEW) — `"use client"`
Wrapper de aba na zona de análise. Props: `analysisSlot: ReactNode` (o `<NeutralAnalysisDetail/>` server-rendered, passado como children — Server Component dentro de Client OK no App Router) + `gradeProps` (matchId, allowedMarkets, descriptors, prefill). Segmented control `[ Análise | Minha aposta ]` (useState, default "Análise"). "Análise" → `analysisSlot`; "Minha aposta" → `<GradeMyBet {...gradeProps}/>`. Estilo sóbrio (pixels no /impeccable depois).

### 8. `app/match/[id]/page.tsx` (EDIT) — wiring da aba
Resolver server-side (na page): `isAdmin`, `allowedMarkets=marketsForLeague(await marketsForAudience(isAdmin), match.league)`, os `descriptors` por marketKey (selectionKeys/labels via `getMarketPresentation`), e o `prefill` da última predição (`latestPred`: marketKey resolvido + `recommendation` + `marketParams.line`; fallback over_under/over/2.5). Passar tudo via `Common` pros dois branches. Em Mobile/Desktop: SE `analyzable` → trocar o `<NeutralAnalysisDetail/>` direto por `<MatchAnalysisTabs analysisSlot={<NeutralAnalysisDetail .../>} gradeProps={...}/>`; SENÃO mantém o render atual (sem aba). O caminho `!analyzable && sections.length===0 → NotAnalyzableNotice` fica intacto.

### 9. `app/actions/__tests__/grade-my-bet.test.ts` (NEW)
Suite da action (espelha predictions.test.ts) — ver Test plan.

### 10. `lib/view/__tests__/grade-my-bet.test.ts` (NEW)
Suite do mapper puro (espelha best-bet.test.ts) — ver Test plan.

## Estados de saída (union)

- **grade-coberto** — coberto E (snapshot completo OU seleção recomendada com persistido): edge (PERSISTIDO se pinned===recommendation, alimentando display E stake do MESMO número; senão recomputado), EV@userOdd PRIMÁRIO, break-even, stake, lucro, valueReading do sign(EV@userOdd).
- **degradado-sem-snapshot** — coberto, não-recomendada, board incompleto: edge='—' (honesto), EV@userOdd+break-even+lucro AINDA exibidos, stake=1u "dimensionamento de mercado".
- **nao-avalio** — mercado fora de audiência∩liga (1X2 não-admin; btts/dc fora de world_cup; POST forjado — SEM coerção), OU seleção∉selectionKeys, OU linha não modelada (incl. over 3.5 fora de world_cup) ANTES de gastar. Não gasta rate-limit nem predict.
- **nao-analisavel** — status≠scheduled: reusa `notAnalyzableMessage(status)` verbatim.
- **rate-limited** — SÓ no MISS: `checkAnalysisRateLimit` !ok, discrimina fail-closed vs teto.
- **input-invalido** — Zod boundary ANTES da leitura de DB: odd≤1/NaN após parse PT-BR; campos malformados. `getLatestPredictionForPin` NÃO chamado.

## Landmines (todos confirmados no código pela review adversarial)

- **DRIZZLE-NUMERIC NA FRONTEIRA PERSISTIDA (blocker):** `mapSelectionRow` converte SÓ as rows por-SELEÇÃO. `prediction.edgePct/impliedProbPct/stakeUnits/confidencePct/oddAtRecommendation` (numeric) voltam STRING e NÃO são Number()'d no read path. A ACTION deve `Number()` cada um ANTES do mapper. Pinar teste "persisted sobrevive como number".
- **STAKE E EDGE-DISPLAY DO MESMO NÚMERO (blocker MAJOR):** `computeStakeUnits` tem bandas em edge>=8 e >=12. Display persistido (.toFixed(2)) + stake recomputado (.toFixed(3)) podem cair em bandas diferentes. Escolha persisted-vs-recompute UMA vez por seleção, alimentando AMBOS. Recomendada-cache-hit → `persisted.stakeUnits`. NUNCA split.
- **CACHE-LINE-KEY KEYED NO PINNED MARKET (blocker MAJOR):** discriminante de linha é over_under (única família com params.line), NÃO heurística "a row tem linha?". over_under → `Number(row.marketParams?.line)===Number(line)` strict (null legado/linha diferente → MISS). Outros → casa só por marketKey (caller passa line=null). NUNCA `?.line===line` (undefined×null → 1X2 daria MISS errado cobrando predict).
- **LINHA-MODELÁVEL ANTES DE GASTAR (blocker MAJOR):** `OVER_UNDER_ALT.coveredLeagues=['world_cup']`. over 3.5 fora de Copa NUNCA modelável — MISS→predict produziria só a 2.5 featured, mapper daria nao-avalio, queimando rate-limit+ai_call à toa. Gate ANTES de gastar.
- **LINHA z.coerce.number() (blocker):** FormData é string ('2.5'); sem coerce, `'2.5'!==2.5(jsonb number)` → MISS espúrio→predict PAGO. Number() em AMBOS os lados no reader.
- **DUAL-CHANNEL/overround:** userOdd SÓ no canal cru. NUNCA no array Σ1/odd de `computeMarketImpliedProbabilities` (corromperia overround de TODAS as seleções). Pinar teste de identidade do array.
- **EV DEGRADADO NÃO sai de computeMarketScenarios** (usa s.odd NOSSA): é `computeEvPerUnit(modelProbPct,userOdd)` direto. Com snapshot exibe SEMPRE o EV@userOdd como primário.
- **COERÊNCIA LÊ O EV@userOdd (blocker minor):** `coherenceWarning=edge!==null && sign(evPerUnit_userOdd)!==sign(edge_ourBoard)`. valueReading deriva SÓ de `sign(EV@userOdd)`, NUNCA de `sign(edge)`. NÃO reusar o expectedReturn (EV@nossaOdd) do card.
- **SEM NOTA/IMPERATIVO + STRINGS TRAVADAS (blocker minor §10/§11):** `valueReading` ∈ conjunto FINITO de constantes; nome ≠ 'verdict'. Golden test: render ∈ {3 constantes} E não contém denylist ('aposte','vá','garante','boa aposta','ótima','excelente','péssima','recomendamos', regex letra-nota/score). PROIBIDO chip/medidor/CTA/link pra casa.
- **FIREWALL NÃO TOCAR:** 1 caller de PRODUÇÃO (`lib/ai/palpites/index.ts:316-320`, 4 campos da manchete). ZERO novos callers de `containsValueLanguage`. grade-my-bet NÃO importa value-language-guard. Análise = números legítimos (rotear pelo firewall stripparia edge/EV/stake — erro de categoria §9).
- **DISCLAIMER §3 NET-NEW verbatim:** linha §3 COMPLETA (`docs/ops/05-legal-compliance.md:102-105`), trabalho NOVO (NÃO herdado de analysis-result.tsx §7). Tela de MÁXIMA intenção. Texto byte-idêntico ao já renderizado em `app/como-funciona/como-funciona-content.tsx:467-472` ("Aposta não é investimento." … "nunca para recuperar perdas. Se a aposta deixou de ser diversão, procure ajuda."). Pinar com `toContain`.
- **NÃO-COMPARTILHÁVEL/sem-OG (blocker minor §13):** aba é autenticada/18+ (herda o gate da match page). NENHUM tipo/módulo de grade-my-bet importado sob `app/p/**` ou a rota OG. Teste import-graph (espelha o do firewall). O scaffolding de share #383/#384 está VIVO no mesmo repo — copy-paste vazaria edge/EV/R$ pro OG público (a alternativa REJEITADA §alt-9).

## Test plan

- **dual-channel:** snapshot completo + userOdd≠nossa → EV exibido=`computeEvPerUnit(modelProbPct_pinned,userOdd)` DIFERE de `pinnedScen.evPerUnit`; edge do NOSSO board; assert userOdd NUNCA no input de `computeMarketImpliedProbabilities` (identidade do array).
- **cache HIT zero-LLM:** prediction casando (matchId,userId,marketKey,line) → `gradeMyBet` NÃO chama predict() nem incrementa rate-limit nem cria ai_calls/predictions (mock predict + spy rate-limit).
- **cache 1X2 null-line HIT:** pin 1X2 vs cache 1X2 (marketParams=null) → HIT zero-LLM (predicado null-line correto).
- **cache MISS line-mismatch:** over 2.5 pin vs cache 3.5 → MISS (predict se modelável, senão nao-avalio).
- **linha-modelável:** over 3.5 em brasileirao → nao-avalio SEM rate-limit SEM predict; over 3.5 em world_cup com flag ON → MISS→predict permitido.
- **Zod PT-BR + coerce:** '1,85'→1.85 aceito; '1'/'0,99'/'abc'→input-invalido ANTES de getLatestPredictionForPin (spy); linha '2.5' string casa cache numérico-2.5 (HIT, sem predict).
- **drizzle persisted:** hit com `prediction.edgePct='7.35'` (string) → view recebe edge=7.35 (number).
- **persisted-vs-recompute + stake-mesmo-número:** pinned===recommendation E persisted!=null → view usa `persisted.edgePct` E stake=`persisted.stakeUnits` (sem band-mismatch); não-recomendada → recompute display E stake.
- **cobertura/no-coerção:** 1X2 não-admin → nao-avalio; btts/dc fora de world_cup → nao-avalio; seleção∉selectionKeys → nao-avalio; POST forjado marketKey fora de audiência∩liga → nao-avalio SEM predict SEM rate-limit (assert NÃO coerção).
- **guarda de coerência:** sign(EV@userOdd) negativo E edge@ourOdd positivo → valueReading=frase negative, stake-de-nosso-edge SÓ em secondaryStakeLabel, coherenceWarning=true.
- **stake degradado:** sem snapshot E não-recomendada → edge='—', stakeUnits=1u "dimensionamento de mercado", EV+lucro presentes.
- **impliedSumTarget:** double_chance (impliedSumTarget=2) → edge não pela metade; independent_binary thread marketKind.
- **nao-analisavel:** status='live'/'finished' → copy por status de notAnalyzableMessage.
- **value-reading register (golden):** render ∈ {3 constantes} E sem denylist imperativo/nota.
- **firewall intacto (import-graph):** grade-my-bet.ts/components NÃO importam value-language-guard nem @/lib/db; contagem de callers de produção de containsValueLanguage permanece 1.
- **não-compartilhável (import-graph):** tipos/módulos de grade-my-bet NUNCA importados sob app/p/** ou rota OG.
- **disclaimer §3:** componente renderiza a linha §3 COMPLETA verbatim (toContain).
- **aba gated:** match não-analisável → aba "Minha aposta" AUSENTE; analisável → presente.
- **Triad:** typecheck + lint + test verdes; `next build` LOCAL (`gradeMyBet` é async; `parsePtBrOdd` em módulo NÃO-'use server'). pglite do reader com `--no-file-parallelism`.

## Go-live (pós-merge)

Flip `match_result.is_graduated=true` no DB de prod (DB-only, reversível, padrão best-bet flag) pra 1X2 ficar público pro usuário comum — honra o "analise tudo" do dono. Mercados sem modelo seguem "não avalio".
