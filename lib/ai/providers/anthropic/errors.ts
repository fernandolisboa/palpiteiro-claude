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

// Rejeição do pedido pela API, separada do resto dos `provider_error`: um 400 diz
// que o corpo não serve pra aquele modelo; 404 e 403 dizem que o modelo não existe
// ou a chave não tem acesso. Qualquer outro erro → undefined.
export function rejectionOf(
  err: unknown,
): "invalid_request" | "not_found" | undefined {
  if (err instanceof Anthropic.BadRequestError) return "invalid_request";
  if (
    err instanceof Anthropic.NotFoundError ||
    err instanceof Anthropic.PermissionDeniedError
  ) {
    return "not_found";
  }
  return undefined;
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

// Recusa do modelo (#524). Os modelos 5.5 (o Haiku sem fallback server-side) podem
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

// 529 `overloaded_error`: a API está sem capacidade agora (o SDK já esgotou os
// retries). Não diz nada sobre o pedido nem sobre o modelo — o seam das versões
// adotadas (ADR 0062) usa isto pra cair na conferida SEM marcar a versão nova.
export function isOverloadedError(err: unknown): boolean {
  if (!(err instanceof Anthropic.APIError)) return false;
  if (err.status === 529) return true;
  const body = err.error as { error?: { type?: unknown } } | undefined;
  return body?.error?.type === "overloaded_error";
}
