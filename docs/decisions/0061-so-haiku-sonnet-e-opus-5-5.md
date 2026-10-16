# ADR 0061 — Só Haiku, Sonnet e Opus 5.5, todos adaptive

## Status

Accepted (2026-10-16). Issue #607 (pedido do dono, 2026-10-16). **Emenda** o ADR 0021 (estratégia de reprodutibilidade: não há mais modelo `temperature`), o ADR 0013 (sem modelo admin-only no registry; o mecanismo fica) e o ADR 0008 emenda 2 (o parâmetro de geração `temperature` sai do /admin/settings). Follow-up: adoção automática de versões novas por família (decisão do dono no mesmo dia, issue própria).

## Contexto

O registry tinha cinco modelos: Fable 5.1 (admin-only), Opus 5.5, Sonnet 5, Sonnet 4.5 e Haiku 4.5. Os dois últimos rodavam no caminho `temperature` (tool forçado, temperatura 0.3, sem thinking) e eram também o modelo fixo das tarefas internas baratas (manchete, parse de aposta, extração do "Seu palpite", notícias e cartões). O dono pediu para ficar só com Haiku, Sonnet e Opus, todos na 5.5, porque as versões antigas vão sair.

Os três modelos 5.5 são adaptive e rejeitam (400) o que o caminho `temperature` mandava: `temperature` fora do default, `top_p`/`top_k`, `budget_tokens` e prefill. Opus 5.5 e Sonnet 5.5 também rejeitam `tool_choice` forçado. O Haiku 5.5 tem thinking ligado por padrão (effort default `medium`), duas tarifas (US$ 0,10/0,50 por MTok até 100K tokens de prompt, US$ 0,50/2,50 acima) e não tem fallback server-side para recusa.

## Decisão

1. **Registry = `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`**, nessa ordem, todos `userSelectable`. Fable 5.1 sai junto (o pedido lista só as três famílias). `DEFAULT_MODEL_ID` = Sonnet 5.5.
2. **Um corpo de request só**: `thinking: {type: "adaptive"}`, `tool_choice: {type: "auto"}`, `output_config.effort` quando há effort, nada de sampling. A ausência do tool_use segue virando `tool_missing`. O campo `thinkingMode` some do `AIModel`.
3. **O orçamento de tempo do run passa a olhar o ritmo do modelo** (`AIModel.speed`): `fast` (Haiku) mantém o piso de 20 s que o caminho `temperature` tinha, para a manchete e as notícias continuarem cabendo na reserva da síntese; `deliberate` (Opus, Sonnet) mantém o piso de 120 s ou metade do timeout estimado.
4. **Tarefas internas no Haiku 5.5 com effort explícito**: `low` nas que só preenchem um tool (manchete, parse, extração), `medium` nas que buscam na web (notícias, cartões), porque em `low` o modelo às vezes não busca. `max_tokens` dessas chamadas subiu para 4096 onde era menor: o thinking conta dentro.
5. **Ids antigos gravados são lidos como o 5.5 da mesma família** (`resolveModelId`): o default global em `ai_config`, a preferência do usuário e um override vindo de uma aba aberta antes do deploy. Fable e Mythos viram Opus. Nenhuma row é reescrita. O histórico (`predictions.modelVersion`, `ai_calls.model`) continua com o id que rodou de fato.
6. **`temperature` sai do /admin/settings** e de `GenerationParams`. A coluna `ai_config.temperature` fica no banco sem uso (sem migration).
7. **Custo**: `calculateCost` aplica a tarifa de prompt longo do Haiku 5.5 quando o input passa de 100K tokens.
8. **Aviso de versão nova** no /admin/settings: numa família do registry só avisa id mais novo que o cadastrado; Fable e Mythos nunca avisam.

## Consequências

- **Não há mais caminho reproduzível por temperatura.** No motor `code_jev` a decisão é código e o LLM só narra, então nada muda ali. No motor `llm` toda análise passa a variar entre rodadas, como já acontecia com Opus 5.5 e Sonnet 5 (emenda de #524 ao ADR 0021). O Yield continua segmentável por `predictions.modelVersion`.
- As tarefas internas ganham thinking (curto, em `low`) e podem demorar um pouco mais que o Haiku 4.5. O Haiku 5.5 conta ~30% mais tokens para o mesmo texto, mas custa 10x menos por token.
- Uma recusa do Haiku 5.5 (`stop_reason: "refusal"`) segue o tratamento existente (falha tipada, `provider_error`); nunca mandamos `fallbacks` para ele.
- **Quem estava no Sonnet 4.5 passa a um modelo `deliberate`.** O Sonnet 5.5 pensa antes da tool call (45–90s por mercado, piso de 120s no prazo do run), enquanto o Sonnet 4.5 respondia em segundos. Com o fan-out paralelo (`enable_parallel_fan_out`, ligado por padrão) isso só alonga o run; com ele desligado, o melhor palpite em série cabe 2–3 mercados no prazo e os demais saem como "Tempo esgotado". Quem quer rapidez escolhe o Haiku 5.5.
- O Haiku 5.5 escolhido para a análise em effort `high` ou acima também pensa: o mínimo para iniciar a chamada sobe de 20s para um quarto do timeout estimado (`lib/ai/deadline.ts`). A manchete ganha piso de 8192 em max_tokens, porque o thinking conta dentro dele.
