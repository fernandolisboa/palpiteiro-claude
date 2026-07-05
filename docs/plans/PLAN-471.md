# PLAN-471 — Aposta livre, Fase 1: tracer placar-exato end-to-end (ADR 0036)

> Snapshot de plano (histórico, não spec viva). Aterrado no código real via exploração.
> Tracer bullet: UMA perna (`exact_score`) atravessando TODA costura nova, reusando ao
> máximo o que já roda em produção. Um único PR (tracer é vertical atômico).

## Princípios inegociáveis (do ADR 0036 + landmines do kickoff)

- **Confirm obrigatório**: nada é gradeado até o usuário confirmar. O slip Zod-validado é o contrato; o NL é açúcar na FRENTE do boundary fail-closed.
- **Zero novos callers de `containsValueLanguage`** (`lib/ai/palpites/value-language-guard.ts`). Nenhum módulo novo importa o guard. Disclaimer = constante LOCAL no componente (espelha `components/grade-my-bet.tsx:18`).
- **Campo `verdict` PROIBIDO** em qualquer schema/tipo novo (colide com o campo guardado da manchete).
- **Perna B nunca exibe edge nem pseudo-implied de `1/userOdd`**: edge = "—" SEMPRE; nada de `computeMarketImpliedProbabilities` na perna B (sem board completo, sem de-vig). Teste pinado.
- **Grades CONGELADOS no write**: `modelProbPct` persistido; render lê o persistido, nunca recomputa.
- **Drizzle numeric→string**: `Number()` na fronteira de view (userOdd/modelProbPct/comboUserOdd).
- **prefer-skip-over-silent-wrong**: standings indisponível → "não avalio" rotulado, NUNCA λ fabricado; settlement sem `regulationScore` → PENDING visível.
- **[B1 do review] `leagueAvg` degenerado → "não avalio"**: `Σ played = 0` (rodada 1, pré-Copa, tabela zerada) faria `leagueAvgGoalsPerTeam = NaN`/`0`, dividido dentro de `estimateLambdas` → λ `NaN`, atravessa o clamp `Math.max/min(NaN)=NaN` e envenena a matriz. Guarda DUPLA: (a) no adapter da action, `!Number.isFinite(leagueAvg) || leagueAvg <= 0` → `gradeStatus='no_data'`/"não avalio"; (b) `estimateLambdas` defensivo — se qualquer λ resultante for não-finito, tratar como degrau (ii)/prior indisponível (o módulo puro nunca devolve λ `NaN`). Teste pinado dos dois.
- **`lib/quant` PURO**: síncrono, determinístico, ZERO imports de `@/lib/db`, `@/lib/ai`, `@/lib/providers` (nem types). Tipos de input estruturais próprios.
- **Migration ≥0041**: próximo número livre é **0041** (última é 0040). Se outro PR pegar 0041 → renumerar (ver memória "concurrent storm migration renumber").
- **Não tocar** `predictions`/`ai_calls`/`palpites`/`lib/ai/predict.ts` (partição ADR 0028; predict.ts fora de escopo). `ai_calls` só ganha uma ROW de log do parse (via seam), sem alterar a tabela.

## Escopo do tracer (só `exact_score` = CAMINHO B/Poisson)

Fora do tracer (Fase 2/3): kinds de mercado (Caminho A), demais props B, roteamento kind×gate,
editor por-chip completo, combinada/joint, "Minhas apostas" paginado, `first_half_over_under` rule.
As 3 tabelas e os enums nascem COMPLETOS (Decisão 5, sem sidecar de attempts) pra evitar churn de migration.

---

## 1. Schema + migration (`db/schema.ts` → `0041_*.sql`)

Espelha a FORMA de `palpites`/`palpiteOutcomes` (`db/schema.ts:468-546`). Padrão: `pgTable`, `pgEnum`, `jsonb().$type<>()`, `numeric({precision,scale})`, `timestamp({withTimezone:true}).notNull().defaultNow()`, `index("nome_idx").on(...)`, `.unique()` inline, `references(() => t.id, { onDelete })`.

**Enums novos:**
- `betLegKindEnum = pgEnum("bet_leg_kind", [...])` — união COMPLETA da Decisão 2: `over_under, match_result, btts, double_chance, exact_score, margin, clean_sheet, first_half_score, first_half_over_under, first_to_score, cards, corners`. (Só `exact_score` é exercido no tracer; os demais entram já no enum pra não precisar `ALTER TYPE ADD VALUE` depois.)
- `gradeSourceEnum = pgEnum("grade_source", ["cartridge","scoreline_model","none"])`.
- `gradeStatusEnum = pgEnum("grade_status", ["graded","not_covered","no_data","rate_limited","degraded_no_snapshot"])`.
- **Reusa `outcomeResultEnum`** (`db/schema.ts:17`, `["won","lost","void","push"]`) pra `bet_leg_outcomes.result` — apostas de usuário só emitem won|lost, mas reusar evita enum novo.

**`betSlips`** (`bet_slips`):
```
id uuid pk defaultRandom
matchId uuid notNull references(matches.id, restrict)
userId  uuid notNull references(users.id, restrict)
rawInput text (nullable)              -- NL cru, capado ~280 chars; null = editor-only
parseAiCallId uuid (nullable) references(aiCalls.id, set null)
comboUserOdd numeric(6,3) (nullable)  -- Fase 3, nullable já agora
jointProbPct numeric(5,2) (nullable)  -- Fase 3
createdAt timestamp tz notNull defaultNow
índices: index (userId, createdAt desc); index (matchId)
```

**`betLegs`** (`bet_legs`):
```
id uuid pk defaultRandom
slipId uuid notNull references(betSlips.id, cascade)
kind betLegKindEnum notNull
params jsonb $type<BetLegParams>() notNull  -- narrowed por Zod no boundary; tracer: {home,away}
userOdd numeric(6,3) (nullable)
modelProbPct numeric(5,2) (nullable)        -- congelado no grade
gradeSource gradeSourceEnum notNull
gradeStatus gradeStatusEnum notNull
pinnedPredictionId uuid (nullable) references(predictions.id, set null)  -- Caminho A (Fase 2); tracer=null
settleable boolean notNull                  -- derivado DO KIND no código (deriveBetLegSettleable), nunca do LLM
índice: index (slipId)
```
`BetLegParams` (TS-only $type) = `{ home: number; away: number }` no tracer; widened em Fase 2. Sem impacto de migration.

**`betLegOutcomes`** (`bet_leg_outcomes`) — espelho FIEL de `palpiteOutcomes`:
```
id uuid pk defaultRandom
legId uuid notNull .unique() references(betLegs.id, cascade)   -- âncora 1:1 idempotente
result outcomeResultEnum notNull
resultData jsonb $type<PalpiteResultData>() (nullable)
overrideByUserId uuid (nullable) references(users.id, set null)
settledAt timestamp tz notNull defaultNow
```

**Sem sidecar** `bet_leg_settlement_attempts` (Decisão 5 — inerte enquanto `CARDS_COVERED_LEAGUES` vazio).

Gerar com `pnpm db:generate` (drizzle-kit; out=`db/migrations/`, casing snake_case). Verificar que o número saiu `0041`. NÃO editar o SQL à mão.

`deriveBetLegSettleable(kind)` — mapa estático em `db/schema.ts` ou `lib/settlement/user-bet-settleable.ts`: `exact_score→true`, `corners→false`, etc. (só `exact_score` importa no tracer, mas o mapa nasce completo). Espelha a intenção de `SETTLEABLE_PALPITE_TYPES`.

---

## 2. `lib/quant/scoreline-model.ts` (PURO) + testes

Módulo novo, nasce com a espec de pureza (Decisão 9). Tipos estruturais próprios:
```ts
export type SplitGoalRates = { played: number; goalsFor: number; goalsAgainst: number };
export type EstimateLambdasInput = {
  home: SplitGoalRates | null;   // homeSplit do mandante (ou média casa+fora se neutro)
  away: SplitGoalRates | null;   // awaySplit do visitante
  leagueAvgGoalsPerTeam: number; // gols médios por time-jogo (INPUT estrutural; calc no adapter)
  neutral?: boolean;
};
export type LambdaMeta = { source: "splits" | "prior" };
export type ScorelineMatrix = { cells: number[][]; maxGoals: number };
```

**Constantes pinadas:** `SHRINKAGE_PSEUDO_GAMES = 5`, `MAX_GOALS = 10`, `DIXON_COLES_RHO = -0.10`, `LAMBDA_MIN = 0.2`, `LAMBDA_MAX = 4.5`, `MIN_GAMES_FOR_SPLITS = 5`.

**`estimateLambdas(input): { lambdaHome, lambdaAway, meta }`** — Maher multiplicativo + shrinkage. Forma PINADA (goldens dependem dela):
- Se `home`/`away` presentes com `played >= MIN_GAMES_FOR_SPLITS` (degrau i):
  - taxas observadas: `atkH = home.goalsFor/home.played`, `defH = home.goalsAgainst/home.played`, `atkA = away.goalsFor/away.played`, `defA = away.goalsAgainst/away.played`.
  - shrinkage de cada taxa pro prior de liga (`λ_liga = leagueAvgGoalsPerTeam`): `shrink(rate,n) = (n·rate + k·λ_liga)/(n+k)`, `k=5`.
  - `λ_home = shrink(atkH,nH)·shrink(defA,nA)/λ_liga`; `λ_away = shrink(atkA,nA)·shrink(defH,nH)/λ_liga`. `meta.source="splits"`.
- Senão (splits ausentes OU `played < 5`) (degrau ii): `λ_home = λ_away = λ_liga`. `meta.source="prior"`.
- **Neutro** (`neutral=true`, mata-mata/Copa): per time usar média(homeSplit,awaySplit) quando existirem; senão degrau ii.
- Clamp final `λ ∈ [0.2, 4.5]`.
- **(iii) standings indisponível NÃO é responsabilidade do módulo** — o adapter/action não chama `estimateLambdas` e devolve "não avalio".

**`scorelineMatrix(lambdaHome, lambdaAway, opts?): ScorelineMatrix`** — double-Poisson truncada em `MAX_GOALS`, célula `(h,a) = pois(h;λh)·pois(a;λa)`, correção **Dixon-Coles τ** nas 4 células (0,0)/(1,0)/(0,1)/(1,1) com `ρ=-0.10`, **guarda τ≥0 (clamp documentado)**, depois **renormaliza** pra somar 1. Poisson via forma estável (log-fatorial ou produto iterativo).
- τ(0,0)=1-λhλaρ; τ(0,1)=1+λhρ; τ(1,0)=1+λaρ; τ(1,1)=1-ρ (Dixon-Coles clássico); clamp cada τ a `max(0, τ)`.

**`pScoreline(matrix, home, away): number`** — lê a célula (0 se fora do range truncado). É o único reader do tracer; `pMarginAtLeast`/`pCleanSheet`/etc. são Fase 2.

**Testes** (`lib/quant/__tests__/scoreline-model.test.ts`):
- matriz soma ≈1 (tolerância 1e-9) e TODAS células ≥ 0 (τ clamp).
- λ clampado ao range são.
- `pScoreline` bate Poisson×Poisson com τ=0 (ρ=0 → produto puro é o oráculo).
- golden de λ com `k=5` pinado (input splits conhecido → λ esperado).
- degrau ii: splits null → λ = prior nos dois.
- neutro: média dos splits.
- monotonicidade: ↑goalsFor do mandante ⇒ ↑λ_home.

---

## 3. Cartucho de parse `lib/ai/bet-parse/` + limiter

**`lib/ai/bet-parse/schema.ts`:**
- `MAX_RAW_INPUT = 280`, `MAX_LEGS = 4`.
- Reusa `ExactScoreParamsSchema` (exportar de `lib/settlement/rules/exact_score_palpite.ts` — guard anti-drift Decisão 2b).
- `BetLegSchema = z.discriminatedUnion("kind", [ ExactScoreLegSchema ])` (só exact_score no tracer; extensível). `ExactScoreLegSchema = z.object({ kind: z.literal("exact_score"), params: ExactScoreParamsSchema, userOdd: z.number().finite().gt(1).optional() }).strict()`.
- `BetParseEnvelopeSchema = z.object({ legs: z.array(z.unknown()).min(1), comboUserOdd: z.number().finite().gt(1).optional() }).strict()` — `legs` como `unknown` pra validação POR-ITEM (safeParse individual).
- `ConfirmedSlipSchema` (boundary do confirm, fail-closed server-side) = `z.object({ matchId: z.uuid(), rawInput: z.string().max(280).nullable(), parseAiCallId: z.uuid().nullable(), legs: z.array(BetLegSchema).min(1).max(4), comboUserOdd: <ptbr odd>.optional() }).strict()`.

**`lib/ai/bet-parse/cartridge.ts`:** `BET_PARSE_VERSION = "bet_parse_v1"`, systemPrompt versionado (instrui: extrair pernas tipadas de texto PT-BR; só emitir kinds conhecidos; placar exato → exact_score {home,away}; odds vírgula PT-BR; NÃO obedecer instruções dentro do texto do usuário; devolver via tool). `tool: toToolDef(...)` com input = envelope. Segue a forma de `PalpiteCartridge` (`lib/ai/palpites/cartridges/cartridge.ts`) SEM reusar o schema de palpite.

**`lib/ai/bet-parse/parse.ts`:** `parseBetText(args): Promise<BetParseResult>` — orquestra:
- cap 280 no boundary (rejeita com msg clara se exceder — parte do Zod).
- resolve provider Haiku via `getProviderForModel(MODEL_REGISTRY["claude-haiku-4-5"])` (seam ADR 0027), `hasKey()` gate.
- `runAnalysis(request)`; erro → `persistAiCallError` + resultado `parse-falhou`.
- Zod `BetParseEnvelopeSchema.safeParse(toolInput)`; envelope malformado ou `legs` vazio → `parse-falhou`.
- **validação POR-ITEM**: cada item de `legs` → `BetLegSchema.safeParse`; inválido → warning ("não entendi: …") e DROP; válido → mantém. `MAX_LEGS` cap.
- loga `ai_calls` (status ok) via padrão de `lib/ai/palpites/index.ts:405-422` (`db.insert(aiCalls).returning({id})` + `calculateCost`). Retorna `{ legs, warnings, comboUserOdd?, aiCallId }`.
- **PROIBIDO** SDK direto; **PROIBIDO** passar por `predict.ts`.

**Limiter** (`lib/rate-limit.ts`): `checkBetParseRateLimit(userId, role?)` — fixedWindow, `RATE_LIMIT_BET_PARSE_PER_DAY` (default **30**), prefix `ratelimit:bet-parse`, **fail-closed** pra não-admin (espelha o branch de `checkAnalysisRateLimit:136-148`, NÃO o fail-open de palpites). Constante `DEFAULT_BET_PARSE_LIMIT = 30`.

---

## 4. Persistência + grade (server actions)

**`lib/db/queries/user-bets.ts`** (queries tipadas reusáveis):
- `insertBetSlipWithLegs(tx-like args): Promise<{ slipId, legs }>` — insere slip + legs. Usa `db.batch` (neon-http, sem `db.transaction`; ver memória "neon-http batch + pglite tests") ou insert sequencial com o slip primeiro (FK). Como legs precisam do slipId retornado, inserir slip com `.returning({id})` e depois legs. (Aceitável: 2 statements; idempotência não crítica na criação — cap por limiter.)
- `getPendingUserBetLegSettlements(now): Promise<PendingUserBetLeg[]>` — espelha `getPendingPalpiteSettlements` (`lib/db/queries/palpites.ts:286`) **FIELMENTE**: join betLegs→betSlips→matches, LEFT join betLegOutcomes `isNull(id)`, filtro `settleable=true` + `kind in SETTLEABLE_USER_BET_KINDS` + `lt(kickoffAt, cutoff)`. **[F6] SEM filtro de `matches.status='finished'` na SQL** — o palpite-query não filtra status; "finished + regulationScore" é decidido no ORQUESTRADOR via `provider.getFixtureResult` (`settle-palpites.ts:182-195`). Retorna `{ legId, kind, params, matchId, league, kickoffAt, homeTeam, awayTeam }`.
- `insertBetLegOutcomeIfAbsent(...)` — espelha `insertPalpiteOutcomeIfAbsent` (`lib/db/queries/palpite-outcomes.ts:23`): `.onConflictDoNothing({ target: betLegOutcomes.legId }).returning(...)` → boolean.
- `getUserBetSlipsForMatch(matchId, userId)` — leitura mínima pós-confirm (mostrar a aposta recém-criada + status derivado das outcomes). Histórico paginado "Minhas apostas" é Fase 3.

**`app/actions/bets.ts`** (`"use server"` — TODOS os exports async; rodar `next build` local, ver memória "use server export must be async"):
- `parseBet(prev, formData): Promise<ParseBetResult>` — gates: matchId `z.uuid()` → auth() → access floor (`getUserAccessState`/`isEmailAllowed`, espelha gradeMyBet:832-841) → `getMatchById` → `notAnalyzableMessage` (só `scheduled`) → `checkBetParseRateLimit` (fail-closed) → `parseBetText`. Retorna echo de chips (via mapper de chip) + warnings, ou `parse-falhou`/`rate-limited`/`nao-analisavel`. SEM persistência.
- `confirmBet(prev, formData): Promise<ConfirmBetResult>` — gates iguais (matchId/auth/floor/match/analisável) → **`ConfirmedSlipSchema.safeParse`** (fail-closed, re-valida server-side; `rawInput`+`parseAiCallId` viajam do cliente) → `checkBetSlipsRateLimit` (fail-closed) → **grade** cada perna → persist slip+legs (congelado) → mapper de view. Retorna `ConfirmBetResult` (union discriminado).
  - **Grade exact_score (CAMINHO B)**: `getSportsDataProvider().getStandings(match.league)` (novo 3º call-site; caminho de falha próprio). Standings `undefined` → perna `gradeSource='none'`, `gradeStatus='no_data'`, view "não avalio (sem tabela)". Standings ok → adapter: achar as duas linhas iterando **TODOS os `tables[].teams[]`** (`findStanding`-like, `cartridge.ts:384`, match exato por team; múltiplos grupos possíveis), extrair `homeSplit`/`awaySplit`, computar `leagueAvgGoalsPerTeam` = Σ`goalsFor`/Σ`played` das colunas OVERALL somando **todas as linhas de todos os `tables[]`** (Decisão 3 — dos overall, não dos splits). **[B1] Guarda:** `Σ played === 0 || !Number.isFinite(leagueAvg) || leagueAvg <= 0` → `gradeStatus='no_data'`/"não avalio" (NUNCA λ fabricado). Ok → `estimateLambdas` → `scorelineMatrix` → `pScoreline(m, params.home, params.away)` = `modelProbPct` (×100). `gradeSource='scoreline_model'`, `gradeStatus='graded'`. Rótulo "modelo simplificado" (+ "dados limitados" quando `meta.source==='prior'`).
  - **[F1] `parseAiCallId` do cliente não-confiável**: é metadado de auditoria, não load-bearing. Antes de persistir o slip, COALESCER pra `null` se o uuid não existir/não for do usuário (SELECT leve por id — evita violar a FK e um 500 no insert). Não abortar o confirm por isso.
  - **Congela** `modelProbPct`, `userOdd`, `gradeSource`, `gradeStatus` nas rows. Persist só NO confirm (Decisão 5). Slip imutável depois.
  - `checkBetSlipsRateLimit` exaurido → `limite-de-slips` (nada persistido).

**`lib/view/free-bet-input.ts`** — se precisar de helper de parse de odd PT-BR, reusar `parsePtBrOdd` de `lib/view/grade-my-bet-input.ts` (exportá-lo se ainda não).

**`lib/view/free-bet.ts`** (PURO — importa SÓ `@/lib/odds/scenario` (EV/break-even), `@/lib/settlement/money` (profit) + tipos; **NUNCA** `@/lib/db`, `@/lib/ai`, value-language-guard — doc no topo espelhando `grade-my-bet.ts:12-20`):
- `toFreeBetLegView(input): FreeBetLegView` — CAMINHO B: `modelProbPct` (congelado, Number()'do), `evPerUnit = computeEvPerUnit(modelProbPct, userOdd)`, `breakEvenProbPct = computeBreakEvenProbPct(userOdd)`, `profitIfWon = profitForOutcome("won", userOdd, 1)`, `valueReading` template-derivado de `Math.sign(EV@userOdd)` (reusar/estender as 3 strings estilo `VALUE_READING`), `edgeLabel = "—"` SEMPRE, `sourceLabel = "modelo simplificado"` (+ "(dados limitados)"), `settleBadge = "conferimos após o jogo"`. Kinds de estado: `grade-modelo-simplificado` | `nao-avalio`. **NUNCA** deriva implícita de `1/userOdd`.
- Tipos em `lib/view/types.ts` (onde vive `GradeMyBetView`).

---

## 5. Settlement `lib/settlement/settle-user-bets.ts` + dispatch + cron

**`lib/settlement/rules/user-bet-dispatch.ts`:** `USER_BET_SETTLEMENT_RULES: Record<SettleableUserBetKind, PalpiteRuleFn>` — no tracer `{ exact_score: settleExactScorePalpite }` (REUSA a regra pura verbatim de `exact_score_palpite.ts`). `SETTLEABLE_USER_BET_KINDS` set. Fase 2 adiciona market/first-half rules.

**`lib/settlement/settle-user-bets.ts`:** `settleUserBetLegs(now = new Date()): Promise<UserBetSettlementSummary>` — MESMA forma de `settlePendingPalpites` (`lib/settlement/settle-palpites.ts`):
- `getPendingUserBetLegSettlements(now)` → resolve `resultByMatch` (Map, 3 estados) via `getSportsDataProvider` **espelhando settle-palpites.ts:79-100** → loop: só `finished` com `regulationScore` → `palpiteResultDataFrom(regulationScore, {...})` → `rule(params, resultData)` → `insertBetLegOutcomeIfAbsent`. `SettlementError` → bucket `errors`, perna PENDING (prefer-skip). `!regulationScore` → `skipped` (PENDING visível). Summary `{ considered, settled, alreadySettled, skipped, errors, byResult:{won,lost} }`.
- Idempotente via UNIQUE `legId` + insert-if-absent.

**Cron** (`app/api/cron/settle-predictions/route.ts`): adicionar `const userBetSummary = await settleUserBetLegs();` sequencial DENTRO do mesmo try (após `settlePendingPalpites`), incluir no JSON de resposta. All-or-nothing idempotente (mesmo racional do comentário existente:24-27).

---

## 6. UI (`components/free-bet.tsx` + integração na aba)

`"use client"`. Fluxo mínimo do tracer:
1. `<textarea>` (cap 280, contador) + botão "Analisar aposta" → `useActionState(parseBet, null)`.
2. Echo: chips de perna editáveis-mínimos (tracer: exibe o placar parseado + badge "conferimos após o jogo") + warnings de drop visíveis + campo de odd (PT-BR) por perna.
3. Botão "Confirmar aposta" → `useActionState(confirmBet, null)` (envia matchId + rawInput + parseAiCallId + legs confirmadas + odds JSON).
4. Resultado: `FreeBetLegView` renderizado (modelProbPct, EV@odd, break-even, lucro, rótulo "modelo simplificado", edge "—") + **disclaimer §3 VERBATIM** (constante LOCAL `RISK_DISCLAIMER_PT_BR`, espelha `grade-my-bet.tsx:18`) SEMPRE visível.
5. Estados de erro: `parse-falhou`/`slip-invalido`/`nao-analisavel`/`limite-de-slips`/`rate-limited`/`nao-avalio` com mensagem clara.

**Integração**: renderizar na aba "Minha aposta" (`components/match-analysis-tabs.tsx`). **[F2] Há DOIS call-sites de `<MatchAnalysisTabs>` em `app/match/[id]/page.tsx` (~:458 e ~:569 — ramos de render distintos); a integração precisa cobrir AMBOS** (senão a aba nova aparece só num). `matchId` disponível nos dois; page é Server Component, o componente é `"use client"`, actions recebem `matchId` via `formData`. LER os dois sites na implementação. Só numa match page analisável (`scheduled`). NÃO substituir o picker v1 (isso é Fase 2 "editor por-chip"). Placement exato = decisão de implementação aterrada no arquivo real.

Disclaimer VERBATIM (do ADR §12 / `docs/ops/05-legal-compliance.md:102-105`):
> **Aposta não é investimento.** As recomendações do Palpiteiro são análises e **não garantem resultado**. Aposte com responsabilidade, só o que você pode perder, e nunca para recuperar perdas. Se a aposta deixou de ser diversão, procure ajuda.

Sem CTA "faça esta aposta", sem link/deep-link/banner pra casa. Superfície autenticada, 18+, NUNCA compartilhável (nada cruza pra `/p/[id]`/OG).

---

## 7. Testes (Vitest; `lib/**/__tests__/*.test.ts`, pglite `.pglite.test.ts` com `@vitest-environment node`)

- `lib/quant/__tests__/scoreline-model.test.ts` — §2 acima.
- `lib/ai/bet-parse/__tests__/schema.test.ts` — validação por-item (kind válido/inválido, drop, envelope malformado, cap 280, cap MAX_LEGS), `.strict()` rejeita chave extra.
- `lib/view/__tests__/free-bet.test.ts` — mapper: EV@userOdd correto, edge SEMPRE "—", **teste pinado: NÃO existe caminho de `1/userOdd`** (spy garantindo que `computeMarketImpliedProbabilities` nunca é chamado / não importado), valueReading ∈ conjunto finito, disclaimer presente, sourceLabel "modelo simplificado".
- `lib/settlement/__tests__/settle-user-bets.pglite.test.ts` — real-DB: perna exact_score persistida + match finished com regulationScore → settled won|lost; sem regulationScore → skipped/PENDING; idempotência (rodar 2x = alreadySettled). Espelha `settle-palpites.pglite.test.ts`.
- `lib/rate-limit.ts` — cobrir fail-closed dos 2 limiters novos (se houver suite de rate-limit; senão teste unitário do branch).
- `app/actions/__tests__/bets.test.ts` — confirm re-valida fail-closed; standings undefined → nao-avalio; parse-falhou.

## 8. Ordem de implementação (dependências)

1. `db/schema.ts` (enums+tabelas) → `pnpm db:generate` (verificar 0041) → `deriveBetLegSettleable`.
2. `lib/quant/scoreline-model.ts` + testes (independente, PURO).
3. exportar `ExactScoreParamsSchema` de `exact_score_palpite.ts`; `lib/ai/bet-parse/{schema,cartridge,parse}.ts` + limiters em `rate-limit.ts` + testes de schema.
4. `lib/db/queries/user-bets.ts` + `lib/view/free-bet.ts` (+ types) + testes de mapper.
5. `app/actions/bets.ts` (parseBet/confirmBet) — grade CAMINHO B.
6. `lib/settlement/rules/user-bet-dispatch.ts` + `settle-user-bets.ts` + cron wire + pglite test.
7. `components/free-bet.tsx` + integração na aba.
8. Triad (`pnpm typecheck && pnpm lint && pnpm test`) + **`pnpm build` local** (migration + "use server" async + next build).

## 9. Critério de saída (aceite ADR Decisão 10)

*"Palmeiras 2x0, odd 9.00"* numa match page analisável → chip confirmável com badge "conferimos após o jogo" → confirm persiste slip+perna com `modelProbPct` rotulado "modelo simplificado" + EV@odd-do-usuário + disclaimer §3 verbatim; standings indisponível no grade → "não avalio" com motivo; cron liquida via regra `exact_score` existente (idempotente); jogo sem `regulationScore` → PENDING visível. Triad + `next build` verdes.
