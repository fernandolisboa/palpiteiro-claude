# PLAN — Aposta livre Fase 3 (#473, fecha ADR 0036)

> Snapshot pré-issue. Combinada same-game via joint-sum + histórico "Minhas apostas".
> Aterrado no código das Fases 1+2 em main (`6748d064`).

## Objetivo

Ligar `jointProbability(matrix, predicates[])` (Decisão 4) no `confirmBet`, persistir
`jointProbPct`, renderizar o card de combinada (joint + marginais Poisson + EV
condicional) e a seção "Minhas apostas" (histórico paginado, status derivado).

## Passos

### 1. `legToScorePredicate` (puro) — `lib/bets/grade-scoreline.ts`

`legToScorePredicate(kind, params): ScorePredicate | null`. Mapeia UMA perna → predicado
`(h,a)=>boolean` sobre o **placar final**. Espelha os `sumWhere` dos readers:

- `exact_score` → `h===home && a===away`
- `margin` → `side==='home' ? h-a>=k : a-h>=k`
- `clean_sheet` → `side==='home' ? a===0 : h===0`
- `over_under` → over: `h+a>line`; under: `!(h+a>line)`
- `match_result` → home: `h>a`; draw: `h===a`; away: `a>h`
- `btts` → yes: `h>=1&&a>=1`; no: `!(h>=1&&a>=1)`
- `double_chance` → home_draw: `h>=a`; home_away: `h!==a`; draw_away: `a>=h`
- `first_half_score` / `first_half_over_under` / `first_to_score` / `cards` / `corners` → **null** (fora do joint)

### 2. `computeSlipJoint` (puro) — `lib/bets/grade-scoreline.ts`

Reusa `computeMatchLambdas` + `scorelineMatrix` (MESMA matriz do slip). Recebe legs já
sabidas com predicado não-null:

```ts
computeSlipJoint({ standing, homeTeam, awayTeam, neutral, legs }): 
  { jointProbPct; marginalsPct: number[]; degradedData } | null
```

- `computeMatchLambdas` null → retorna null (sem grade → "combinada não avaliada").
- `jointProbPct = jointProbability(matrix, preds) * 100`
- `marginalsPct[i] = jointProbability(matrix, [preds[i]]) * 100` — **as marginais Poisson
  da MESMA matriz** (garante `joint ≤ min(marginais)`). NUNCA usa `modelProbPct` das pernas
  (que pra Caminho A é o número do cartucho — fonte diferente).

### 3. `confirmBet` computa + persiste o joint — `app/actions/bets.ts`

Após processar as pernas (step 8), **só quando `slip.legs.length >= 2`**:

- **Computável** sse: TODA perna mapeia predicado não-null (`legToScorePredicate`) **E**
  TODA perna processada tem `gradeStatus ∈ {graded, degraded_no_snapshot}` (número real).
  Qualquer perna fora do joint (1º tempo/first_to_score/cards/corners) OU sem grade
  (rate_limited/no_data/not_covered) → **"combinada não avaliada"** (nunca precifica combo
  diferente do apostado).
- Computável → `computeSlipJoint` → persiste `jointProbPct` no slip. EV **só** com
  `comboUserOdd !== null` E joint computável: `computeEvPerUnit(jointProbPct, comboUserOdd)`.
  Sem odd → só a prob conjunta + marginais (nunca EV parcial — Decisão 4c).
- Devolve `combo` no `ConfirmBetResult` (view do card + marginais Poisson).

`insertBetSlipWithLegs` ganha `jointProbPct: number | null` (`.toFixed(2)` no insert).

### 4. Mapper puro do card — `lib/view/free-bet.ts`

`FreeBetComboView` + `toFreeBetComboView(input)`:

- `{ kind: "combinada"; jointProbPct; sourceLabel; legs: {selectionLabel, marginalPct}[]; value: {comboUserOdd, evPerUnit, breakEvenProbPct, valueReading, profitIfWon} | null }`
- `{ kind: "combinada-nao-avaliada"; reason }`

`sourceLabel` = "modelo simplificado" (+ " (dados limitados)" se degradedData). Reusa
`computeEvPerUnit`/`computeBreakEvenProbPct`/`profitForOutcome`/`valueReadingForSign`.

### 5. Query de histórico paginado — `lib/db/queries/user-bets.ts`

`getUserBetSlipsPage({ userId, cursor?: Date, limit=20 }): { slips: BetSlipHistoryRow[]; nextCursor: Date | null }`

- Cursor `createdAt < cursor` (desc, `id` desc de tiebreak); `limit+1` fetch pra próxima página.
- **`userId` SEMPRE do `auth()` da página, NUNCA de rota/query** (anti-IDOR).
- Query 1 = slips paginados (join `matches` p/ jogo). Query 2 = legs+outcomes das slip ids.
- **Status derivado em LEITURA** por função pura `deriveSlipStatus(legs)` (pglite-testável;
  derivado-não-armazenado). **Precedência PINADA** (Decisão 5, lost domina):
  `errou` se alguma perna tem outcome `lost` → senão `nao_conferida` se alguma `settleable=false`
  → senão `acertou` se TODA perna tem outcome `won` → senão `pendente`. Perna pendente tem
  `outcome=null` → não é `won` → nunca falso-`acertou` (a armadilha do `bool_and` sobre NULL).
- `jointProbPct`/`comboUserOdd` voltam **string** (numeric) → `Number()` na fronteira do
  mapper antes de qualquer EV. Status NUNCA recomputado no render.

### 6. UI

- **Editor** (`components/free-bet.tsx`): campo editável de **odd combinada** quando
  `legs.length >= 2` (semeado de `meta.comboUserOdd`, string PT-BR no slip).
- **Card de combinada** no `confirmState`: joint + marginais Poisson por perna + EV
  condicional, rotulado "modelo simplificado"; OU "combinada não avaliada".
- **Página `/apostas`** ("Minhas apostas"): histórico paginado cursor. Card por slip:
  jogo, pernas (label + outcome), joint persistido (rotulado) + odd + EV + status derivado
  (acertou/errou/pendente/não conferida). Disclaimer §3 verbatim. Link do `/perfil`.
  - **Histórico NÃO mostra marginais** (não persistidas; joint sozinho + rótulo é seguro —
    a forma-dura é joint *ao lado de* marginal de outra fonte). Re-render do persistido.

### 7. Testes

- **`legToScorePredicate` / `computeSlipJoint`** (puro): oráculos `joint(super) ≤ joint(sub)`,
  `joint ≤ min(marginais)`.
- **Teste pinado anti-multiplicação**: legs correlacionadas (match_result home + over 2.5),
  `joint ≠ marginal_a × marginal_b` E `joint ≤ min`.
- **pglite** do histórico: paginação cursor + status derivado (won/lost/pending/não conferida).
- Mapper do card (golden do render).

## Não-objetivos / já feito

- Limiter de slips 30/dia fail-closed **já cobre editor-only** (confirmBet step 5, Fase 2) —
  sem trabalho, talvez 1 teste.
- Sem migration nova (`comboUserOdd`/`jointProbPct` em 0041).
- Slip imutável e NUNCA compartilhável — histórico autenticado/privado, nada cruza pra `/p/[id]`.

## Critério de saída

Slip "Palmeiras vence + mais de 1.5" @ odd combinada 2.10 → card mostrando joint (< cada
marginal Poisson exibida) + EV@odd; adicionar perna de 1º tempo/first_to_score → "combinada
não avaliada". `/apostas` pagina o histórico com status derivado. Triad + `next build` verdes.
