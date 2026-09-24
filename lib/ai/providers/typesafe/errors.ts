import type { AiCallStatus } from "../types";

// Falhas da TypeSafe classificadas no cliente (ADR 0041 §5). `auth` cobre chave
// ausente/inválida (401/403); 529 (overloaded) cai em `provider_error` — é
// condição do provider, não cota nossa.
export type TypeSafeErrorKind =
  | "auth"
  | "rate_limited"
  | "timeout"
  | "bad_response"
  | "provider_error";

export class TypeSafeError extends Error {
  readonly kind: TypeSafeErrorKind;
  readonly httpStatus: number | null;
  readonly latencyMs: number;
  // Corpo cru recebido (quando houve), pro outputPayload do ai_calls.
  readonly responseBody: unknown;

  constructor(args: {
    kind: TypeSafeErrorKind;
    message: string;
    httpStatus?: number | null;
    latencyMs?: number;
    responseBody?: unknown;
    cause?: unknown;
  }) {
    super(args.message, { cause: args.cause });
    this.name = "TypeSafeError";
    this.kind = args.kind;
    this.httpStatus = args.httpStatus ?? null;
    this.latencyMs = args.latencyMs ?? 0;
    this.responseBody = args.responseBody ?? null;
  }
}

// Mapeia pro status canônico de ai_calls (espelha aiCallStatusEnum).
export function typeSafeErrorToAiCallStatus(
  kind: TypeSafeErrorKind
): Exclude<AiCallStatus, "ok" | "tool_missing" | "fidelity_divergence"> {
  switch (kind) {
    case "rate_limited":
      return "rate_limited";
    case "timeout":
      return "timeout";
    case "bad_response":
      return "invalid_output";
    case "auth":
    case "provider_error":
      return "provider_error";
  }
}
