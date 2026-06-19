import { aiCalls } from "@/db/schema";
import { db } from "@/lib/db";

import { calculateCost } from "./cost";
import type { AIModelId, AIProviderKey } from "./models";
import type { AiCallStatus } from "./providers/types";

// Logging compartilhado de `ai_calls` (extraído de predict.ts, #315). Genérico —
// ZERO contexto de mercado: tanto `predict()` (recomendações de valor) quanto
// `generatePalpites()` (palpites de engajamento) logam a MESMA tabela de auditoria
// por aqui. `AiCallStatus` é a definição CANÔNICA de `./providers/types` (ADR 0027,
// espelha `aiCallStatusEnum`); este módulo NUNCA o redefine — só o importa e reexporta
// pra os callers manterem um único import-site. Grafo acíclico: logging → types.
export type { AiCallStatus };

const ERROR_MESSAGE_MAX = 2000;

// Trunca prosa pra um teto seguro: o ai_calls.errorMessage é text, mas o issues do
// Zod pode ser enorme. Compartilhado com o write path de palpites (text > 280 →
// truncar, não rejeitar) — uma única fonte da verdade.
export function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

// Persiste UMA row de erro em `ai_calls` (status != "ok"). O SWALLOW é LOAD-BEARING:
// isto loga um erro que JÁ aconteceu, então a própria falha do insert NUNCA pode
// mascarar o erro primário com um "Failed query: insert into ai_calls" cru — por isso
// try/catch → console.error, NUNCA re-throw. Assinatura idêntica à privada original de
// predict.ts (byte-compatível).
export async function persistAiCallError(args: {
  provider: AIProviderKey;
  userId: string;
  matchId: string;
  model: AIModelId;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: AiCallStatus;
  errorMessage: string;
  promptVersion: string;
}): Promise<void> {
  const cost = calculateCost({
    model: args.model,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
  });
  // This logs an error that ALREADY happened, so its own failure must not mask
  // the primary error by throwing a raw "Failed query: insert into ai_calls".
  // Swallow + log so the original error surfaces to the caller.
  try {
    await db.insert(aiCalls).values({
      userId: args.userId,
      matchId: args.matchId,
      provider: args.provider,
      model: args.model,
      promptVersion: args.promptVersion,
      inputPayload: args.inputPayload,
      outputPayload: args.outputPayload,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      latencyMs: args.latencyMs,
      costUsd: cost.toFixed(6),
      status: args.status,
      errorMessage: truncate(args.errorMessage, ERROR_MESSAGE_MAX),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "persistAiCallError",
        matchId: args.matchId,
        error: "ai_call_audit_insert_failed",
        originalStatus: args.status,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
