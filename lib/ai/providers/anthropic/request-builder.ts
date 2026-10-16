import type Anthropic from "@anthropic-ai/sdk";

import type { Effort } from "@/lib/ai/generation-params";
import type { AIModel } from "@/lib/ai/models";
import type { ServerToolDef } from "../types";

// Constrói o corpo da request ao Claude. Encapsulado aqui (em vez de inline em
// predict.ts) pra o formato do corpo ser testável isolado, sem mocks.
//
// UM corpo pra todo modelo do registry (ADR 0061: Haiku, Sonnet e Opus 5.5, todos
// adaptive). GOTCHAS da API Anthropic que ele respeita:
//   - `thinking: { type: "adaptive" }`: nunca `disabled` (400 no Opus/Sonnet 5.5) nem
//     `budget_tokens` (400 nos três).
//   - SEM `temperature`/`top_p`/`top_k`: valores fora do default dão 400.
//   - `tool_choice: { type: "auto" }`: `tool`/`any` forçados dão 400 no Opus/Sonnet
//     5.5 (o Haiku 5.5 aceita, mas aí pula o thinking). O modelo pode responder só
//     texto; predict/narrador tratam a ausência do tool_use como `tool_missing`.
//   - `output_config.effort` (GA, sem beta header) calibra a profundidade do thinking.
//     Ausente → default do servidor (`medium` no Opus/Haiku 5.5, `high` no Sonnet 5.5).
//   - Sem PREFILL: `messages` é sempre `[user]` (prefill dá 400). A única mensagem de
//     assistant que sai daqui pra API é a retomada de `pause_turn` do ramo server-tool
//     (index.ts), que é continuação documentada de server tool, não prefill.
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
  // Ausente → default do servidor pro modelo.
  effort?: Effort;
  // ADITIVO opt-in (ADR 0032, #377). Presente ⇒ ramo server-tool (web search).
  serverTool?: ServerToolDef;
}): Anthropic.MessageCreateParamsNonStreaming {
  const effort = args.effort ? { output_config: { effort: args.effort } } : {};

  // RAMO SERVER-TOOL (ADR 0032, #377). NÃO declara o submit tool nem code_execution.
  //
  // GOTCHA (Anthropic API, ADR 0032 §1): usamos `web_search_20250305` (BÁSICA). A
  // variante `web_search_20260209` (dynamic filtering) não roda no Haiku 5.5 (o modelo
  // dos callers de hoje: notícias, cartões) e puxa a code_execution tool por baixo,
  // que confunde o modelo. Também é a única no Vertex (no Bedrock web search não
  // existe). NÃO troque por `_20260209` sem tirar os callers do Haiku.
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
      thinking: { type: "adaptive" },
      ...effort,
    };
  }

  return {
    model: args.model.id,
    system: args.system,
    messages: [{ role: "user", content: args.userMessage }],
    tools: args.tools,
    max_tokens: args.maxTokens,
    tool_choice: { type: "auto" },
    thinking: { type: "adaptive" },
    ...effort,
  };
}
