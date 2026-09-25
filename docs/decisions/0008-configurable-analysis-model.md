# ADR 0008 — Modelo de análise configurável (default global + override admin)

## Status
Accepted (2026-06) — **emenda o ADR 0001** (que fixava Sonnet-only no MVP).

## Contexto

Implementação da issue #57. Até aqui o modelo da análise era hardcoded em
`claude-sonnet-4-5-20250929` (const `ANTHROPIC_MODEL` em `lib/ai/anthropic.ts`),
e `lib/ai/cost.ts` só conhecia o pricing do Sonnet 4.5. Queríamos poder trocar o
modelo (ex.: Opus 4.8 como default; Sonnet pra economizar em jogos específicos)
**sem redeploy**, mantendo o tracking de custo correto por análise.

Ainda é o mesmo provider (Anthropic) — não é provider novo, então não exige ADR
de provider —, mas o mecanismo de configuração + a divergência de request por
modelo são decisões técnicas relevantes que ficam documentadas aqui (CLAUDE.md).

## Decisão

1. **Híbrido: default global em DB + override admin por análise.**
   - **Default global** persistido em `ai_config` (single-row, PK fixa em 1),
     editável em `/admin/settings` sem redeploy. Seed = Opus 4.8
     (`claude-opus-4-8`) dentro da migration `0004`. `defaultModelId` é `text`
     simples (não enum), validado contra o registry na query layer — espelha
     `ai_calls.model` / `predictions.modelVersion` e evita migration toda vez
     que o registry muda.
   - **Override por análise** na página do jogo, visível e aplicável **só a
     admin** (`users.role === "admin"`); opções: "usar padrão global" ou um
     modelo específico. Usuário comum sempre usa o default global, sem seletor.

2. **Gating reusa o admin que JÁ existe** (`users.role === "admin"`; enum em
   `db/schema.ts`, layout `/admin/**`, role carimbada no JWT — ADR 0007). Sem
   `ADMIN_EMAILS` nem mecanismo novo. A role é **revalidada DENTRO das server
   actions** (`updateDefaultModel` e `analyzeMatch`), pois server actions são
   POST chamáveis fora do layout — esconder a UI não basta.

3. **Registry tipado é a única fonte de ids/pricing** (`lib/ai/models.ts`:
   `MODEL_REGISTRY`, `DEFAULT_MODEL_ID`, `isAIModelId`, `SELECTABLE_MODELS`).
   Nada de strings de modelo soltas — predict, cost, UI e actions resolvem daqui.
   Dois modelos: Opus 4.8 ($5/$25 por 1M, default) e Sonnet 4.5 ($3/$15).

4. **Construção da request MODEL-AWARE** (`lib/ai/request-builder.ts`): Opus 4.8
   usa adaptive thinking (`thinking: { type: "adaptive" }`) e **OMITE**
   `temperature`/`top_p`/`top_k`; Sonnet 4.5 mantém `temperature: 0.3`. Isto
   porque a família Opus 4.x retorna **HTTP 400** em parâmetros de sampling — sem
   essa divergência, trocar pra Opus daria 400 em produção. O mesmo objeto é
   usado pro `inputPayload` logado e pra chamada real (sem duplicação).
   - `tool_choice` também é model-aware: `tool_choice` FORÇADO
     (`{ type: "tool", name }`) é **incompatível com adaptive thinking** e retorna
     **HTTP 400** no Opus 4.8. Por isso o caminho adaptive (Opus) usa
     `tool_choice: { type: "auto" }` e `predict.ts` trata o modelo decidir não
     chamar `submit_prediction` (status `tool_missing` em `ai_calls`); só o
     caminho temperature (Sonnet) força o tool.

5. **`predict.ts` segue como única porta da LLM** (CLAUDE.md). Resolve o modelo
   uma vez (override → default global) e grava o modelo REAL usado em
   `ai_calls.model` + `predictions.modelVersion`. Validação Zod do output
   intacta.

## Razão

- **Default em DB**: troca sem redeploy, single-row trivial, fallback seguro no
  getter (id stale/inválido → `DEFAULT_MODEL_ID`, nunca um 404 de modelo no
  Anthropic).
- **Override só admin + revalidado na action**: defense-in-depth; usuário comum
  nunca escapa do default global.
- **Registry único**: sem strings soltas; todo modelo selecionável tem pricing
  garantido (corrige o custo zerado/NaN que o Opus daria com o dict só-Sonnet).
- **Request model-aware**: evita o 400 da família Opus em sampling params.

## Alternativas consideradas

- **Env var pro modelo** (tipo `ANALYSIS_MODEL`): exigiria redeploy a cada troca;
  rejeitado pelo requisito de editar sem deploy.
- **Tabela settings key/value genérica**: mais flexível, porém overkill pra um
  único valor; o single-row tipado é mais simples de consultar.
- **Enum no DB pro `defaultModelId`**: exigiria migration a cada mudança no
  registry; `text` validado na query layer evita isso e casa com as colunas de
  modelo já existentes.
- **Sonnet 4.6 em vez de 4.5**: mantido 4.5 pra preservar custo/comportamento
  atuais; manter o conjunto pequeno (2 modelos).

## Consequências

- (+) Troca de modelo (global) sem redeploy; admin pode usar Sonnet por análise.
- (+) Custo correto pra qualquer modelo selecionável; auditoria reflete o modelo
  real usado.
- (+) Adicionar/remover modelo = editar o registry (pricing) — sem migration.
- (−) Default Opus 4.8 aumenta o custo por análise (~$5/$25 vs $3/$15 por 1M) e
  pode mudar latência/output (adaptive thinking). Admin pode escolher Sonnet por
  análise ou rebaixar o default global pela UI.
- (−) `role` no JWT só atualiza no re-login (ADR 0007): um usuário promovido a
  admin não vê o seletor / não passa no gate até relogar. Comportamento
  pré-existente.
- (−) Se a linha de seed for removida ao editar a migration, prod fica com tabela
  vazia → o getter cai no `DEFAULT_MODEL_ID` (ainda correto), mas a página de
  settings mostra o fallback até o primeiro save.

## Emenda (2026-06)

A decisão #4 descreve o caminho adaptive (Opus/Sonnet 4.6/Fable) usando
`tool_choice: { type: "auto" }` e diz que "predict.ts trata o modelo decidir não
chamar `submit_prediction`". Em produção o `tool_missing` NÃO era o modelo
escolhendo não chamar a ferramenta: era o **`max_tokens` cortando o thinking**.

Nos modelos adaptive os tokens de *thinking* contam **dentro** do `max_tokens`.
O `MAX_TOKENS` estava fixo em **2048** (`lib/ai/predict.ts`) — suficiente para o
caminho temperature (Sonnet 4.5/Haiku: sem thinking, tool forçado, output
pequeno), mas baixo demais para o adaptive: o thinking estourava o teto **antes**
de o bloco `tool_use` sair, a resposta parava com `stop_reason: "max_tokens"`, e
`predict.ts` registrava `tool_missing` / `"LLM did not call submit_prediction
tool"`. Como o default global é adaptive, isso quebrava **toda** análise (e ainda
faturava ~2048 output tokens por falha). Trocar o default para Sonnet 4.6 não
resolvia — também é adaptive.

**Correção:** `MAX_TOKENS` 2048 → **16000** (recomendação não-streaming da
Anthropic; dá folga pro thinking + a tool call sem forçar gasto, já que é teto e
não meta). `effort` segue no default `high`. Tornar `max_tokens`/`effort`
configuráveis via `/admin/settings` (em vez de hardcoded) é trabalho de
follow-up. Ver também #123 (discovery: estratégia de modelo adaptive vs
temperature).

## Emenda 2 (2026-06)

Implementa o follow-up citado acima: os parâmetros de geração saem do hardcode e
viram **calibráveis em `/admin/settings`**, persistidos no `ai_config` (colunas
`max_tokens`, `effort`, `temperature`).

**Model awareness.** A calibração reusa a bifurcação por `thinkingMode` que o
`request-builder.ts` já fazia (decisão #4). Cada knob só é aplicado onde a API
aceita:

- `max_tokens` — TODOS os modelos (é teto; inofensivo pros temperature, que não
  usam a folga, e crítico pros adaptive, onde o thinking conta dentro dele).
- `effort` — SÓ modelos adaptive (Opus 4.8 / Sonnet 4.6 / Fable), via
  `output_config.effort`. Sonnet 4.5 / Haiku retornam erro com `effort`, então
  ele NÃO entra no caminho temperature. Níveis oferecidos: low/medium/high/max
  (todos suportados pelos adaptive do registry; `xhigh` omitido por não ser
  universal — ex.: Sonnet 4.6).
- `temperature` — SÓ modelos temperature-mode (Sonnet 4.5 / Haiku); substitui o
  default `0.3` que era fixo no registry. Adaptive continua omitindo sampling
  (400).

**Defaults e fallback.** Centralizados em `lib/ai/generation-params.ts`
(`GENERATION_PARAM_DEFAULTS` = 16000 / high / 0.3), espelhados no seed da
migration e no fallback POR CAMPO da query layer (`getGenerationParams`): um
valor ausente/inválido cai no default, nunca quebra a chamada (mesmo princípio do
`getDefaultModelId`).

**Edição protegida (UX).** Por serem sensíveis (mexem em custo/qualidade/latência
de TODA análise), os campos em `/admin/settings` começam **desabilitados**; um
toggle explícito ("entendo que são parâmetros sensíveis") libera a edição, com um
aviso destacado. A server action `updateGenerationParams` revalida role admin
(defense-in-depth) E os ranges, espelhando `updateDefaultModel`.

**Nota de tipagem.** `effort`/`output_config` são GA no `/v1/messages` (sem beta
header) e já vêm tipados no `MessageCreateParamsNonStreaming` do SDK
`@anthropic-ai/sdk@0.95.2` (`output_config.effort`), então o `request-builder`
seta direto, sem cast. O nosso `Effort` (low/medium/high/max) é subconjunto do
union do SDK (que inclui xhigh/null) — atribuível sem fricção.

> **Nota (2026-09-25, #524):** com Fable 5.1 / Opus 5.5 / Sonnet 5 no registry (todos
> aceitam `xhigh`), o `effort` passa a oferecer **low/medium/high/xhigh/max**. O default
> segue `high`, sempre enviado explícito (o default do servidor no Opus 5.5 é `medium`).
> Ver a emenda de #524 no ADR 0021.

### Consequências (emenda 2)

- (+) Calibrar max_tokens/effort/temperature sem redeploy, model-aware, sem 400.
- (+) `max_tokens` deixa de ser hardcode (a emenda 1 vira o default/seed).
- (−) `ai_config` ganha 3 colunas (migration aditiva, com defaults → backfill
  automático da row existente).
