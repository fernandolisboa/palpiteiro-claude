// Timeouts e retries das chamadas ao Claude (#524, review). Puro (sem SDK): o
// client, o adapter e os scripts leem daqui, e os testes calculam sem mock.

import type { Effort } from "@/lib/ai/generation-params";
import { REQUEST_SAFETY_MARGIN_MS } from "@/lib/ai/deadline";
import type { AIModel } from "@/lib/ai/models";

// Opções do client (valem pra toda chamada que não passa opções próprias): 60s foi
// dimensionado pros modelos temperature (Sonnet 4.5 / Haiku, sem thinking).
export const CLIENT_TIMEOUT_MS = 60_000;
export const CLIENT_MAX_RETRIES = 2;

// Estimativa do tempo de uma chamada ADAPTIVE não-streaming. O thinking conta dentro
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
  // Sem effort explícito o servidor usa o default do modelo (medium no Opus 5.5,
  // high nos outros): assume high, o maior dos dois.
  const share = EFFORT_TOKEN_SHARE[effort ?? "high"];
  const estimate =
    ADAPTIVE_BASE_LATENCY_MS +
    ((maxTokens * share) / ADAPTIVE_TOKENS_PER_SEC) * 1000;
  return Math.round(
    Math.min(ADAPTIVE_TIMEOUT_MAX_MS, Math.max(ADAPTIVE_TIMEOUT_MIN_MS, estimate)),
  );
}

export type RequestTiming =
  // Sem opções por request: usa as do client (temperature sem prazo — o caminho de
  // sempre, chamada com 1 argumento).
  | { kind: "client-default" }
  | { kind: "options"; options: { timeout: number; maxRetries: number } }
  // O prazo não comporta nem a margem de segurança: não chamar (sem gasto).
  | { kind: "no-budget" };

/**
 * Timeout + retries de UMA chamada. `timeout` = o do modelo (adaptive: escalado por
 * max_tokens/effort; temperature: o do client), cortado pelo que resta do prazo
 * menos a margem. `maxRetries` só conta retries que ainda cabem inteiros no prazo
 * (o SDK re-tenta timeout/429/5xx, e cada tentativa pode esgotar o timeout):
 * `(retries + 1) × timeout ≤ restante`. Sem prazo: adaptive leva só o timeout
 * escalado (retries do client); temperature fica com as opções do client.
 */
export function requestTiming(args: {
  thinkingMode: AIModel["thinkingMode"];
  maxTokens: number;
  effort?: Effort;
  deadlineAt?: number;
  now?: number;
}): RequestTiming {
  const base =
    args.thinkingMode === "adaptive"
      ? adaptiveTimeoutMs(args.maxTokens, args.effort)
      : CLIENT_TIMEOUT_MS;
  if (args.deadlineAt === undefined) {
    return args.thinkingMode === "adaptive"
      ? {
          kind: "options",
          options: { timeout: base, maxRetries: CLIENT_MAX_RETRIES },
        }
      : { kind: "client-default" };
  }
  const available =
    args.deadlineAt - (args.now ?? Date.now()) - REQUEST_SAFETY_MARGIN_MS;
  if (available <= 0) return { kind: "no-budget" };
  const timeout = Math.min(base, available);
  const maxRetries = Math.max(
    0,
    Math.min(CLIENT_MAX_RETRIES, Math.floor(available / timeout) - 1),
  );
  return { kind: "options", options: { timeout, maxRetries } };
}
