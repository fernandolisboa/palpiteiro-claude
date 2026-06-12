# ADR 0017 — Cartuchos de prompt por mercado e versionamento multi-mercado

## Status

Accepted (2026-06-12) — detalha o **ADR 0015** (pivot multi-mercado) no eixo de prompt/IA

## Contexto

O prompt é mono-mercado e resolvido em **compile-time**:

- `lib/ai/predict.ts` importa **estaticamente** o cartucho over/under em **dois** módulos:
  `./prompts/over_under_v1` (`PROMPT_VERSION`, `SUBMIT_PREDICTION_TOOL`, `SYSTEM_PROMPT`,
  `buildUserMessage` — `predict.ts:37-42`) **e** `OverUnderOutputSchema` de `./schemas/output`
  (`predict.ts:43`). O input também é over/under-shaped: `buildPredictionInput`
  (`predict.ts:377-406`, de `./build-input`) consome `OverUnderInput` (`lib/ai/schemas/input.ts`)
  e `computeImpliedProbabilities(overOdd, underOdd)` (`predict.ts:367-372`).
- O `SYSTEM_PROMPT` instrui foco "exclusivamente no mercado over/under 2.5 gols"
  (`over_under_v1.ts:5`); `PROMPT_VERSION = "over_under_v1.3"` (`over_under_v1.ts:3`); o tool
  `submit_prediction` hardcoda o enum `["over","under","pass"]` (`over_under_v1.ts:39-43`); o
  `OverUnderOutputSchema` carrega regras de negócio over/under (`minimum_odd` obrigatório sse
  `recommendation !== "pass"`, convenção "no pass, `confidence_pct` é a estimativa pro over" —
  `schemas/output.ts:19-54`).

A boa notícia: a **fronteira já é meio-limpa**. `lib/ai/request-builder.ts` é **market-agnostic**
(`buildAnthropicRequest({ model, system, userMessage, tools, toolName, maxTokens, effort?,
temperature? })`, `request-builder.ts:32-44` — zero literal over/under) e as camadas de
`generation-params`/`models` também. O acoplamento se concentra em `predict.ts` + 3 módulos-cartucho
(`prompts/over_under_v1`, `schemas/output`+`schemas/input`, e — no eixo de odds — `odds/select-bookmaker`).

Este ADR define a **camada de adaptação de prompt por mercado** (o "cartucho"), preservando essa
fronteira market-agnostic já existente.

## Decisão

1. **Registry de cartuchos de mercado em `lib/ai/markets/<key>/`.** Cada cartucho é o conjunto
   **LLM-facing** de um mercado:

   ```ts
   type MarketCartridge = {
     marketKey: string;            // "over_under", "match_result", "btts", "double_chance"
     version: string;              // semver-like POR cartucho: "over_under_v2", "match_result_v1"
     systemPrompt: string;         // SYSTEM_PROMPT-base + camada do mercado (ponto 2)
     tool: Anthropic.Tool;         // submit_prediction com o enum de seleções do mercado
     toolName: string;             // "submit_prediction"
     inputSchema: ZodSchema;       // forma do input do mercado (sucessor de OverUnderInput)
     buildUserMessage: (input) => string;   // render do input pro modelo
     outputSchema: ZodSchema;      // Zod da saída + regras de negócio do mercado
     selections: MarketSelection[]; // seleções (alinhadas com market_selections, ADR 0015)
   };
   ```

   `predict()` recebe `marketKey` e **resolve o cartucho por lookup** (não mais import estático).
   **Fora do escopo deste cartucho** (delegado ao eixo de odds): a seleção de bookmaker por mercado
   (sucessor de `pickBestTotalsBookmaker`, que hoje hardcoda `point !== 2.5`) e o cálculo de
   implícita/edge por seleção — isso é o **ADR 0018** (cenários N-vias) + Fase 2 (#163/#164). O
   eixo de odds entrega ao cartucho um **input já validado** pelo `inputSchema`; o cartucho só
   sabe falar com o LLM.

2. **`SYSTEM_PROMPT`-base compartilhado + camada por mercado.** A base concentra a disciplina
   **transversal**: edge ≥ `MIN_EDGE_PP` (5pp) sobre a implícita **normalizada** (overround do
   mercado completo — ADR 0018), postura **pass-first** (pass rate alvo 30–60%), anti-alucinação, e
   as regras de redação leiga do rationale (ADR 0012-cenários, decisão 2). A camada por mercado
   acrescenta: as seleções, a forma da linha (`market_params`), e o enquadramento específico
   (gols/resultado/ambas marcam). O constante `MIN_EDGE_PP` continua exportado de
   `lib/odds/scenario.ts` e **pinado por teste** ao texto da base (`request-builder.test.ts`,
   hoje `expect(SYSTEM_PROMPT).toContain(\`${MIN_EDGE_PP} pontos percentuais\`)`) — o teste de sincronia passa
   a apontar pro `systemPrompt` do cartucho (ou pra base compartilhada).

3. **Versionamento semver-like POR cartucho**, persistido em `prompt_version` como hoje. Exemplos:
   `over_under_v2` (o atual `over_under_v1.3` é o ponto de partida), `match_result_v1`, `btts_v1`,
   `double_chance_v1`. **Dupla persistência preservada:** `prompt_version` é gravado em
   `ai_calls.promptVersion` (`predict.ts:192` no erro, `:531` no sucesso) **e** em
   `predictions.promptVersion` (`:600`) — historicamente atribuível por cartucho+versão. O commit
   type **`prompt:`** continua obrigatório a cada bump (rastreabilidade, CLAUDE.md).

4. **O cartucho passa por `buildAnthropicRequest` e preserva as camadas market-agnostic.** O
   `predict()` continua:
   - resolvendo o **modelo** pela cascata `override > preferência do usuário (audience-gated) >
     default global > DEFAULT_MODEL_ID` (`predict.ts:229-238`; primitives em `lib/ai/models.ts`,
     gating do ADR 0013) — **isso roda uma vez, antes do cartucho, e é independente de mercado: o
     ADR não o move**;
   - lendo os **generation-params** calibráveis (`getGenerationParams()` → `maxTokens/effort/
     temperature`, ADR 0008/#147), consumidos **model-aware** (maxTokens sempre, `effort` só no
     caminho adaptive, `temperature` só no caminho temperature);
   - chamando `buildAnthropicRequest` com o `systemPrompt`, `[tool]` e `toolName` **do cartucho**.
   - **Bifurcação adaptive vs temperature preservada** (`request-builder.ts:53-73`, chaveada por
     `model.thinkingMode`): no caminho **temperature** o `tool_choice` é **forçado**; no caminho
     **adaptive** é `auto` (tool **não** forçado, senão Opus 4.x dá HTTP 400) — então o tratamento
     de **`tool_missing`** (o modelo não chamou o tool: `persistAiCallError` + throw, `predict.ts:476-493`)
     **continua** valendo, agora por cartucho.

   Postura de modelo do **ADR 0021** respeitada: o default global migra pra **Sonnet 4.5**
   (`temperature 0.3`, reproduzível) — implementação é follow-up, ortogonal ao cartucho. O gate de
   eval **model-aware** (ADR 0021, decisão 2) é preservado (ponto 6).

5. **Fronteira intocada: `lib/ai/predict.ts` segue a ÚNICA porta pro LLM.** Todo cartucho loga em
   `ai_calls` (sucesso **e** erro, com `prompt_version`, `model`, custo) e tem a saída **validada
   por Zod** (`cartridge.outputSchema.safeParse(toolUse.input)`, sucessor de `predict.ts:496`) antes
   de qualquer uso. Nada de chamar o Anthropic SDK fora dessa porta (regra do CLAUDE.md).

6. **Replay eval (`scripts/replay-prompt-eval.ts`) se estende por mercado.** O gate (#105, tornado
   **model-aware** pelo ADR 0021) replaya payloads de `ai_calls`. Passa a:
   - **agrupar os payloads por cartucho/mercado** e replayar cada um contra o `systemPrompt`/
     `outputSchema` do **seu** cartucho na versão corrente;
   - aplicar a regra de flip **model-aware** por payload (estrita no caminho temperature; tolerante
     a ruído single-shot — N runs — no caminho adaptive);
   - reprovar **por (mercado, versão)**: um bump de cartucho roda o gate só pra aquele mercado.

## Razão

- **A fronteira já está meio-pronta** (`request-builder`/`generation-params`/`models` agnósticos):
  o cartucho é a peça que falta, e isolá-lo num registry evita `if (market === X)` em `predict.ts`
  (princípio do ADR 0015).
- **Base + camada** evita duplicar a disciplina de edge/pass/anti-alucinação em cada mercado (e
  mantém o pino de `MIN_EDGE_PP` num lugar só).
- **Versão por cartucho** mantém a comparabilidade de calibração **dentro** de um mercado (Yield de
  `over_under_v2` é comparável ao de `over_under_v2`, não ao de `match_result_v1`) e o `prompt:` por
  bump preserva a rastreabilidade.
- **Preservar a cascata/params/bifurcação** garante que o pivot não regrida ADR 0008/0013/0021 — o
  cartucho troca **o quê** se pede ao modelo, não **como** o modelo é escolhido/parametrizado.

## Alternativas consideradas

- **Manter import estático + `if (market === X)` em `predict.ts`:** rejeitado — espalha a variação
  e contraria o princípio não-aditivo do ADR 0015.
- **Um SYSTEM_PROMPT gigante multi-mercado (sem camada base):** rejeitado — duplica disciplina,
  infla tokens e embaralha a calibração; a base compartilhada concentra o transversal.
- **Versão única global de prompt (como hoje):** rejeitado — um bump em BTTS invalidaria a
  comparabilidade do over/under; versão por cartucho isola.
- **Mover a cascata de modelo pra dentro do cartucho:** rejeitado — a escolha de modelo é
  **ortogonal** ao mercado e roda uma vez antes; misturar quebraria ADR 0013/0021.
- **Incluir seleção de bookmaker/edge no cartucho:** rejeitado **deste** ADR — é eixo de odds (ADR
  0018 / Fase 2); o cartucho recebe input já validado e só fala com o LLM.

## Consequências

- (+) Novo mercado = **um diretório** `lib/ai/markets/<key>/` + seed em `markets`; `predict.ts`
  não muda.
- (+) `request-builder`/`generation-params`/`models` ficam **intocados** (já agnósticos).
- (+) Calibração e rastreabilidade preservadas por (mercado, versão); `prompt:` por bump.
- (−) `predict.ts` passa de import estático pra **lookup** + orquestração (input → cartucho →
  request → validação) — refactor concentrado (#165, Fase 2), não nesta fase.
- (−) O teste de sincronia `MIN_EDGE_PP ↔ SYSTEM_PROMPT` precisa apontar pra base/cartucho — ajuste
  pontual.
- (±) `OverUnderInput`/`buildPredictionInput`/`OverUnderOutputSchema` migram pra
  `lib/ai/markets/over_under/` como o **primeiro** cartucho (paridade exata, Fase 2).

## Referências

- Issue **#154**; detalha o **ADR 0015** no eixo de prompt/IA. Implementação: Fase 2 (#165 cartucho
  + `predict()` por `marketKey`).
- **Preserva:** ADR 0008 (generation-params), ADR 0013 (cascata + gating de audiência), ADR 0021
  (Sonnet 4.5 default + gate model-aware), ADR 0012-cenários decisão 2 (redação leiga do rationale).
- **Relacionado:** ADR 0018 (edge/EV/cenários N-vias — o eixo de odds que alimenta o cartucho).
- Código: `lib/ai/predict.ts` (porta única, cascata `:229-238`, validação Zod `:496`, dupla
  persistência de `prompt_version`), `lib/ai/request-builder.ts` (`buildAnthropicRequest`,
  bifurcação `:53-73`), `lib/ai/prompts/over_under_v1.ts` (`PROMPT_VERSION`, `SYSTEM_PROMPT`, tool),
  `lib/ai/schemas/{output,input}.ts`, `lib/ai/generation-params.ts`, `lib/ai/models.ts`,
  `scripts/replay-prompt-eval.ts` (gate model-aware).
