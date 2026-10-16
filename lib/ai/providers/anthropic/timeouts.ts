// Timeouts e retries das chamadas ao Claude (#524, review). Puro (sem SDK): o
// client, o adapter e os scripts leem daqui, e os testes calculam sem mock.

import type { Effort } from "@/lib/ai/generation-params";

// Opções do client (valem pra chamada que não passa opções próprias, como a listagem
// de modelos). As chamadas de análise sempre passam as suas (requestTiming).
export const CLIENT_TIMEOUT_MS = 60_000;
export const CLIENT_MAX_RETRIES = 2;

// Folga entre o timeout da request e o prazo: o SDK ainda precisa devolver o erro e
// o predict ainda grava a row de ai_calls antes do prazo.
export const REQUEST_SAFETY_MARGIN_MS = 5_000;

// Espera do SDK entre tentativas: backoff exponencial com jitter, teto de 8s. Conta
// o teto por retry (não a média) pra um retry nunca estourar o prazo.
export const RETRY_BACKOFF_MS = 8_000;

// Estimativa do tempo de uma chamada não-streaming (todo modelo do registry é adaptive). O thinking conta dentro
// de max_tokens, e o effort decide quanto dele o modelo tende a usar. Vazão
// conservadora de 60 tok/s + 15s de latência fixa (fila + input). Ex.: max_tokens
// 16000 em effort high → 15s + 12000/60s = 215s. Piso de 60s (nunca abaixo do
// client) e teto de 600s (o limite do SDK pra não-streaming). É estimativa, não
// medida: o prazo do run (lib/ai/deadline.ts) sempre corta por cima.
const ADAPTIVE_TOKENS_PER_SEC = 60;
const ADAPTIVE_BASE_LATENCY_MS = 15_000;
const ADAPTIVE_TIMEOUT_MIN_MS = 60_000;
const ADAPTIVE_TIMEOUT_MAX_MS = 600_000;
const EFFORT_TOKEN_SHARE: Record<Effort, number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  xhigh: 1,
  max: 1,
};

export function adaptiveTimeoutMs(
  maxTokens: number,
  effort: Effort | undefined,
): number {
  // Sem effort explícito o servidor usa o default do modelo (medium no Opus e no
  // Haiku 5.5, high no Sonnet 5.5): assume high, o maior dos dois.
  const share = EFFORT_TOKEN_SHARE[effort ?? "high"];
  const estimate =
    ADAPTIVE_BASE_LATENCY_MS +
    ((maxTokens * share) / ADAPTIVE_TOKENS_PER_SEC) * 1000;
  return Math.round(
    Math.min(ADAPTIVE_TIMEOUT_MAX_MS, Math.max(ADAPTIVE_TIMEOUT_MIN_MS, estimate)),
  );
}

export type RequestTiming =
  | { kind: "options"; options: { timeout: number; maxRetries: number } }
  // O prazo não comporta nem a margem de segurança: não chamar (sem gasto).
  | { kind: "no-budget" };

/**
 * Timeout + retries de UMA chamada. `timeout` = o escalado por max_tokens/effort,
 * cortado pelo que resta do prazo
 * menos a margem. `maxRetries` só conta retries que ainda cabem inteiros no prazo
 * (o SDK re-tenta timeout/429/5xx, e cada tentativa pode esgotar o timeout), com o
 * backoff entre elas: `(retries + 1) × timeout + retries × backoff ≤ restante`.
 * Um `retry-after` do servidor maior que o backoff ainda pode passar disso — raro,
 * e a margem de segurança cobre parte. Sem prazo: leva só o timeout escalado
 * (retries do client).
 */
export function requestTiming(args: {
  maxTokens: number;
  effort?: Effort;
  deadlineAt?: number;
  now?: number;
}): RequestTiming {
  const base = adaptiveTimeoutMs(args.maxTokens, args.effort);
  if (args.deadlineAt === undefined) {
    return {
      kind: "options",
      options: { timeout: base, maxRetries: CLIENT_MAX_RETRIES },
    };
  }
  const available =
    args.deadlineAt - (args.now ?? Date.now()) - REQUEST_SAFETY_MARGIN_MS;
  if (available <= 0) return { kind: "no-budget" };
  const timeout = Math.min(base, available);
  let maxRetries = 0;
  while (
    maxRetries < CLIENT_MAX_RETRIES &&
    (maxRetries + 2) * timeout + (maxRetries + 1) * RETRY_BACKOFF_MS <= available
  ) {
    maxRetries++;
  }
  return { kind: "options", options: { timeout, maxRetries } };
}
