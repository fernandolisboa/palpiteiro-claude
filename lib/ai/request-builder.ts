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
    tool_choice: { type: "tool", name: args.toolName },
    max_tokens: args.maxTokens,
  };

  if (args.model.thinkingMode === "temperature") {
    // Caminho Sonnet 4.5 — idêntico ao comportamento atual.
    return { ...base, temperature: args.model.temperature ?? 0.3 };
  }

  // Caminho adaptive (Opus 4.8): OMITE temperature/top_p/top_k.
  return { ...base, thinking: { type: "adaptive" } };
}
