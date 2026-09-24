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
  latencyMs: number
): TypeSafeError {
  if (status === 401 || status === 403) {
    return new TypeSafeError({
      kind: "auth",
      message: `TypeSafe ${status}: chave ausente ou inválida`,
      httpStatus: status,
      latencyMs,
      responseBody: body,
    });
  }
  if (status === 429) {
    return new TypeSafeError({
      kind: "rate_limited",
      message: "TypeSafe 429: rate limit excedido",
      httpStatus: status,
      latencyMs,
      responseBody: body,
    });
  }
  return new TypeSafeError({
    kind: "provider_error",
    message: `TypeSafe ${status}`,
    httpStatus: status,
    latencyMs,
    responseBody: body,
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
    body = await readJsonOrText(res);
  } catch (err) {
    if (isAbortError(err) || controller.signal.aborted) {
      throw new TypeSafeError({
        kind: "timeout",
        message: `TypeSafe timeout após ${args.timeoutMs ?? TYPESAFE_TIMEOUT_MS} ms`,
        latencyMs: elapsed(),
        cause: err,
      });
    }
    throw new TypeSafeError({
      kind: "provider_error",
      message: `TypeSafe network error: ${err instanceof Error ? err.message : String(err)}`,
      latencyMs: elapsed(),
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }

  const latencyMs = elapsed();
  if (status < 200 || status >= 300) {
    throw classifyHttpError(status, body, latencyMs);
  }

  const parsed = SystemOneResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new TypeSafeError({
      kind: "bad_response",
      message: `TypeSafe resposta fora do schema: ${parsed.error.message}`,
      httpStatus: status,
      latencyMs,
      responseBody: body,
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
    });
  }

  return { response: parsed.data, requestBody, rawResponse: body, latencyMs };
}
