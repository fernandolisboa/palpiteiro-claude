# ADR 0016 — Settlement por mercado: registry de regras, push e result_data genérico

## Status

Accepted (2026-06-12) — detalha o **ADR 0015** (pivot multi-mercado) no eixo de settlement

## Contexto

O settlement de hoje é gol-específico e binário:

- `lib/settlement/compute.ts:9` `export const OVER_UNDER_LINE = 2.5`; `SettlementInput` cujo
  único fato do jogo é `totalGoals` (`compute.ts:11-18`); docstring "The 2.5 line never pushes,
  so over/under always yields won or lost" (`compute.ts:36-37`); a regra
  `won = recommendation === "over" ? totalGoals > 2.5 : totalGoals < 2.5` (`compute.ts:51-54`);
  e o cálculo de dinheiro `won → round2(stake*(odd−1))`, `lost → round2(−stake)`
  (`compute.ts:56-58`). `pass` curto-circuita pra `{ void, 0 }` (`:42-44`); um não-`pass` com odd
  nula devolve `null` = skip (`:46-49`).
- O enum `outcome_result` é fechado em `won/lost/void` (`db/schema.ts:40-44`) — **não expressa
  push** nem half-win/half-loss.
- `prediction_outcomes` persiste **só** `total_goals` (inteiro, `db/schema.ts:247`) como fato do
  jogo — **não há `home_score`/`away_score`**. O `total_goals` é a soma `regulationScore.home +
  regulationScore.away` feita em `lib/settlement/settle.ts:88-89` **antes** de chamar `compute`,
  que nunca vê o placar por lado.
- `settle.ts` traz `SettlementSummary.byResult: { won; lost; void }` (`:16`), idempotência via
  `insertOutcomeIfAbsent` (`onConflictDoNothing` no `predictionId` único, `prediction-outcomes.ts:21-35`)
  e override manual via `upsertOutcomeOverride` (`onConflictDoUpdate`, sobrescreve + bumpa
  `settledAt` + grava `overrideByUserId`). `SETTLEMENT_MIN_ELAPSED_MS = 150*60*1000`
  (`lib/db/queries/predictions.ts:67`) é um corte **só temporal**; o check de `status === "finished"`
  + `regulationScore` não-nulo é no `settle.ts:83`.
- `getPendingSettlementPredictions` (`predictions.ts:92-103`) **não seleciona a coluna `market`** —
  assume mercado único, despachando sempre pro `compute` da linha 2.5.

O pivot (ADR 0015) admite mercados com **mais de duas seleções** (1X2) e mercados que **podem dar
push** (linhas inteiras, handicap) ou **half** (linhas de quarto). Este ADR define o settlement
genérico: um **registry de regras por mercado**, `result_data` padronizado e a semântica de
**push/void/half** no Yield.

## Decisão

1. **Registry de regras de settlement por `markets.settlement_rule_key`.** Cada regra é uma
   **função pura** que decide o **outcome** da seleção a partir dos dados congelados da predição e
   do fato do jogo:

   ```
   (selection, marketParams, resultData) -> SettlementOutcome
   SettlementOutcome = "won" | "lost" | "push" | "half_win" | "half_loss"
   ```

   O **dinheiro fica num único lugar compartilhado** (não em cada regra), parametrizado pela odd e
   pelo stake congelados na predição:

   ```
   profitUnits(outcome, oddAtRecommendation, stakeUnits):
     won       ->  round2( stake * (odd - 1) )
     lost      ->  round2( -stake )
     push      ->  0                       // stake devolvido
     half_win  ->  round2( 0.5 * stake * (odd - 1) )   // metade ganha na odd, metade push
     half_loss ->  round2( -0.5 * stake )              // metade perde, metade push
   ```

   `pass` continua curto-circuitando pra `{ result: "void", profit_units: 0 }` **antes** do
   registry (não tem seleção nem odd). A interface efetiva que o `settle.ts` consome continua sendo
   `{ result, profit_units }` (como `SettlementInput → { result, profit_units }` hoje) — o split
   regra-pura-de-outcome vs cálculo-de-dinheiro é interno e mantém o cálculo de profit testável e
   único, espelhando o que o `compute.ts:51-58` já faz (separa o booleano `won` da conta de
   dinheiro). Isso isola a variação por mercado num ponto (o registry), sem `if (market === X)`
   espalhado (princípio transversal do ADR 0015).

2. **`result_data` jsonb padronizado, coletado UMA vez por jogo.** No MVP o fato do jogo é o
   **placar de 90'** — mas precisa do placar **por lado**, não só do total:

   ```
   resultData (MVP) = { "home_score": <int>, "away_score": <int> }   // regulationScore (90', sem ET/pênaltis)
   ```

   O `total_goals` de hoje (`home + away` somados) **não basta** pros mercados novos: 1X2 precisa do
   sinal `home − away`, BTTS precisa de `home > 0 && away > 0`. O provider **já** entrega
   `regulationScore.{home, away}` (`settle.ts:88-89` hoje só os soma); passa a **persistir os dois**
   em `result_data`. `total_goals` vira derivado (`home_score + away_score`) nas predições novas. Pro **histórico**, o backfill é
   determinístico mas **não reconstrói** o placar por lado (ADR 0015, decisão 5: `result_data` é
   derivado do escalar `total_goals` — `T=3` poderia ser 2-1, 3-0 ou 0-3): as rows antigas carregam
   só o total, e os mercados que precisam do split (1X2/BTTS) **degradam** nelas; predições novas
   persistem `{home_score, away_score}` em cheio. Todos os mercados do MVP (1X2, O/U
   multi-linha, BTTS, Dupla chance) settlam **só com esse `result_data`** — nenhum exige provider
   novo (isso é Tier 3, ADR 0015).

   Toda forma em `result_data`/`marketParams` é **validada por Zod** no boundary do settlement
   (mesma disciplina da saída do LLM).

3. **`push` entra no enum `outcome_result` (D5).** `outcome_result = won | lost | void | push`.
   `push` = aposta resolvida que **devolve o stake** (profit 0): acontece quando a seleção empata
   com a linha (ex. over/under numa linha **inteira** — total = 2 numa linha 2.0; handicap 0). Os
   mercados do **MVP usam linhas de meio-gol** (1.5/2.5/3.5) e seleções discretas (1X2/BTTS/DC) que
   **nunca dão push** — `push` é adicionado **proativamente** pro domínio que o ADR 0015 abre, e
   exercido quando um mercado com linha que empata entrar.

4. **Half-win/half-loss via `profit_units` fracionário (D5), sem novo valor de enum.** Linhas de
   **quarto** (handicap asiático 0.25/0.75) dividem o stake em duas meias-apostas (uma na linha de
   baixo, outra na de cima). O registry pode devolver `half_win`/`half_loss`; o `result` **persistido**
   continua `won`/`lost` (o lado majoritário), e o `profit_units` carrega a fração
   (`0.5*stake*(odd−1)` ou `−0.5*stake`) — a coluna `profit_units` já é `numeric(8,2)`, comporta.
   **Handicap asiático fracionado fica FORA do MVP** (ADR 0015, Tier 3); este ADR só fixa o
   contrato pra quando entrar.

5. **Semântica de push/void/half nas métricas (contrato que o dashboard implementa).**
   - **Win rate** = `won / (won + lost)`. `push` e `void` **não contam** (nem vitória nem derrota),
     exatamente como `void` já é excluído hoje. Half-win conta como `won`, half-loss como `lost`
     (o `result` persistido).
   - **Yield** = `Σ profit_units / Σ stake_units` sobre as apostas **Yield-bearing** (`won`/`lost`,
     incl. half via `result` won/lost). `push` é **no-action**: profit 0 e stake devolvido →
     **excluído de numerador e denominador** (mesmo tratamento estrutural do `void` em
     `lib/dashboard/kpis.ts:145-153`, onde a exclusão "não depende de `void.profitUnits === 0`").
   - **Go/no-go por mercado (ADR 0015, D9):** o limiar de **≥30 apostas resolvidas** conta o conjunto
     **Yield-bearing** (`won`+`lost`); `push`/`void` são settled mas não carregam sinal de edge e
     **não** contam pras 30. Mantém "≥30 resolvidas + Yield positivo" coerente (mesmo conjunto).
   - `OutcomeResult` (`compute.ts:7`), `RowStatus`/`StatusFilter` (`kpis.ts:29-30`) e o campo
     `result` de `DashboardRow` (`kpis.ts:24`) ganham `push`; `byResult` (ponto 6) idem.

6. **`SettlementSummary.byResult` vira union aberto sobre `OutcomeResult`.** Hoje é um objeto fixo
   `{ won; lost; void }` (`settle.ts:16,41`) incrementado **só** pras rows recém-inseridas (branch
   `if (inserted)`, `settle.ts:110-112`); passa a incluir `push` (e o que mais o enum tiver). Os
   buckets `skipped` (não finalizado / sem odd de entrada) e `errors` (lookup do provider lançou)
   continuam distintos.

7. **`getPendingSettlementPredictions` passa a selecionar `market` (e `market_id`/`selection_id`/
   `market_params`)** pra despachar pra regra certa do registry. O corte temporal
   (`SETTLEMENT_MIN_ELAPSED_MS`, `kickoffAt < now − 150min`) e o gate de `status === "finished"` +
   `result_data` presente são preservados.

8. **Idempotência e override manual preservados (cidadãos de 1ª classe).** O caminho do cron
   (`insertOutcomeIfAbsent`, `onConflictDoNothing`) **nunca** sobrescreve; o override
   (`upsertOutcomeOverride`, `onConflictDoUpdate`) sobrescreve, bumpa `settledAt` e grava
   `overrideByUserId`. A garantia "override vence pra sempre" é **estrutural**: uma vez que existe
   qualquer outcome row, o filtro `isNull(predictionOutcomes.id)` do `getPendingSettlementPredictions`
   exclui a predição — o cron não a re-toca. O `UNIQUE(prediction_id)` é o backstop. Tudo isso vale
   por mercado, inalterado.

## Razão

- **Regra pura + dinheiro compartilhado** torna cada mercado testável por cenário (o critério de
  aceite pede a tabela de cenários) e mantém a conta de profit num lugar só — exatamente a forma do
  `compute.ts` atual, generalizada.
- **`result_data = { home_score, away_score }`** é o menor fato que cobre os 4 mercados do MVP;
  derivar `total_goals` dele é trivial, e o provider já o entrega. Guardar só o total (como hoje)
  fecharia a porta pra 1X2/BTTS sem nova coleta.
- **`push` no enum + half via `profit_units`** seguem a postura de D5: o enum expressa o desfecho
  qualitativo (won/lost/void/push), e a granularidade fina (half) mora no número, sem explodir o
  enum.
- **Excluir push como void** reaproveita o tratamento estrutural já existente e honesto do `void` no
  Yield, sem inventar um caminho de bug novo.

## Alternativas consideradas

- **Manter `compute` único com `if (market === ...)`:** rejeitado — espalha a variação e contraria o
  princípio não-aditivo do ADR 0015; o registry concentra num ponto.
- **Guardar só `total_goals` (status quo) e derivar tudo:** rejeitado — impossível recuperar o placar
  por lado do total; 1X2/BTTS ficariam sem fato. `result_data` por lado é o mínimo viável.
- **Modelar half-win/half-loss como novos valores de enum:** rejeitado — polui o enum e a UI/win-rate
  com estados raros (handicap fracionado, fora do MVP); D5 manda fração no `profit_units`, `result`
  won/lost.
- **Push contando no denominador do Yield (stake "arriscado"):** rejeitado — push devolve o stake
  (no-action); incluí-lo arrastaria o Yield pra zero artificialmente. Tratado como `void`.
- **Coletar `result_data` por mercado (N coletas/jogo):** rejeitado — o fato do jogo (placar 90') é
  **um só**; coleta 1x/jogo e cada regra deriva o que precisa.

## Consequências

- (+) Novo mercado = **uma regra pura** no registry + seed em `markets.settlement_rule_key`; zero
  toque no caminho comum.
- (+) `result_data` por lado destrava 1X2/BTTS/Dupla chance sem provider novo nem coleta extra.
- (+) Cenários testáveis isoladamente (regra pura) — base pra suíte por cenário (ponto 9 abaixo).
- (−) Migration: `outcome_result` ganha `push` (`ALTER TYPE ADD VALUE`), `prediction_outcomes` ganha
  `result_data` jsonb; `getPendingSettlementPredictions` passa a trazer `market*`. (Implementação é
  Fase 1/2 — **não** nesta fase de ADRs.)
- (−) `byResult` aberto + `push` no `OutcomeResult` rippla em tipos do dashboard (`RowStatus`,
  `StatusFilter`) — endereçado em #166/#171.
- (±) `total_goals` vira derivado; mantido por compat até o contract (ADR 0015, decisão 5).

## Tabela de cenários (referência pros testes)

`result_data = { home_score: h, away_score: a }`; `T = h + a`. Odd e stake congelados na predição.

| Mercado (`settlement_rule_key`) | `market_params` | Seleção | Exemplo `result_data` | Outcome | `profit_units` |
| --- | --- | --- | --- | --- | --- |
| `over_under` | `{line:2.5}` | over | `{2,1}` T=3 | won | `stake*(odd−1)` |
| `over_under` | `{line:2.5}` | under | `{2,1}` T=3 | lost | `−stake` |
| `over_under` | `{line:2.5}` | under | `{1,1}` T=2 | won | `stake*(odd−1)` |
| `match_result` | `{}` | home | `{2,0}` h>a | won | `stake*(odd−1)` |
| `match_result` | `{}` | away | `{2,0}` h>a | lost | `−stake` |
| `match_result` | `{}` | draw | `{1,1}` h=a | won | `stake*(odd−1)` |
| `btts` | `{}` | yes | `{2,1}` ambos>0 | won | `stake*(odd−1)` |
| `btts` | `{}` | no | `{2,0}` um=0 | won | `stake*(odd−1)` |
| `double_chance` | `{}` | home_draw (1X) | `{1,1}` h≥a | won | `stake*(odd−1)` |
| `double_chance` | `{}` | home_draw (1X) | `{0,1}` h<a | lost | `−stake` |
| — (qualquer) | — | `pass` | — | void | 0 |
| _(futuro)_ `over_under` linha inteira | `{line:2.0}` | over | `{1,1}` T=2 | **push** | 0 |
| _(futuro)_ handicap asiático | `{line:-0.25}` | home | `{0,0}` (empate, hcp −0.25) | **half_loss** | `−0.5*stake` |

## Referências

- Issue **#153**; detalha o **ADR 0015** (pivot multi-mercado, modelo de domínio) no eixo de
  settlement. Implementação: Fase 1/2 (#161 `result_data`+push, #166 settlement plugável).
- Código: `lib/settlement/compute.ts` (linha 2.5, won/lost, profit), `lib/settlement/settle.ts`
  (`byResult`, `regulationScore`, idempotência/override), `lib/db/queries/predictions.ts:67`
  (`SETTLEMENT_MIN_ELAPSED_MS`), `lib/db/queries/prediction-outcomes.ts` (insert/override),
  `lib/dashboard/kpis.ts` (Yield/win rate, exclusão estrutural do void), `db/schema.ts`
  (`outcome_result:40`, `prediction_outcomes:241`), `lib/providers/sports-data/types.ts`
  (`regulationScore`).
- Preserva idempotência (`insertOutcomeIfAbsent` + `UNIQUE(prediction_id)`) e override manual.
