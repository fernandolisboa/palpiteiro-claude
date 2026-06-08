import type Anthropic from "@anthropic-ai/sdk";

import type { AIModel } from "./models";

// Constrói o corpo da request ao Claude de forma MODEL-AWARE. Encapsulado aqui
// (em vez de inline em predict.ts) pra que a lógica condicional — a única parte
// que diverge por modelo — seja testável isoladamente, sem mocks.
//
// GOTCHA CRÍTICO (Anthropic API): Opus 4.8 usa adaptive thinking e REJEITA (400)
// `temperature`/`top_p`/`top_k`. Sonnet 4.5 ACEITA `temperature`. Portanto:
//   - thinkingMode "adaptive"     → `thinking: { type: "adaptive" }`, SEM temperature
//   - thinkingMode "temperature"  → `temperature`, SEM `thinking`
//
// GOTCHA CRÍTICO #2 (Anthropic API): combinar `thinking` com `tool_choice` FORÇADO
// (`{ type: "tool", name }`) dá 400 no Opus 4.8 — forced tool use é incompatível
// com thinking. Por isso `tool_choice` é MODEL-AWARE:
//   - adaptive (Opus 4.8)         → `tool_choice: { type: "auto" }` (predict.ts já
//                                    trata a ausência do tool_use de submit_prediction)
//   - temperature (Sonnet 4.5)    → `tool_choice: { type: "tool", name }` forçado
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
}): Anthropic.MessageCreateParamsNonStreaming {
  const base: Anthropic.MessageCreateParamsNonStreaming = {
    model: args.model.id,
    system: args.system,
    messages: [{ role: "user", content: args.userMessage }],
    tools: args.tools,
    max_tokens: args.maxTokens,
  };

  if (args.model.thinkingMode === "temperature") {
    // Caminho Sonnet 4.5 — força o submit_prediction (sem thinking, então é válido).
    return {
      ...base,
      tool_choice: { type: "tool", name: args.toolName },
      temperature: args.model.temperature ?? 0.3,
    };
  }

  // Caminho adaptive (Opus 4.8): OMITE temperature/top_p/top_k e NÃO força o tool
  // (forced tool_choice + thinking = 400). `auto` deixa o modelo chamar o tool por
  // conta própria; predict.ts rejeita se ele não chamar submit_prediction.
  return {
    ...base,
    tool_choice: { type: "auto" },
    thinking: { type: "adaptive" },
  };
}
