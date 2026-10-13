import type { TeamNames } from "@/lib/user-palpite/reading";

import { extractPalpiteClaims, type ExtractResult } from "./extract";

// Contexto extra da análise com IA (#565): a mesma extração Haiku do "Seu palpite"
// (user_palpite_extract_v1, pelo seam AIProvider, logada em ai_calls), disparada pela
// action logo antes do fan-out. Corre em paralelo com o JEV; o predict só a espera
// depois dele. O texto cru só vai à extração: aqui nada o loga nem o guarda.

// Teto da extração: um contexto lento nunca come o prazo do narrador.
export const CONTEXT_EXTRACT_CAP_MS = 10_000;

/**
 * Nunca rejeita: falha (extractPalpiteClaims já devolve ok:false) ou teto estourado
 * (null) viram "análise sem contexto" no predict.
 */
export function startAnalysisContextExtraction(args: {
  text: string;
  teams: TeamNames;
  matchId: string;
  userId: string;
  // Prazo do fan-out (lib/ai/deadline.ts): a extração nunca passa dele.
  fanOutDeadline: number;
}): Promise<ExtractResult | null> {
  const startedAt = Date.now();
  const deadlineAt = Math.min(args.fanOutDeadline, startedAt + CONTEXT_EXTRACT_CAP_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, deadlineAt - startedAt));
  });
  const extraction = extractPalpiteClaims({
    reason: args.text,
    teams: args.teams,
    matchId: args.matchId,
    userId: args.userId,
    deadlineAt,
    subject: "contexto",
  }).catch(
    (err: unknown): ExtractResult => ({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      aiCallId: null,
    }),
  );
  return Promise.race([extraction, cap])
    .finally(() => clearTimeout(timer))
    .then((result) => {
      console.info(
        JSON.stringify({
          scope: "analyzeBestBet",
          event: "user_context",
          matchId: args.matchId,
          outcome: result === null ? "timeout" : result.ok ? "ok" : "failed",
          claims: result?.ok ? result.claims.length : 0,
          latencyMs: Date.now() - startedAt,
        }),
      );
      return result;
    });
}
