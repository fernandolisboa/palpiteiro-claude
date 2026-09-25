import type Anthropic from "@anthropic-ai/sdk";

import type { Effort } from "@/lib/ai/generation-params";
import type { AIModel } from "@/lib/ai/models";
import type { ServerToolDef } from "../types";

// Constrói o corpo da request ao Claude de forma MODEL-AWARE. Encapsulado aqui
// (em vez de inline em predict.ts) pra que a lógica condicional — a única parte
// que diverge por modelo — seja testável isoladamente, sem mocks.
//
// GOTCHA CRÍTICO (Anthropic API): os modelos adaptive do registry (Fable 5.1, Opus
// 5.5, Sonnet 5 — #524) REJEITAM (400) `temperature`/`top_p`/`top_k` e
// `budget_tokens`; Fable 5.1 e Opus 5.5 também rejeitam `thinking: {type:
// "disabled"}`. Sonnet 4.5/Haiku ACEITAM `temperature`. Portanto:
//   - thinkingMode "adaptive"     → `thinking: { type: "adaptive" }` (nunca disabled,
//                                    nunca budget_tokens), SEM sampling params
//   - thinkingMode "temperature"  → `temperature`, SEM `thinking`
//
// GOTCHA CRÍTICO #2 (Anthropic API): `tool_choice` FORÇADO (`any`/`tool`) dá 400
// no Fable 5.1 e no Opus 5.5, e com thinking ligado é incompatível em geral (o
// Sonnet 5 aceita forçar, mas só com thinking desligado). Por isso `tool_choice` é
// MODEL-AWARE:
//   - adaptive (Fable/Opus/Sonnet 5) → `tool_choice: { type: "auto" }` (o modelo pode
//                                    responder só texto; predict/narrador tratam a
//                                    ausência do tool_use como `tool_missing`)
//   - temperature (Sonnet 4.5/Haiku) → `tool_choice: { type: "tool", name }` forçado
//
// GOTCHA CRÍTICO #3 (calibração — ADR 0008 emenda 2): os parâmetros de geração são
// MODEL-AWARE no mesmo eixo. `effort` (profundidade do thinking) só faz sentido —
// e só é aceito — nos modelos adaptive; Sonnet 4.5/Haiku retornam erro com effort,
// então NÃO entra no caminho temperature. `temperature` é o knob simétrico, só pro
// caminho temperature. `maxTokens` vale pros dois. `output_config.effort` é GA no
// /v1/messages (sem beta header) e já vem tipado no params do SDK — seta direto.
//
// Sem PREFILL em nenhum caminho: `messages` é sempre `[user]` (os adaptive dão 400
// com a última mensagem do assistant). A única mensagem de assistant que sai daqui
// pra API é a retomada de `pause_turn` do ramo server-tool (index.ts), que é
// continuação documentada de server tool, não prefill.
//
// O mesmo objeto retornado é usado para o inputPayload logado em ai_calls E para
// a chamada real client.messages.create() — evita duplicação/divergência.

export function buildAnthropicRequest(args: {
  model: AIModel;
  system: string;
  userMessage: string;
  tools: Anthropic.Tool[];
  toolName: string;
  maxTokens: number;
  // MODEL-AWARE (ver generation-params.ts): `effort` só é aplicado no caminho
  // adaptive; `temperature` só no caminho temperature. Ambos opcionais — ausência
  // recai no default do registry / do servidor.
  effort?: Effort;
  temperature?: number;
  // ADITIVO opt-in (ADR 0032, #377). Presente ⇒ ramo server-tool; ausente ⇒ caminho
  // forçado byte-idêntico (todo o resto deste builder).
  serverTool?: ServerToolDef;
}): Anthropic.MessageCreateParamsNonStreaming {
  // RAMO SERVER-TOOL (ADR 0032, #377). PRECEDE tudo: web search precisa de
  // tool_choice:auto (NÃO o submit forçado). Os callers de hoje (notícias, cartões)
  // fixam Haiku 4.5 (temperature). NÃO declara o submit tool nem code_execution.
  //
  // GOTCHA (Anthropic API, ADR 0032 §1): usamos `web_search_20250305` (BÁSICA), travado
  // a DOIS fatos: (1) os callers do ramo usam Haiku 4.5 (temperature-mode); a variante
  // `web_search_20260209` (dynamic filtering) exige Opus 4.6+/Sonnet 4.6+ E puxa a
  // code_execution tool por baixo (confunde o modelo). (2) É first-party Anthropic (a
  // API que este app usa): no Bedrock web search não existe e no Vertex só a básica.
  // NÃO troque por `_20260209` sem migrar os callers pra um modelo adaptive.
  // Se um adaptive cair aqui, o payload segue válido: sem `thinking` explícito (os
  // adaptive do registry rodam adaptive ao omitir) e sem temperature.
  if (args.serverTool) {
    const webSearch = {
      type: "web_search_20250305",
      name: "web_search",
      ...(args.serverTool.maxUses !== undefined
        ? { max_uses: args.serverTool.maxUses }
        : {}),
      ...(args.serverTool.allowedDomains
        ? { allowed_domains: args.serverTool.allowedDomains }
        : {}),
    } as unknown as Anthropic.Tool;
    return {
      model: args.model.id,
      system: args.system,
      messages: [{ role: "user", content: args.userMessage }],
      tools: [webSearch],
      tool_choice: { type: "auto" },
      max_tokens: args.maxTokens,
      // Caminho temperature (Haiku/Sonnet 4.5): SEM thinking; temperature opcional
      // (default do registry → 0.3). SEM forçar submit, então `auto` é válido.
      ...(args.model.thinkingMode === "temperature"
        ? { temperature: args.temperature ?? args.model.temperature ?? 0.3 }
        : {}),
    };
  }

  const base: Anthropic.MessageCreateParamsNonStreaming = {
    model: args.model.id,
    system: args.system,
    messages: [{ role: "user", content: args.userMessage }],
    tools: args.tools,
    max_tokens: args.maxTokens,
  };

  if (args.model.thinkingMode === "temperature") {
    // Caminho Sonnet 4.5 / Haiku — força o submit_prediction (sem thinking, então
    // é válido). `temperature` calibrável; fallback no default do registry → 0.3.
    return {
      ...base,
      tool_choice: { type: "tool", name: args.toolName },
      temperature: args.temperature ?? args.model.temperature ?? 0.3,
    };
  }

  // Caminho adaptive (Fable 5.1 / Opus 5.5 / Sonnet 5): OMITE temperature/top_p/
  // top_k e budget_tokens, nunca manda thinking disabled e NÃO força o tool (forced
  // tool_choice = 400). `auto` deixa o modelo chamar o tool por conta própria;
  // predict.ts rejeita (tool_missing) se ele não chamar. `effort` (se fornecido)
  // calibra a profundidade do thinking via output_config.
  return {
    ...base,
    tool_choice: { type: "auto" },
    thinking: { type: "adaptive" },
    // effort calibra a profundidade do thinking (só adaptive); ausente → default do servidor.
    ...(args.effort ? { output_config: { effort: args.effort } } : {}),
  };
}
