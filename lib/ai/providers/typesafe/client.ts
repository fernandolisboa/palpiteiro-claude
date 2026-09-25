import { z } from "zod";

import { JUDGMENT_MODEL_ID } from "@/lib/ai/models";

import { TypeSafeError } from "./errors";

// Cliente HTTP mínimo da TypeSafe (ADR 0041 §5). ÚNICO módulo que fala com
// api.typesafe.ai. fetch direto, sem SDK (zero dependência nova). Só expõe o
// primitivo `noul` — o único que o jev_judgments_v1 usa.
// Contrato: https://docs.typesafe.ai/api.md (lido em 2026-09-24).

export const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
// O JEV responde em ~100 ms; 3 s é o teto do fail-open (ADR 0041 §3).
export const TYPESAFE_TIMEOUT_MS = 3_000;

// `instructions`/`criteria` aceitam string, objeto ou array na API.
export type TypeSafeText = string | Record<string, unknown> | unknown[];

export type TypeSafeNoulQuestion = {
  type: "noul";
  instructions: TypeSafeText;
  criteria?: { true?: TypeSafeText; false?: TypeSafeText };
};

export type TypeSafeRequestBody = {
  model: string;
  state: string | Record<string, unknown> | unknown[];
  questions: Record<string, TypeSafeNoulQuestion>;
};

// A doc diz que Noul NÃO traz `confidence` (só Choice/Score). Aceito opcional
// pra não quebrar se a API passar a enviar.
const NoulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1).optional(),
});

const SystemOneResponseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), NoulAnswerSchema),
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

export type TypeSafeNoulAnswer = z.infer<typeof NoulAnswerSchema>;
export type TypeSafeSystemOneResponse = z.infer<typeof SystemOneResponseSchema>;

export type TypeSafeCallResult = {
  response: TypeSafeSystemOneResponse;
  requestBody: TypeSafeRequestBody;
  // JSON cru como veio (verbatim pro ai_calls.outputPayload).
  rawResponse: unknown;
  latencyMs: number;
};

export function hasTypeSafeKey(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

function classifyHttpError(
  status: number,
  body: unknown,
  latencyMs: number,
  requestPayload: TypeSafeRequestBody
): TypeSafeError {
  if (status === 401 || status === 403) {
    return new TypeSafeError({
      kind: "auth",
      message: `TypeSafe ${status}: chave ausente ou inválida`,
      httpStatus: status,
      latencyMs,
      responseBody: body,
      requestPayload,
    });
  }
  if (status === 429) {
    return new TypeSafeError({
      kind: "rate_limited",
      message: "TypeSafe 429: rate limit excedido",
      httpStatus: status,
      latencyMs,
      responseBody: body,
      requestPayload,
    });
  }
  return new TypeSafeError({
    kind: "provider_error",
    message: `TypeSafe ${status}`,
    httpStatus: status,
    latencyMs,
    responseBody: body,
    requestPayload,
  });
}

async function readJsonOrText(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

// `res.text()` nem sempre respeita o signal do fetch (um Response que não veio
// do fetch nativo, ou um runtime que não liga o corpo ao signal). Corro a
// leitura contra o abort pra que um corpo que nunca fecha também vire timeout.
async function readBodyWithin(
  res: Response,
  signal: AbortSignal
): Promise<unknown> {
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      res.body?.cancel().catch(() => undefined);
      reject(new DOMException("TypeSafe body read aborted", "AbortError"));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([readJsonOrText(res), aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

// Best-effort: um 2xx fora do schema ainda foi cobrado. Se o JSON cru trouxer
// `usage.input_tokens` válido, uso pro custo no ai_calls; senão null.
function readInputTokens(body: unknown): number | null {
  if (typeof body !== "object" || body === null || !("usage" in body)) {
    return null;
  }
  const { usage } = body;
  if (typeof usage !== "object" || usage === null) return null;
  if (!("input_tokens" in usage)) return null;
  const tokens = usage.input_tokens;
  return typeof tokens === "number" && Number.isInteger(tokens) && tokens >= 0
    ? tokens
    : null;
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

export async function callSystemOne(args: {
  state: TypeSafeRequestBody["state"];
  questions: Record<string, TypeSafeNoulQuestion>;
  model?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<TypeSafeCallResult> {
  const apiKey = args.apiKey ?? process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    throw new TypeSafeError({
      kind: "auth",
      message: "TYPESAFE_API_KEY is not set",
    });
  }
  const requestBody: TypeSafeRequestBody = {
    model: args.model ?? JUDGMENT_MODEL_ID,
    state: args.state,
    questions: args.questions,
  };
  const fetchImpl = args.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    args.timeoutMs ?? TYPESAFE_TIMEOUT_MS
  );
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  let status: number;
  let body: unknown;
  try {
    const res = await fetchImpl(TYPESAFE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    status = res.status;
    // Lido DENTRO do timeout: um corpo que trava também é timeout.
    body = await readBodyWithin(res, controller.signal);
  } catch (err) {
    if (isAbortError(err) || controller.signal.aborted) {
      throw new TypeSafeError({
        kind: "timeout",
        message: `TypeSafe timeout após ${args.timeoutMs ?? TYPESAFE_TIMEOUT_MS} ms`,
        latencyMs: elapsed(),
        requestPayload: requestBody,
        cause: err,
      });
    }
    throw new TypeSafeError({
      kind: "provider_error",
      message: `TypeSafe network error: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: elapsed(),
      requestPayload: requestBody,
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = elapsed();
  if (status < 200 || status >= 300) {
    throw classifyHttpError(status, body, latencyMs, requestBody);
  }

  const parsed = SystemOneResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new TypeSafeError({
      kind: "bad_response",
      message: `TypeSafe resposta fora do schema: ${parsed.error.message}`,
      httpStatus: status,
      latencyMs,
      responseBody: body,
      requestPayload: requestBody,
      inputTokens: readInputTokens(body),
    });
  }
  const missing = Object.keys(args.questions).filter(
    (id) => !(id in parsed.data.answers)
  );
  if (missing.length > 0) {
    throw new TypeSafeError({
      kind: "bad_response",
      message: `TypeSafe resposta sem answer para: ${missing.join(", ")}`,
      httpStatus: status,
      latencyMs,
      responseBody: body,
      requestPayload: requestBody,
      inputTokens: parsed.data.usage.input_tokens,
    });
  }

  return { response: parsed.data, requestBody, rawResponse: body, latencyMs };
}
