import Anthropic from "@anthropic-ai/sdk";

import type { AiCallStatus } from "../types";

// Classificação dos erros do SDK Anthropic pros `AiCallStatus` do seam. Movido
// verbatim de predict.ts (#230): o `instanceof` nas classes do SDK + a extração de
// header é EXATAMENTE a parte provider-específica que vive atrás do adapter. O
// status fica no subconjunto que o adapter pode emitir (provider_error|timeout|
// rate_limited); `ok`/`invalid_output`/`tool_missing`/`fidelity_divergence` são donos
// de predict/generator.
export function classifyAnthropicError(err: unknown): {
  status: Exclude<
    AiCallStatus,
    "ok" | "invalid_output" | "tool_missing" | "fidelity_divergence"
  >;
  message: string;
} {
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return { status: "timeout", message: err.message };
  }
  if (err instanceof Anthropic.RateLimitError) {
    const retryAfter = err.headers?.get?.("retry-after") ?? null;
    return {
      status: "rate_limited",
      message: `${err.status}: ${err.message}${retryAfter ? ` (retry-after=${retryAfter})` : ""}`,
    };
  }
  if (err instanceof Anthropic.APIError) {
    const requestId = err.headers?.get?.("request-id") ?? null;
    return {
      status: "provider_error",
      message: `${err.status ?? "?"}: ${err.message}${requestId ? ` (request-id=${requestId})` : ""}`,
    };
  }
  return {
    status: "provider_error",
    message: err instanceof Error ? err.message : String(err),
  };
}

// Serializa o erro do SDK pro `outputPayload.error` logado em `ai_calls`. Movido
// verbatim de predict.ts (#230).
export function serializeAnthropicError(err: unknown): Record<string, unknown> {
  if (err instanceof Anthropic.APIError) {
    return {
      name: err.name,
      message: err.message,
      status: err.status ?? null,
      requestId: err.headers?.get?.("request-id") ?? null,
    };
  }
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { error: String(err) };
}
