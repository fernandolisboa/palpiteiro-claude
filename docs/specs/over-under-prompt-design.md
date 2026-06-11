# Over/Under 2.5 — Prompt Design Spec

## Objetivo

Definir formalmente o contrato de entrada e saída do `lib/ai/predict.ts` para o único mercado do MVP (over/under 2.5 gols), **antes** da implementação do runtime. Esta spec acompanha o código em `lib/ai/schemas/input.ts`, `lib/ai/schemas/output.ts` e `lib/ai/prompts/over_under_v1.ts`.

Referências:

- ADR 0001 — Claude Sonnet 4.5 como único provider do MVP
- ADR 0003 — Over/under 2.5 como único mercado
- `docs/ARCHITECTURE.md` — campos da tabela `predictions`
- `CLAUDE.md` — prompts versionados em `lib/ai/prompts/` e validação Zod obrigatória do output

## Escopo desta issue (#2)

Apenas contrato. Sem chamadas ao SDK Anthropic, sem `predict.ts`, sem persistência. O runtime mora na issue #7. O bootstrap do projeto (Next.js, `package.json`, `tsconfig.json`, instalação de `zod`) mora na issue #3 — por isso este PR commita apenas arquivos-fonte; os schemas typecheckaram fora do repo durante o desenvolvimento, e voltarão a typecheckar como parte do build assim que #3 aterrissar.

## Fronteira: LLM vs `predict.ts`

O LLM produz somente decisões qualitativas/probabilísticas. Campos derivados são preenchidos por `predict.ts` antes de persistir em `predictions`.

| Campo                              | Origem                | Comentário                                                                  |
| ---------------------------------- | --------------------- | --------------------------------------------------------------------------- |
| `recommendation`                   | LLM                   | `over` / `under` / `pass`                                                   |
| `confidence_pct`                   | LLM                   | Probabilidade estimada do lado recomendado (ou de `over` quando `pass`)     |
| `rationale`                        | LLM                   | PT-BR, até 600 chars                                                        |
| `key_factors`                      | LLM                   | 2 a 5 bullets, até 160 chars cada                                           |
| `minimum_odd`                      | LLM                   | Odd decimal mínima com edge ≥ 5%; obrigatório quando `recommendation ≠ pass` |
| `edge_pct`                         | `predict.ts`          | `confidence_pct − implied_prob_pct` do lado recomendado                     |
| `implied_prob_pct`                 | input.implied         | Normalizado por overround upstream                                          |
| `odd_at_recommendation`, `bookmaker` | input.odds          | Snapshot da odd usada                                                       |
| `prompt_version`                   | constante             | `PROMPT_VERSION` (atual: `over_under_v1.3`)                                 |
| `model_version`                    | runtime               | Versão exata do Claude Sonnet usada                                         |
| `ai_call_id`                       | runtime               | FK para `ai_calls` (audit log)                                              |

## Schema de entrada (`lib/ai/schemas/input.ts`)

Origem dos campos por provider:

| Seção                       | Campos                                                | Provider esperado                             |
| --------------------------- | ----------------------------------------------------- | --------------------------------------------- |
| `match`                     | id, times, competição, kickoff, venue                 | API-Football (issue #5)                       |
| `home`/`away`.standing      | posição, pontos, GF/GA, splits home/away              | API-Football                                  |
| `home`/`away`.form          | últimas até 20 partidas                               | API-Football                                  |
| `home`/`away`.absences      | lesionados/suspensos/dúvidas                          | API-Football                                  |
| `home`/`away`.lineup (opt)  | escalação provável                                    | API-Football (pode faltar até próximo do jogo) |
| `h2h`                       | até 20 confrontos diretos                             | API-Football                                  |
| `odds`                      | over/under 2.5 decimal + bookmaker + timestamp        | The Odds API (issue #6)                       |
| `implied`                   | `over_pct` / `under_pct` normalizados por overround   | computado em `lib/providers/odds-api.ts`      |

> **Crítico**: implícita NUNCA é `1 / odd` direto. Sempre normalizar pelo overround do mercado completo (gotcha em `CLAUDE.md`). O LLM recebe a versão já normalizada e confia nela.

## Schema de saída (`lib/ai/schemas/output.ts`)

O JSON Schema da tool (`SUBMIT_PREDICTION_TOOL.input_schema`) declara os limites
`rationale` máx. 600 chars, `key_factors` 2–5 itens de até 160 chars cada — mas
isso é **guia para o LLM**, não validação: a API da Anthropic não impõe
`maxLength`/`minItems`/`maxItems`. A validação real é o `OverUnderOutputSchema`
(Zod), deliberadamente **tolerante** nos campos de prosa (#45): um output que
passa o shape mas estoura um limite de chars NUNCA deve descartar uma
recomendação válida.

O que o Zod de fato impõe:

- **`superRefine` impõe APENAS as regras de `minimum_odd`**: obrigatório quando
  `recommendation ∈ {"over","under"}`, omitido quando `recommendation === "pass"`.
- `confidence_pct` ∈ [0, 100] (validação simples de número).
- `rationale`: floor `.min(1)` (prosa vazia é degenerada) e **truncate** em 2000
  chars (teto de segurança; o `MAX_TOKENS` já limita o output) — não há cap em 600.
- `key_factors`: floor `.min(1)` item (NÃO 2), cada item truncado em 300 chars, e
  o array é cortado em no máx. 5 itens (`.slice(0, 5)`, descarta extras em vez de
  rejeitar).

`predict.ts` (issue #7) deve re-validar com `OverUnderOutputSchema.parse()` antes
de persistir.

## Política de "pass" e floor de edge

Por ADR 0003 e PRD (pass rate alvo 30–60%), o LLM deve passar a vez quando `confidence_pct − implied_prob_pct < 5` (em pontos percentuais) para ambos os lados. O floor de 5%:

1. Fica codificado no `SYSTEM_PROMPT` (sincronia com a constante `MIN_EDGE_PP` da UI pinada por teste em `lib/ai/__tests__/request-builder.test.ts`).
2. **Não é re-checado por `predict.ts`** — o runtime apenas computa `edge_pct` (`confidence_pct − implied_prob_pct`) e persiste o que o LLM mandou, incluindo `minimum_odd` (validado pelo Zod só como positivo). Uma versão anterior desta spec afirmava um recheck de defesa em profundidade que nunca existiu no código (drift registrado no ADR 0012, decisão 8); a UI trata contradições aritméticas (`minimum_odd > odd_at_recommendation`, retorno esperado ≤ 0) com aviso, sem invalidar a predição.

## Versionamento

- Versão inicial: `over_under_v1.0`; **versão atual: `over_under_v1.3`** (constante `PROMPT_VERSION`).
  - `v1.1` (commit `f4e7025`): rewire da entrada pro `SportsDataProvider` + nova regra tratando "Lesões / Suspensões: dados indisponíveis" como sinal pra reduzir confiança (não como ausência de lesões). Ver ADR 0006.
  - `v1.2` (commit `b40b21b`, #45/#46): ajuste de texto pós-tolerância do Zod — nudge de concisão do `rationale` (~450 chars) na description da tool.
  - `v1.3` (#105): regras de redação do `rationale` em linguagem acessível a leigo (conclusão na primeira frase, jargão só se explicado em meia frase, mesma sustentação quantitativa e mesmo tamanho alvo de ~450 chars). Nenhum campo novo, nenhum limite alterado — shape do JSON Schema da tool e do Zod intactos.
  - Detalhe completo de cada bump em `git log lib/ai/prompts/over_under_v1.ts` (convenção de commit `prompt:`).
- Bump obrigatório em qualquer mudança que possa alterar a distribuição de respostas (system prompt, ordem das seções, redação de regras, schema). Mudanças cosméticas (whitespace, typos) não exigem bump.
- Commits que alteram o prompt usam o tipo `prompt:` (convenção do `CLAUDE.md`).
- `predictions.prompt_version` registra qual versão foi usada — permite A/B retrospectivo de Yield por versão.
- Gate de mudanças de prompt sem eval harness: replay eval dev-only (`scripts/replay-prompt-eval.ts`) contra `inputPayload` armazenados em `ai_calls` — critério de abort: qualquer flip de `recommendation` ou mediana de |Δconfidence| > 5pp.

## Próximos passos

- **Issue #7** (`lib/ai/predict.ts`): orquestra providers, valida `OverUnderInput`, monta mensagens com `buildUserMessage`, chama Claude Sonnet 4.5 com tool use, valida `OverUnderOutput`, computa `edge_pct`, persiste em `predictions` + `ai_calls`.
- **Issue #8** (backtest manual): rodar este prompt em 20+ jogos passados; iterar para `over_under_v1.x` estável antes de uso real.
- **Issue #4** (schema do DB): este contrato define as colunas mínimas de `predictions`.
