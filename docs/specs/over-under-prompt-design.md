# Over/Under — Prompt Design Spec (cartucho `over_under`)

**Status:** ATIVO em produção · **Versão:** `over_under_v2.0` · **Mercado:** N=2 (over/under), com **linha**
parametrizada (`market_params.line`, 2.5 hoje).

Instancia a [spec-mãe](./cartridge-prompt-contract.md) pro mercado over/under — o **primeiro cartucho**.
Tudo que é transversal (fronteira LLM↔predict.ts, edge N-vias, pass-first, tolerância Zod, staking,
settlement, versionamento + replay-eval, três vocabulários) está na spec-mãe; aqui ficam só as decisões
**específicas** do over/under.

Código: `lib/ai/markets/over_under/{prompt,schemas,build-input,user-message,index}.ts`. Descriptor:
`OVER_UNDER` em `lib/odds/market-descriptor.ts`. Settlement: `lib/settlement/rules/over_under.ts`.
Apresentação: `getMarketPresentation("over_under")` em `lib/view/markets/presentation.ts`.
Referências: ADR [0003](../decisions/0003-over-under-only-market.md) (over/under como 1º mercado),
[0017](../decisions/0017-cartuchos-de-prompt-por-mercado.md), [0018](../decisions/0018-edge-ev-cenarios-multi-mercado.md).

## Seleções e descriptor

- **Seleções:** `over` / `under` (`descriptor.selectionKeys = ["over","under"]`, mesma ordem em
  `cartridge.selections`).
- **Provider:** `providerMarketKey = "totals"` (The Odds API, mercado *featured*). `resolveSelectionKey`
  casa `outcome.point === params.line` e o nome (`Over`/`Under`) → `over`/`under`.
- **Linha:** `params.line` (2.5 hoje). É o único mercado **com linha**; linhas extras (1.5/3.5) reusam
  **este mesmo cartucho** sem prompt novo (#175) — a linha vem no payload, não no prompt.
- **`dbMarketKey = "over_under"`**; enum legado `over_under_2_5` é dual-write só deste mercado (spec-mãe §9).

## Saída do LLM (`OverUnderOutputSchema`, `lib/ai/markets/over_under/schemas.ts`)

Campos: `recommendation` (`over`/`under`/`pass`), `confidence_pct`, `rationale`, `key_factors`,
`minimum_odd` (opcional). `required: [recommendation, confidence_pct, rationale, key_factors]`.

- **Convenção do `confidence_pct`:** probabilidade estimada do **lado recomendado**; quando `pass`, é a
  melhor estimativa de **`over`** (a convenção binária P(over) — válida só em N=2; mercados N≥3 não têm um
  "lado canônico", ver as suas specs).
- **`minimum_odd`:** obrigatório quando `recommendation ∈ {over,under}`, **omitido** quando `pass`
  (única regra do `superRefine`). Validado pelo Zod só como `z.number().positive()`.

### Tolerância (guia do tool vs Zod imposto) — spec-mãe §6

| Campo | Tool JSON Schema (guia pro LLM, **não imposto**) | Zod (imposto, tolerante) |
| --- | --- | --- |
| `rationale` | `maxLength: 600` | `.min(1)` + **truncate 2000** (teto de segurança; sem cap em 600) |
| `key_factors` | `minItems: 2`, `maxItems: 5`, item `maxLength: 160` | `.min(1)` item (**não 2**), cada item **truncate 300**, array **`.slice(0,5)`** (descarta extras, não rejeita) |
| `confidence_pct` | `0–100` | `∈ [0,100]` |

O nudge de concisão do `rationale` (~450 chars) vive na *description* da tool, não como limite duro.

## Pass e floor de edge

Por ADR 0003 + PRD (pass-rate 30–60%), o LLM passa quando `confidence_pct − implied_prob_pct < 5pp`
para **ambos** os lados (caso binário: `edge_under = −edge_over`). O floor mora no SYSTEM-base + `MIN_EDGE_PP`;
**não há recheck em `predict.ts`** (spec-mãe §4, ADR 0012-D8).

## Settlement (`lib/settlement/rules/over_under.ts`)

Regra pura `(selection, { line }, resultData) → outcome`, lendo **só** `resultData.totalGoals` (split
home/away pode faltar em histórico; a regra não pode exigi-lo):

- `totalGoals === line` → **`push`** (devolve stake). Em 2.5 nunca empata; entra em jogo em linhas
  inteiras (2.0/3.0) — **fora do escopo** (#175 só meias-linhas).
- senão: `won = selection === "over" ? totalGoals > line : totalGoals < line`.

`settlement_rule_key = "over_under"`; `ParamsSchema = z.object({ line: z.number().finite() }).strict()`.

## Versionamento

- **Versão atual:** `over_under_v2.0` (`OVER_UNDER_VERSION`, `index.ts`).
- Histórico:
  - `v1.0` → `v1.3`: rewire pro `SportsDataProvider` + regra de "lesões indisponíveis = reduzir confiança"
    (v1.1, ADR 0006); nudge de concisão pós-tolerância do Zod (v1.2, #45/#46); redação leiga do `rationale`
    (v1.3, #105) — nenhum campo/limite novo.
  - **`v2.0`** (#165): bump MAJOR pela **reestruturação em cartucho** (migração de `lib/ai/prompts/` +
    `lib/ai/schemas/` → `lib/ai/markets/over_under/`). Payload **byte-idêntico** ao v1.3 — sem mudança de
    distribuição; o MAJOR sinaliza a refatoração estrutural, não um prompt novo.
  - Detalhe por bump: `git log lib/ai/markets/over_under/` (convenção de commit `prompt:`).
- Gate de replay-eval e backtest ≥20: spec-mãe §8/§11. `scripts/replay-prompt-eval.ts` hoje importa
  `overUnderCartridge` deste mercado diretamente.

## Entrada (`buildPredictionInput` / `OverUnderInputSchema`)

Monta `Input` a partir de match (forma e H2H **até 5 jogos** cada — `FORM_LIMIT`/`H2H_LIMIT` em
`build-input.ts`; o Zod apenas teta em `.max(20)`, não é o limite do payload — standings com splits,
ausências, lineup opcional) + odds (`over_2_5_decimal`/`under_2_5_decimal` + bookmaker + timestamp) +
`implied` (`over_pct`/`under_pct`, **já normalizados** pelo overround — spec-mãe §3). `BuildInputError`
em dado essencial faltante (ex.: row de standings ausente) ou parse do `OverUnderInputSchema` falhando;
a ausência de snapshot de odds é barrada **antes**, no `predict.ts` (montagem do bundle).
