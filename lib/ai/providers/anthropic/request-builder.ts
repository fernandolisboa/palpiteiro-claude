import type Anthropic from "@anthropic-ai/sdk";

import type { Effort } from "@/lib/ai/generation-params";
import type { AIModel } from "@/lib/ai/models";

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
// GOTCHA CRÍTICO #3 (calibração — ADR 0008 emenda 2): os parâmetros de geração são
// MODEL-AWARE no mesmo eixo. `effort` (profundidade do thinking) só faz sentido —
// e só é aceito — nos modelos adaptive; Sonnet 4.5/Haiku retornam erro com effort,
// então NÃO entra no caminho temperature. `temperature` é o knob simétrico, só pro
// caminho temperature. `maxTokens` vale pros dois. `output_config.effort` é GA no
// /v1/messages (sem beta header) e já vem tipado no params do SDK — seta direto.
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
}): Anthropic.MessageCreateParamsNonStreaming {
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

  // Caminho adaptive (Opus 4.8 / Sonnet 4.6): OMITE temperature/top_p/top_k
  // e NÃO força o tool (forced tool_choice + thinking = 400). `auto` deixa o modelo
  // chamar o tool por conta própria; predict.ts rejeita se ele não chamar. `effort`
  // (se fornecido) calibra a profundidade do thinking via output_config.
  return {
    ...base,
    tool_choice: { type: "auto" },
    thinking: { type: "adaptive" },
    // effort calibra a profundidade do thinking (só adaptive); ausente → default do servidor.
    ...(args.effort ? { output_config: { effort: args.effort } } : {}),
  };
}
