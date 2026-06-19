# ADR 0027 — Multi-provider de IA: seam `AIProvider` + UM provider de prova (OpenAI) admin-only/inerte

## Status

Accepted (2026-06-17) — **emenda o ADR 0008** (framing "mesmo provider Anthropic ⇒ não exige
ADR de provider" e a postura "dois modelos Anthropic") e **emenda o ADR 0021** (cujo argumento
de reprodutibilidade é fundado na física de _sampling_ puramente-Anthropic, e cujo enum binário
`thinkingMode: "adaptive" | "temperature"` é específico do _request shape_ Anthropic).
**Preserva integralmente o ADR 0013** (gate de audiência `userSelectable` + cascade de 4 níveis)
e o default reproduzível Sonnet 4.5 que o **#203** landou. Cita o ADR 0026/#227 (padrão
`hasKey()` inerte do SportMonks) como template do provider key-gated.

> **Numeração:** confirmada como **0027**. A "nota de numeração" da issue #229 (que sugeria 0024)
> está **STALE** — 0024/0025/0026 já estão ocupados; o próprio ADR 0026 já anuncia que "o ADR
> multi-provider de IA (#229) será o **0027**". Mesmo padrão do #225 (sugeria 0023, virou 0026).

> **Nota de inércia (decisiva):** `OPENAI_API_KEY` está **ausente** neste ambiente. Logo o
> provider de prova entra **admin-only E inerte** (filtrado da seleção, nunca roteado, zero
> gasto). O _wire shape_ do OpenAI é codificado a partir dos docs e **não-verificado ao vivo** —
> mesma postura do SportMonks (#227/ADR 0026): schema inferido, validar quando houver chave.

> **Nota (2026-06-19, #374):** O **MODELO de prova OpenAI (`gpt-5-mini`) saiu do
> `MODEL_REGISTRY`** (e da `AIModelId`), mas o **seam `AIProvider` permanece INTACTO**:
> `AIProviderKey = "anthropic" | "openai"`, o map `PROVIDERS` (total `Record`), o
> `openaiProvider` (adapter), `isAIProvider` e `providerHasKey` seguem **inalterados** no
> código. O provider OpenAI fica **referenciado-só-pelo-seam (inerte)**: um provider futuro
> reentra na seleção via uma **entrada de registry** (+ adapter já existente), **sem
> ressuscitar código**. A cobertura de backstop de `predict.ts` (override admin → provider
> sem chave → `provider_error` auditado) foi **conscientemente perdida** neste passo (o id de
> prova não pode mais ser passado como `modelOverride`, que é `AIModelId`-typed); o código
> backstop segue vivo. Follow-up pos-pivot: reintroduzir essa cobertura quando um provider
> OpenAI voltar ao registry.

## Contexto

`lib/ai/predict.ts` é a **única porta** da LLM (todo o logging em `ai_calls` passa por ela), mas
hoje ela **importa `@anthropic-ai/sdk` direto** (`predict.ts:1`) e o SDK vaza no caminho de
request vivo:

- `getAnthropicClient()` (`anthropic.ts`, usado em `predict.ts:789`);
- `buildAnthropicRequest()` (`request-builder.ts`, usado em `predict.ts:776`) — carrega as **3
  armadilhas-400** Anthropic: `thinking:{type:"adaptive"}` sem `temperature` / `tool_choice`
  forçado vs `auto` / `output_config.effort`;
- `classifyAnthropicError` / `serializeAnthropicError` (`predict.ts:162-202`), via
  `instanceof Anthropic.APIError | RateLimitError | APIConnectionTimeoutError`;
- a chamada `client.messages.create()` (`predict.ts:793`, retorno `Anthropic.Message`);
- as leituras de uso `response.usage.input_tokens / output_tokens` (`predict.ts:815-816`);
- a extração do bloco `tool_use` (`predict.ts:820-823`, `block.type === "tool_use" && block.name === cartridge.toolName`).

Esse é o **único ponto** onde a fronteira do CLAUDE.md ("nenhum SDK de IA fora do adapter") é
tecnicamente quebrada. **Todo o resto** de predict já é provider-agnóstico: a cascade de modelo
(`predict.ts:285-292`), o dispatch por cartucho (`getCartridge`, `predict.ts:268`), edge (ADR 0018)
e staking (ADR 0019), a validação **Zod por-cartucho** (`cartridge.outputSchema.safeParse(toolUse.input)`,
`predict.ts:846`) e toda a persistência. **Não existe** `OverUnderOutputSchema` global gating predict
— esse texto da issue está STALE; o contrato de saída é **por-cartucho** (`cartridge.outputSchema`).

`ai_calls.provider` é um `pgEnum("ai_provider", ["anthropic"])` (`schema.ts:50`, coluna em `:233`)
— o **único holdout** em enum numa tabela cujas colunas-irmãs (`model`, `promptVersion`) já são
`text` validado-na-app. O literal `provider: "anthropic"` é escrito em **exatamente dois** lugares:
`predict.ts:229` (caminho de erro, dentro de `persistAiCallError`) e `predict.ts:922` (caminho de
sucesso). _(As issues citam 190/529 — STALE.)_

**Motivação honesta.** Pra um app **solo de uso pessoal**, o valor de produto de um 2º provider é
**baixo-a-médio**: o app já tem 5 modelos Anthropic selecionáveis (custo/capacidade cobertos). O
ganho real é (a) **A/B de qualidade** de seleção de edge entre vendors e (b) **aprendizado de IA**
— objetivo declarado do projeto. Além disso, **multi-provider trabalha CONTRA a reprodutibilidade**
do ADR 0021: os modelos baratos de raciocínio da OpenAI **não são** _temperature-mode-estáveis_ do
jeito que o Sonnet 4.5 é (temperature 0.3 + tool forçado; #105 Δconf 0.0pp). Este ADR pesa isso com
franqueza e recomenda a **fatia mínima** com **critério de saída A/B** — incluindo a possibilidade
legítima de **parar na PoC**.

## Decisão

**GO-minimal**, em duas fatias, com saída A/B explícita:

1. **#230 — extrair o seam `AIProvider` (Anthropic-only, ZERO-behavior-change).** Pura refatoração
   mecânica que fecha a violação de fronteira. `predict.ts` deixa de importar `@anthropic-ai/sdk`
   (nem `import type`) e passa a falar com um adapter resolvido por `getProviderForModel(model)`.
   A validação Zod e o logging em `ai_calls` **ficam onde estão** (em predict); o adapter devolve o
   `toolInput` **cru** (`unknown`). **GO incondicional** — o seam vale por si só, independente de
   qualquer 2º provider algum dia existir.

2. **#231 — plugar UM provider de prova (OpenAI), admin-only + key-gated inerte.** Adapter em
   `lib/ai/providers/openai/` implementando `AIProvider`; migration `ai_calls.provider` `pgEnum→text`;
   **des-hardcode dos DOIS literais** (`predict.ts:229` e `:922` → `model.provider`); entrada(s) no
   **`MODEL_REGISTRY` único** (campo `provider`, `userSelectable:false`, `thinkingMode:"temperature"`,
   **pricing verificado**). **GO-minimal-e-inerte.**

**NO-GO** explícito sobre: mover `DEFAULT_MODEL_ID` de Sonnet 4.5; tocar a row `ai_config` id=1;
empurrar qualquer `if (provider === X)` pra dentro de predict (tão proibido quanto `if (market === X)`);
portar o replay-gate pro seam; qualquer teste que construa client real ou chame API paga; construir
Gemini/Grok (documentados como futuro, **não** construídos); ou superfície especulativa (streaming,
endpoint de token-count, knobs de retry/cache, UI de roteamento de provider, multi-turn).

### A interface `AIProvider` (contrato do seam, definido em `lib/ai/providers/types.ts`)

```ts
// ZERO @anthropic-ai/sdk (nem `import type`). O ToolDef neutro substitui Anthropic.Tool na fronteira.

export type AiCallStatus =                      // os 6 reais (predict.ts:99 == schema.ts aiCallStatusEnum :52)
  | "ok" | "invalid_output" | "provider_error"
  | "timeout" | "tool_missing" | "rate_limited";

export type ToolDef = {                          // neutro; cada adapter down-mapeia (Anthropic input_schema / OpenAI function.parameters)
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;          // JSON Schema
};

export type AnalysisRequest = {                  // tudo já provider-neutro em predict hoje
  model: AIModel;                                 // registry entry: id + provider + thinkingMode + pricing
  system: string;                                 // cartridge.systemPrompt
  userMessage: string;                            // cartridge.buildUserMessage(...)
  tool: ToolDef;                                   // cartridge tool, neutro
  toolName: string;                                // cartridge.toolName
  maxTokens: number;
  effort?: Effort;                                 // aplicado só por adapters cujo modelo usa
  temperature?: number;                            // idem; o MAPEAMENTO p/ campos do request é per-adapter
};

export type Usage = { inputTokens: number; outputTokens: number };  // adapter DEVE coagir a int finito ≥0 (anti-NaN)

export type AnalysisOk = {                       // toolInput cru (Zod roda em predict, :846); undefined ⇒ tool_missing
  ok: true; toolInput: unknown; usage: Usage;
  inputPayload: Record<string, unknown>; outputPayload: Record<string, unknown>; stopReason: string | null;
};

export type AnalysisErr = {                      // adapter classifica o PRÓPRIO erro de SDK
  ok: false;
  status: Exclude<AiCallStatus, "ok" | "invalid_output" | "tool_missing">;  // só provider_error|timeout|rate_limited
  message: string; usage: Usage;
  inputPayload: Record<string, unknown>; outputPayload: Record<string, unknown>; stopReason: string | null;
};

export type AnalysisResult = AnalysisOk | AnalysisErr;

export type AIProvider = {
  readonly providerKey: string;                  // "anthropic" | "openai" — escrito verbatim em ai_calls.provider
  hasKey(): boolean;                              // padrão SportMonks/#227: false ⇒ filtrado/inerte, nunca roteado
  runAnalysis(request: AnalysisRequest): Promise<AnalysisResult>;  // a ÚNICA porta paga do provider
};

export function getProviderForModel(model: AIModel): AIProvider;   // resolve via model.provider; alcançado só APÓS audience + hasKey()
```

**Posse dos erros (a união `AiCallStatus` continua FECHADA — nenhum status novo):**
o adapter classifica **só** `provider_error | timeout | rate_limited` (o `instanceof`-nas-classes-de-SDK
+ extração de header é exatamente a parte que migra pra trás do seam). `tool_missing` (sem bloco
`tool_use`/`tool_calls` casando com `toolName` ⇒ `toolInput === undefined`), `invalid_output` (Zod
falha) e `ok` (insert de sucesso) **continuam donos de predict** — o `Exclude<>` torna **erro de tipo**
um adapter emitir esses três. `persistAiCallError` ganha um parâmetro `provider: string` _threaded_
dos 3 call-sites (`predict.ts:797/826/848`), passando `model.provider` — esse é o edit mecânico real
por trás de des-hardcodar o `:229`.

### `provider`: `pgEnum → text` validado-na-app (não `ALTER TYPE ADD VALUE`)

Migrar `ai_calls.provider` de `pgEnum` para `text NOT NULL DEFAULT 'anthropic'`, validado na app
contra um allowlist (`isAIProvider`, espelhando `isAIModelId`) no boundary de escrita. **Esta é a
convenção própria do repo**, não ideia nova: o ADR 0008 (decisão 1) fez `ai_config.defaultModelId`,
`ai_calls.model` e `predictions.modelVersion` serem `text` (não enum) **explicitamente** pra "validar
contra o registry na query layer e evitar migration toda vez que o registry muda"; `schema.ts:62-66`
repete o racional. `provider` é o **único holdout** em `pgEnum`, do lado de `model`/`promptVersion`
(já text) na mesma tabela. `ALTER TYPE ADD VALUE 'openai'` é um one-liner válido mas **irreversível**
(valor nunca pode ser `DROP`ado), **não roda em txn** em PG antigo, e força uma **2ª migration** quando
o provider #3 (Gemini/Grok) chegar. **Rejeitado o stopgap `ALTER TYPE`.**

### Provider de prova: OpenAI (`gpt-5-mini` class — id exato verificado no #231)

Escolhido por **máxima distância mecânica** do incumbente (o ponto de uma prova falsificável):
o `tool_use.input` da Anthropic é um **objeto já-parseado** alimentado direto no Zod (`predict.ts:846`,
sem `JSON.parse`), enquanto o `tool_calls[].function.arguments` da OpenAI chega como **STRING JSON**
que o adapter **precisa `JSON.parse`** antes de devolver `toolInput` — isso força o adapter a possuir
uma normalização real e prova que o seam **não** é acidentalmente Anthropic-shaped. SDK grande/estável
com hierarquia de erro que espelha a Anthropic 1:1 (menor risco), e o xAI Grok é OpenAI-API-compatível
(esse adapter é ~80% de um futuro Grok de graça). Gemini é o **forte segundo** (documentado como futuro),
rejeitado como prova por arestas no `usageMetadata` que sujariam a auditoria de custo do ADR 0021.

## Razão

- **O seam é o ganho durável e independente da contagem de providers** — fecha a violação de
  fronteira do CLAUDE.md e espelha o padrão data-driven de cartucho/descriptor já provado. Vale
  mesmo que nenhum 2º provider jamais grade.
- **OpenAI maximiza a falsificabilidade** (uma abstração de 1-provider é não-falsificável): a
  normalização args-como-STRING-JSON → `JSON.parse` → `unknown` → Zod é o entregável de aprendizado.
- **`text` + allowlist** é a convenção do próprio repo (ADR 0008 D1; `schema.ts:62-66`).
- **Admin-only + key-gate inerte** re-arma o gate do ADR 0013 (hoje **dormente** — nenhum modelo é
  admin-only, então o gate filtra nada) e preserva o ADR 0021 **por construção**, sem mover o default.
- **Registry único** (campo `provider` em `MODEL_REGISTRY`, `AIModelId` continua união **fechada**)
  evita o trap de NaN-cost: `calculateCost` indexa o registry, e `costUsd` é `numeric(10,6) NOT NULL`
  — um modelo fora do registry/sem pricing faria o insert falhar **depois** de gastar.

## Como cada ADR é emendado/preservado

- **ADR 0008 — EMENDA** o framing "mesmo provider Anthropic ⇒ sem ADR de provider"; **PRESERVA**
  toda decisão operacional: default global na row `ai_config` (PK=1) editável sem redeploy; override
  admin-only por análise; `MODEL_REGISTRY` como **única** fonte de ids/pricing/`thinkingMode`
  (**estendido** com `provider`, nunca substituído por registry paralelo); request **model-aware**
  (agora **per-adapter** — `buildAnthropicRequest` migra verbatim pro adapter Anthropic; o adapter
  OpenAI possui o **próprio** ramo model-aware, porque modelos de raciocínio gpt-5/o-series **rejeitam
  `temperature`** como o Opus, nunca passthrough cego); predict como porta única gravando o modelo
  **real** em `ai_calls.model` (a porta agora é o seam, não o arquivo).
- **ADR 0013 — PRESERVA integralmente** e **re-arma o gate dormente**: o mecanismo continua o flag
  `userSelectable` + `modelsForAudience(isAdmin)` (`models.ts:97`) + `isModelAllowedForAudience`
  (`models.ts:105`), defesa-em-profundidade (UI esconde; server action revalida; `predict.ts:289-290`
  é a autoridade final). A invariante "o default precisa ser `userSelectable`" é honrada (Sonnet 4.5
  fica `userSelectable:true`). **EMENDA** só a NOTA de que "nenhum modelo é admin-only hoje": o modelo
  OpenAI entra `userSelectable:false`, reintroduzindo um admin-only e fazendo o gate de fato filtrar.
- **ADR 0021 — EMENDA o argumento, PRESERVA o mandato** em 5 travas: (1) `DEFAULT_MODEL_ID` fica
  `claude-sonnet-4-5-20250929` (`models.ts:86`) e a row `ai_config` id=1 (migration 0032) intocada;
  (2) OpenAI entra `userSelectable:false` ⇒ só override admin deliberado o alcança; (3) `hasKey()`
  inerte por cima (chave ausente ⇒ nunca roteado); (4) o **replay-gate fica Anthropic-scoped e FORA
  do seam** — `classifyThinkingMode` (`replay-eval-core.ts:30-34`) e o loop pago em
  `replay-prompt-eval.ts` intocados, guard de CI-abort mantido; (5) `ai_calls.provider/model` gravam
  o real em todo caminho. **EMENDA**: o enum binário `thinkingMode "adaptive"|"temperature"` é
  Anthropic-request-shape-específico — um modelo de raciocínio OpenAI **não é** nenhum dos dois, então
  o ADR define que **novos modelos não-Anthropic classificam como `thinkingMode:"temperature"`
  (replay ESTRITO) POR PADRÃO** — nunca `"adaptive"` por conveniência (a tolerância adaptive de
  maioria-de-3 é específica do ruído de sampling Anthropic). Promover um modelo não-Anthropic **pra
  fora** de admin-only exige ADR futuro provando equivalência de reprodutibilidade (à barra do #105)
  **e** `userSelectable` — gated pela saída A/B.

## Critério de saída A/B (explícito)

O A/B é **dev-only, julgado-pelo-dono, offline** — **nunca** em teste/CI (regra dura: nenhum teste
chama API paga), só rodado pelo dono com `OPENAI_API_KEY` presente. É **opcional**: o seam está provado
no momento em que **uma** normalização cross-provider real (OpenAI STRING-JSON → `JSON.parse` → `unknown`
→ Zod no cartucho) roda contra fixtures; **#231 NÃO é gated por rodar o A/B vivo**. Quando rodado:
replay do **mesmo `inputPayload`** no modelo OpenAI vs Sonnet 4.5 sobre ~10–20 jogos históricos reais já
em `ai_calls`, comparando 4 números da auditoria existente: (1) concordância de recomendação no
`selectionKey`-ou-`pass`; (2) concordância de decisão de edge pós-staking; (3) **reprodutibilidade do
próprio caminho OpenAI** — re-rodar cada payload 3× (protocolo #105), contar flips / |Δconf| mediano;
(4) delta de custo de `ai_calls.costUsd`.

- **GRADUAR** (sair de admin-only) SÓ SE o caminho OpenAI for **ambos**: (a) reproduzível à barra do
  ADR 0021 (flips ~zero em 3 reruns; |Δconf| mediano ≤ 5pp) **E** (b) com sinal concreto de
  aprendizado/qualidade/custo que valha manter uma 2ª integração.
- **PARAR na PoC** (deixar OpenAI `userSelectable:false` inerte pra sempre, ou deletar o adapter
  mantendo só o seam do #230) SE: flipa sozinho; só ecoa o Sonnet 4.5 sem delta; custa mais com
  estabilidade igual; o structured-output `strict` não satisfaz um cartucho sem edits bespoke
  (re-acoplaria o seam aos mercados — falha limpa de prova); ou qualquer comportamento exige
  `if (provider === X)` em predict (o seam falhou).
- **DISPOSIÇÃO PADRÃO NO EMPATE = PARAR.** "O seam foi a lição, OpenAI fica inerte" é um sucesso de
  primeira classe, não falha. Provider #3 precisa do próprio go.

## Consequências

- **(+)** `predict.ts` deixa de importar o SDK; fronteira explícita e **testável**; provider novo vira
  edição de registry; auditoria precisa por provider.
- **(−)** Multi-provider tensiona reprodutibilidade — graduação é **condicional**, default-on-tie =
  PARAR, inerte é estado terminal legítimo.
- **(−)** Pricing OpenAI é **verify-at-#231** (estimativas jun-2026 só); _wire shape_ inferido de docs
  até existir chave (postura SportMonks #227). Gotcha de custo: modelos de raciocínio OpenAI **dobram**
  reasoning tokens em `completion_tokens` (itemizado em `completion_tokens_details.reasoning_tokens`) —
  mapear `outputTokens = completion_tokens` (já inclui reasoning; **não** somar de novo, **não** ler só
  o itemizado), coagido a int finito.
- **(−)** Custo do A/B é gasto real manual, nunca em CI/teste.
- **Landmine registrada (não herdar em silêncio):** `StoredRequestSchema` do replay-eval
  (`replay-prompt-eval.ts:139-143`) exige `{model, messages, max_tokens}` — um `inputPayload` OpenAI usa
  `max_completion_tokens`; se um admin rodasse OpenAI vivo e depois replay-eval, a query de baseline-pin
  (`ne(promptVersion, ...)`, `:233`) poderia puxar um payload OpenAI que o schema rejeita → `ReplayError`
  gracioso (linha excluída das stats), **não** crash. Aceitável (rows OpenAI inertes neste env), mas nomeado.

## Questões em aberto (resolver no #231)

1. Pricing OpenAI + id exato `gpt-5-mini`-class — re-confirmar em `developers.openai.com` e encodar no
   `MODEL_REGISTRY` com sentinela de drift antes de qualquer roteamento.
2. _Wire shapes_ OpenAI (nomes de campos de usage; hierarquia de subclasses de erro; suporte de keywords
   no JSON-Schema do `strict:true`) — codificados de docs, **não-verificados** até existir chave (postura
   SportMonks #227); validação ao vivo é out-of-band do dono.
3. Compatibilidade `strict:true`: structured outputs OpenAI exigem `additionalProperties:false` +
   todas-as-keys-required e rejeitam alguns keywords (`minimum`/`maximum`, certos refinements) que o
   `tool.input_schema` do cartucho pode usar. Se algum cartucho não down-mapear sem edit bespoke, **isso
   é um sinal de PARAR** do A/B.
4. Constraint `CHECK` em `ai_calls.provider` além do allowlist na app? Lean atual: **só app guard** (solo).
5. Guard de lint confinando imports-de-**valor** de `@anthropic-ai/sdk`/`openai` a `lib/ai/providers/**`
   (+ `scripts/replay-*`)? Se adicionado, **só** value-imports (cartuchos legitimamente `import type`),
   senão bate vermelho em 9+ arquivos existentes.

## Referências

ADR 0008 (modelo configurável; request model-aware), ADR 0013 (gate de audiência; cascade 4 níveis),
ADR 0021 (default reproduzível Sonnet 4.5; gate model-aware), ADR 0026/#227 (padrão `hasKey()` inerte
SportMonks). Código: `lib/ai/predict.ts` (seam 776-823; literais 229/922; `persistAiCallError` 204-252;
`AiCallStatus` 99), `lib/ai/anthropic.ts`, `lib/ai/request-builder.ts`, `lib/ai/models.ts`
(`MODEL_REGISTRY`/`AIModelId`/`AIModel`/`thinkingMode`/`userSelectable`/`DEFAULT_MODEL_ID`),
`lib/ai/cost.ts` (`calculateCost`), `db/schema.ts:50/233` (`aiProviderEnum`), `:52/242`
(`aiCallStatusEnum`/`status`), `scripts/replay-eval-core.ts:30-34` (`classifyThinkingMode`),
`scripts/replay-prompt-eval.ts:139-143` (`StoredRequestSchema`). Issues #229 → #230 → #231.
