# PLAN-547 — Avaliação da aposta (Caminho B) no Dixon-Coles

Issue: #547. ADR 0051 já previa: "migrar é trocar a chamada por `getModelScoreline`".

## Problema

`confirmBet` (`app/actions/bets.ts`) gradeia as pernas do Caminho B (props, mercado fora do gate/sem odd) e a combinada same-game com `lib/bets/grade-scoreline.ts`, que monta λ via `computeMatchLambdas` (heurístico da tabela). A análise do mesmo jogo usa `getModelScoreline` (DC com fallback heurístico, flag `enableDixonColes`). Dois números pro mesmo jogo, e o heurístico é o pior dos dois no backtest.

## Mudança

1. **`lib/bets/grade-scoreline.ts` fica puro sobre um `ModelScoreline`**
   - `gradeScorelineLeg({ model, kind, params })` com `model: ModelScoreline | null`. `null` → `no_data`. Preço da matriz cheia sai de `model.matrix` (carrega o ρ do fit no DC); 1º tempo e first-to-score continuam derivando de `model.lambdaHome/lambdaAway`. Retorno ganha `source: ModelScorelineSource`; `degradedData = model.degraded`.
   - `computeSlipJoint({ model, legs })` idem: joint e marginais sobre `model.matrix`; retorna `source`.
   - Re-export de `computeMatchLambdas` mantido (call-sites/testes).
2. **`app/actions/bets.ts`**: depois de ler a tabela (passo 7), resolve `getModelScoreline({ league, homeTeam, awayTeam, standing, neutral })` UMA vez e guarda em `LegContext.model` (substitui `standing`). `getModelScoreline` não lança (falha de leitura dos ratings → heurístico com `fallbackReason: "error"`). Sem nova query por perna; flag memoizado 60s como na análise.
3. **Rótulo (`lib/view/free-bet.ts`)**: input do mapper ganha `source`. `sourceLabel` = "modelo Dixon-Coles" (DC) | "modelo simplificado" | "modelo simplificado (dados limitados)". `VALUE_READING` troca "Pelo modelo simplificado" por "Pelo modelo de placar" (vale pros dois motores). Comentários de `lib/view/types.ts` e `components/free-bet.tsx` acompanham.
4. **ADR 0051**: a nota de consequências passa a dizer que o grader migrou (#547).

## Fora do escopo

Caminho A (cartucho), schema/persistência (nenhuma coluna nova: a fonte só aparece na view do confirm), `/jogos`, catálogo de mercados, dashboard.

## Testes

- `grade-scoreline.test.ts`: helper monta `ModelScoreline` heurístico via `pickModelScoreline({ dc: null, heuristic: computeMatchLambdas(...) })` → asserts existentes valem sem mudar números. Casos novos: modelo DC (ρ ≠ pinado) → `pScoreline(model.matrix, …)` bate e `source = "dixon_coles"`; DC e heurístico dão números diferentes pro mesmo jogo; `model = null` → `no_data` / joint `null`; combinada usa `model.matrix`.
- `free-bet.test.ts`: rótulos por fonte e o novo texto do valueReading.

## Riscos

- Nomes de time: `getMatchRatings` usa o mesmo `match.homeTeam/awayTeam` que `predict.ts` passa → mesmo lookup da análise.
- Latência do confirm: +1 leitura de flag (memo) + 1 query de ratings. Aceitável.
