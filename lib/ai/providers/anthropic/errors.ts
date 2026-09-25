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

// Recusa do modelo (#524). Fable 5.1 (e, em tese, qualquer Claude recente) pode
// responder HTTP 200 com `stop_reason: "refusal"` e um `stop_details` {category,
// explanation}: a chamada foi paga, mas o conteúdo não serve. É erro TIPADO (não
// uma string solta) pra o caller distinguir de falha de provider/rede e mostrar
// "o modelo recusou a análise" em vez de "tente novamente". Vai em `cause` do
// AnalysisErr; o `refusal` neutro do seam carrega os mesmos campos.
export class ModelRefusalError extends Error {
  readonly category: string | null;
  readonly explanation: string | null;
  constructor(category: string | null, explanation: string | null) {
    super(
      `o modelo recusou a análise${category ? ` (category=${category})` : ""}${
        explanation ? `: ${explanation}` : ""
      }`,
    );
    this.name = "ModelRefusalError";
    this.category = category;
    this.explanation = explanation;
  }
}

// Lê a recusa de uma resposta. `null` = não é recusa. Checado ANTES de ler
// `content` (o conteúdo de uma recusa pode vir vazio ou parcial). `stop_details`
// só vem populado em recusa e pode faltar (respostas sem o campo, mocks) — daí o `?.`.
export function refusalFromMessage(message: {
  stop_reason: Anthropic.Message["stop_reason"];
  stop_details?: Anthropic.RefusalStopDetails | null;
}): ModelRefusalError | null {
  if (message.stop_reason !== "refusal") return null;
  return new ModelRefusalError(
    message.stop_details?.category ?? null,
    message.stop_details?.explanation ?? null,
  );
}
