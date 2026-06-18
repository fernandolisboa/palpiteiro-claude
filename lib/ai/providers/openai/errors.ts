import { APIConnectionTimeoutError, APIError, RateLimitError } from "openai";

import type { AiCallStatus } from "../types";

// Classificação dos erros do SDK OpenAI pros AiCallStatus do seam (ADR 0027). Gêmeo
// quase-1:1 do adapter Anthropic: a hierarquia de erro da OpenAI espelha a da
// Anthropic (status/message/headers-com-request-id). O status fica no subconjunto
// que o adapter pode emitir (provider_error|timeout|rate_limited).
export function classifyOpenAIError(err: unknown): {
  status: Exclude<AiCallStatus, "ok" | "invalid_output" | "tool_missing">;
  message: string;
} {
  if (err instanceof APIConnectionTimeoutError) {
    return { status: "timeout", message: err.message };
  }
  if (err instanceof RateLimitError) {
    const retryAfter = err.headers?.get?.("retry-after") ?? null;
    return {
      status: "rate_limited",
      message: `${err.status}: ${err.message}${retryAfter ? ` (retry-after=${retryAfter})` : ""}`,
    };
  }
  if (err instanceof APIError) {
    const requestId = err.headers?.get?.("x-request-id") ?? null;
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

// Serializa o erro do SDK pro outputPayload.error logado em ai_calls.
export function serializeOpenAIError(err: unknown): Record<string, unknown> {
  if (err instanceof APIError) {
    return {
      name: err.name,
      message: err.message,
      status: err.status ?? null,
      requestId: err.headers?.get?.("x-request-id") ?? null,
    };
  }
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { error: String(err) };
}
