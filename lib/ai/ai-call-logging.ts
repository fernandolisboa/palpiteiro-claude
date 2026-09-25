import { aiCalls } from "@/db/schema";
import { db } from "@/lib/db";

import { calculateCost } from "./cost";
import {
  JUDGMENT_PROVIDER_KEY,
  type AIModelId,
  type AIProviderKey,
} from "./models";
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

// Loga UMA chamada de julgamentos JEV (ADR 0041 §5) em `ai_calls`, sucesso OU falha:
// provider 'typesafe', output 0 (grátis), custo já calculado pelo chamador
// (calculateJudgmentCost). Mesmo SWALLOW do persistAiCallError: o JEV é fail-open, e
// um insert de auditoria que falha nunca pode derrubar a análise.
export async function persistJudgmentAiCall(args: {
  userId: string;
  matchId: string;
  model: string;
  promptVersion: string;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  inputTokens: number;
  latencyMs: number;
  costUsd: number;
  status: AiCallStatus;
  errorMessage: string | null;
}): Promise<string | null> {
  try {
    const [row] = await db
      .insert(aiCalls)
      .values({
        userId: args.userId,
        matchId: args.matchId,
        provider: JUDGMENT_PROVIDER_KEY,
        model: args.model,
        promptVersion: args.promptVersion,
        inputPayload: args.inputPayload,
        outputPayload: args.outputPayload,
        inputTokens: args.inputTokens,
        outputTokens: 0,
        latencyMs: Math.round(args.latencyMs),
        costUsd: args.costUsd.toFixed(6),
        status: args.status,
        errorMessage:
          args.errorMessage === null
            ? null
            : truncate(args.errorMessage, ERROR_MESSAGE_MAX),
      })
      .returning({ id: aiCalls.id });
    return row?.id ?? null;
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "persistJudgmentAiCall",
        matchId: args.matchId,
        error: "ai_call_audit_insert_failed",
        status: args.status,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return null;
  }
}
