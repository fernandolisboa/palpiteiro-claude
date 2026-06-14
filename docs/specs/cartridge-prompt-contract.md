# Spec-mãe — Contrato de cartucho de prompt (multi-mercado)

Contrato **genérico** de entrada/saída de um cartucho de mercado e da sua fronteira com
`lib/ai/predict.ts`. É a referência transversal: cada mercado tem a sua spec instanciando este
contrato (over/under, 1X2, BTTS, dupla chance — ver [`README.md`](./README.md)). O que é específico
de mercado mora na spec do mercado; o que é invariável entre mercados mora **aqui**.

Referências: ADR [0015](../decisions/0015-modelo-dominio-multi-mercado.md) (domínio),
[0016](../decisions/0016-settlement-por-mercado.md) (settlement),
[0017](../decisions/0017-cartuchos-de-prompt-por-mercado.md) (cartuchos + versionamento),
[0018](../decisions/0018-edge-ev-cenarios-multi-mercado.md) (edge/EV/cenários N-vias),
[0019](../decisions/0019-staking-por-confianca.md) (staking),
[0012-cenários](../decisions/0012-cenarios-informativos-retorno-esperado.md) (retorno esperado / `minimum_odd`).
Código: `lib/ai/markets/*` (cartuchos), `lib/ai/predict.ts` (runtime), `lib/odds/*` (descriptor, edge, bookmaker),
`lib/settlement/*` (regras). Convenções: `CLAUDE.md`.

## 1. O cartucho (ADR 0017)

Um mercado é ativado registrando um **cartucho** — não ramificando o runtime. `predict()` resolve o
cartucho por `marketKey` (`getCartridge`, `lib/ai/markets/registry.ts`) e **não tem `if (market === X)`**
(ADR 0015-D7): a variação por mercado mora em quatro registries keyed — cartucho de prompt
(`lib/ai/markets/registry.ts`), descriptor de odds (`lib/odds/market-descriptor.ts`), regra de settlement
(`lib/settlement/registry.ts`) e apresentação de view (`getMarketPresentation`, `lib/view/markets/presentation.ts`).

Forma do cartucho (`MarketCartridge<Input, Output, Args>`, `lib/ai/markets/types.ts`):

| Campo | Papel |
| --- | --- |
| `marketKey` | chave de dispatch no registry (ex.: `over_under`, `match_result`) — **não** o enum legado `over_under_2_5` |
| `version` | semver-like **por cartucho** (`<marketKey>_v<major>.<minor>`) — ver §8 |
| `systemPrompt` | SYSTEM-base transversal + camada do mercado |
| `tool` / `toolName` | tool-use da Anthropic + nome pra `tool_choice`/extração |
| `inputSchema` / `outputSchema` | `ZodType` de entrada e de **saída do LLM** (validação obrigatória — §6) |
| `buildPredictionInput` / `BuildInputError` | monta o `Input` tipado a partir dos dados de match+odds; lança `BuildInputError` em dado faltante |
| `buildUserMessage` | renderiza o `Input` na mensagem do usuário |
| `selections` | conjunto canônico de seleções (espelha `descriptor.selectionKeys`; a **ordem** é o contrato chave→índice do edge) |
| `descriptor` | `MarketDescriptor` (vocabulários de odds — §9) |

**SYSTEM-base + camada (ADR 0017-D2):** a base concentra o transversal — floor de edge ≥ 5pp sobre a
implícita **normalizada**, pass-first (taxa-alvo 30–60%), anti-alucinação, redação leiga
([ADR 0012-D2](../decisions/0012-cenarios-informativos-retorno-esperado.md)). A camada por mercado traz
seleções, forma da linha (quando houver) e enquadramento. `MIN_EDGE_PP` é **pinado por teste** ao texto base.

## 2. Fronteira: LLM vs `predict.ts`

O LLM produz **só** decisões qualitativas/probabilísticas. Os campos derivados e de auditoria são
preenchidos por `predict.ts` antes de persistir em `predictions` — esta separação é genérica; os
**valores** das seleções e a convenção de `confidence_pct` são específicos de mercado.

| Campo | Origem | Comentário |
| --- | --- | --- |
| `recommendation` | LLM | uma das `selections` do cartucho **ou** `pass` |
| `confidence_pct` | LLM | probabilidade estimada do lado recomendado (convenção do mercado quando `pass` — ver spec do mercado) |
| `rationale` | LLM | PT-BR, leigo-primeiro (ADR 0012-D2) |
| `key_factors` | LLM | bullets curtos |
| `minimum_odd` | LLM | odd decimal mínima que mantém edge ≥ 5pp; obrigatório quando `recommendation ≠ pass` |
| `edge_pct` | `predict.ts` | `confidence_pct − implied_prob_pct` do lado recomendado (§3) |
| `implied_prob_pct` | `predict.ts` | implícita **normalizada pelo overround do mercado completo** (§3) |
| `odd_at_recommendation`, `bookmaker` | input.odds | snapshot da odd da seleção recomendada |
| `stake_units` | `predict.ts` | derivado em código de edge + confiança (ADR 0019 — §7) |
| `market_id`, `selection_id`, `market_params` | catálogo | `selection_id` nullable em `pass`; `market_params` = `{ line }` ou `null` |
| `prompt_version` | cartucho | `cartridge.version` (§8) |
| `model_version`, `ai_call_id` | runtime | versão do modelo + FK pro audit log `ai_calls` |

`predict.ts` é a **única porta** pro LLM (loga toda chamada em `ai_calls`); nenhum outro módulo chama o
SDK Anthropic direto (`CLAUDE.md`).

## 3. Edge N-vias normalizado (ADR 0018)

A probabilidade implícita **nunca** é `1/odd` cru — bookmakers embutem overround. Normaliza-se pelo
mercado **completo**: `implied_i = raw_i / (Σ_j raw_j)` sobre **todas as N seleções**, `raw_i = 1/odd_i`
(`computeMarketImpliedProbabilities(odds: number[])`, `lib/odds/implied-probability.ts`; paridade
bit-a-bit com o caso binário N=2).

- **Edge por seleção:** `edge_i = modelProb_i − implied_i` (pontos percentuais). A recomendação só sai
  quando **alguma** seleção tem `edge_i ≥ MIN_EDGE_PP` (5pp; `lib/odds/scenario.ts`, exportado e pinado
  por teste).
- **Cai em N≥3** (ADR 0018-D5): `P(oposto) = 100 − P(lado)` e `edge_oposto = −edge` valem **só** em N=2.
  O "lado alternativo" vira a **lista das outras seleções**, cada uma com seu `modelProb_i`/`implied_i`/`edge_i`/`o_i`/`EV_i`.
- **EV/break-even na odd CRUA** (ADR 0012-D6 / 0018-D3, sobrevive): `EV_i = (modelProb_i/100)·o_i − 1`;
  `breakEvenProb_i = 100/o_i`. Dois conceitos de probabilidade distintos — a **normalizada** rege edge; a
  **crua** rege break-even/EV (é o payout bruto que paga o apostador). Não "corrigir" um pro outro.

## 4. Pass como cidadão de 1ª classe + floor de edge

`pass` é um resultado **válido e esperado** (taxa-alvo 30–60%, PRD/ADR 0003). O floor de 5pp:

1. Mora no **SYSTEM-base** (sincronizado com a constante `MIN_EDGE_PP`, pinada por teste).
2. **Não é re-checado por `predict.ts`** ([ADR 0012-D8](../decisions/0012-cenarios-informativos-retorno-esperado.md)):
   o runtime computa `edge_pct` e persiste o que o LLM mandou. O Zod valida `minimum_odd` como **positivo e
   presente sse `recommendation ≠ pass`** (via `superRefine`), mas **não existe** recheck de 5pp nem
   validação `minimum_odd ≤ odd_at_recommendation` no código — uma versão da spec do over/under
   (`docs/specs/over-under-prompt-design.md`, linha 70) afirmou esse recheck de defesa-em-profundidade que
   nunca existiu (drift registrado no ADR 0012-cenários, decisão 8). A **UI** trata contradições aritméticas
   (`minimum_odd > odd_at_recommendation`, retorno esperado ≤ 0) com aviso de tom neutro, **sem** invalidar
   a predição.

## 5. Staking por confiança (ADR 0019)

Stake é **determinístico em código**, não emitido pelo LLM: derivado de `edge_pct` (eixo primário) com
**piso de confiança**. Bandas v1 (globais): **1u** (toda recomendação edge ≥ 5pp), **2u** (edge ≥ 8 **e**
confiança ≥ 50), **3u** (edge ≥ 12 **e** confiança ≥ 55); cascateia até a primeira banda que passa nos
**dois** pisos, teto 3u, nunca sobe sem piso de confiança. `pass` não tem aposta. Congelado em `predict()`,
imutável.

## 6. Tolerância: tool schema (guia) vs Zod (validação)

O JSON Schema da tool (`maxLength`/`minItems`/`maxItems`) é **guia pro LLM** — a API da Anthropic **não
impõe** esses limites. A validação real é o `outputSchema` (Zod) do cartucho, deliberadamente **tolerante**
nos campos de prosa: um output que passa o *shape* mas estoura um limite de chars é **truncado**, nunca
descartado — jamais perder uma recomendação válida por excesso de texto. O que o Zod impõe de fato é
específico do mercado (ver a spec do mercado), mas o **padrão** é universal: shape rígido + prosa tolerante.
`predict.ts` re-valida com `outputSchema.safeParse()` antes de persistir; **nenhum** output de LLM é usado
sem passar por Zod (`CLAUDE.md`, inviolável).

## 7. Settlement (ADR 0016)

A liquidação é uma **função pura** por mercado: `(selection, marketParams, resultData) → outcome`, num
registry keyed por `markets.settlement_rule_key` (`lib/settlement/registry.ts`). `outcome` ∈
`won | lost | push | half_win | half_loss` (persistido como `won | lost | void | push`; `void` é o
short-circuit de `pass`). O dinheiro fica num único ponto parametrizado por odd/stake
(`profitForOutcome`). `result_data` é padronizado e coletado **uma vez** por jogo:
`{ home_score, away_score }` (placar 90', sem prorrogação/pênaltis) → `totalGoals` derivado. Todos os
mercados do MVP liquidam só com isso (sem provider novo). Win rate = `won/(won+lost)`; Yield =
`Σ profit / Σ stake` sobre `won`+`lost` — **`push` e `void` ficam fora** de numerador e denominador.

## 8. Versionamento + gate de replay-eval (ADR 0017-D3/D6) — **PAGO**

- Versão **por cartucho**, semver-like (`over_under_v2.0`, `match_result_v1`, ...), persistida em
  `predictions.promptVersion` **e** `ai_calls.promptVersion` — habilita A/B retrospectivo de Yield por
  versão. Bump obrigatório em qualquer mudança que altere a distribuição de respostas (system prompt,
  ordem de seções, redação de regras, schema); cosmético (whitespace/typo) não. Commits de prompt usam o
  tipo **`prompt:`** (`CLAUDE.md`).
- **Gate de replay-eval** (`scripts/replay-prompt-eval.ts`): replaya `inputPayload` armazenados em
  `ai_calls` contra o `systemPrompt`/`tool`/`outputSchema` da versão corrente. **Critério de reprovação:**
  qualquer flip de `recommendation` **ou** mediana de `|Δconfidence| > 5pp`. Roda por `(mercado, versão)`
  — bump de um cartucho dispara o gate só daquele mercado (ADR 0017-D6).
  - ⚠️ **Custa dinheiro** (chama o LLM real). Orçar por mercado/versão; mencionar o custo no PR (gotcha de
    tokens do `CLAUDE.md`). Nenhum teste de unidade chama o LLM — o replay-eval é o passo deliberado e pago,
    à parte (dev-only; exige `ANTHROPIC_API_KEY`/`DATABASE_URL`).
  - O gate precisa de uma **versão anterior** do mesmo cartucho como baseline. A **primeira** versão de um
    mercado novo não tem baseline → usa o **backtest ≥20 jogos** (§9), não este gate.
  - Hoje o script está **vinculado ao cartucho over_under** (importa `overUnderCartridge` literalmente).
    Generalizá-lo por cartucho (dispatch por `marketKey`) é trabalho do 1º mercado novo (#173) — esta spec
    descreve o alvo; o shape binário (`pOver()`, `minimum_odd` único) ainda assume over/under.

## 9. Disciplina de três vocabulários + expand-migrate-contract (ADR 0015)

Três vocabulários ficam **separados** (`lib/odds/market-descriptor.ts`): `providerMarketKey` (chave do
provider: `totals`/`h2h`/`btts`/`double_chance`) ≠ `dbMarketKey` (`markets.key`: `over_under`/`match_result`/…)
≠ `dbSelectionKey` (`market_selections.key`: `over`/`under`, `home`/`draw`/`away`, …). **Não confundir** com o
enum legado binário `over_under_2_5` (carrega a linha no sufixo) — esse some no contract (Fase 5). A **linha**
mora **sempre** em `market_params.line`, nunca como sufixo de chave. O modelo é **reference tables** (`markets` + `market_selections`), não enums; `predictions`
referencia `market_id`/`selection_id`/`market_params` (ADR 0015-D1/D4).

O legado binário (enum `market`/`recommendation`, colunas `over/under_odd_at_prediction`, tabela
`match_odds_snapshots`) é removido só no **contract** (Fase 5, #179) — até lá convive via
**expand-migrate-contract**: colunas novas nullable, backfill determinístico sem LLM, e o dual-write do
legado fica restrito ao over_under por um guard de identidade com o descriptor over_under (não um
`if (market === X)`).

## 10. Anti-alucinação + confiabilidade de dados

Forma recente curta, escalação não publicada, H2H muito antigo ou ausência de dados de lesão (que é
**sinal de incerteza**, não de "sem lesões") são motivos pra **reduzir confiança** e provavelmente `pass`.
O cartucho recebe a implícita já normalizada e confia nela; não reconstrói probabilidade a partir de odd crua.

## 11. Antes de usar um mercado de verdade: backtest ≥20 jogos

Todo cartucho novo roda em **≥20 jogos passados** com resultado conhecido, comparado a um **baseline
trivial** do mercado (ex.: "sempre favorito pela odd", "sempre empate", "sempre over"), **antes** de ativar
a flag — o LLM tem que justificar a existência contra o baseline (calibração: confiança vs frequência real).
A graduação (display) vem depois: **≥30 apostas resolvidas naquele mercado E Yield positivo naquele
mercado** (ADR 0015-D6 / régua D9), pra não deixar um mercado imaturo poluir o sinal de um maduro.
