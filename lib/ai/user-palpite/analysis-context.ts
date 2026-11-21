import type { TeamNames } from "@/lib/user-palpite/reading";

import { extractPalpiteClaims, reuseExtraction, type ExtractResult } from "./extract";

// Contexto extra da análise com IA (#565): a mesma extração Haiku do "Seu palpite"
// (USER_PALPITE_EXTRACT_VERSION, pelo seam AIProvider, logada em ai_calls), disparada pela
// action logo antes do fan-out. Corre em paralelo com o JEV; o predict só a espera
// depois dele. O texto cru só vai à extração: aqui nada o loga nem o guarda.
//
// Mesmo texto da mesma pessoa no mesmo jogo (#668: o campo fica preenchido e o
// "Analisar de novo" o manda outra vez) → reaproveita a última extração ok, relida do
// ai_calls. A Haiku não é determinística: duas leituras do mesmo texto podiam mexer em
// fatores diferentes e trocar o palpite.

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
  const extractArgs = {
    reason: args.text,
    teams: args.teams,
    matchId: args.matchId,
    userId: args.userId,
    deadlineAt,
    subject: "contexto" as const,
  };
  const extraction = reuseExtraction(extractArgs)
    .then((reused) => reused ?? extractPalpiteClaims(extractArgs))
    .catch(
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
          outcome:
            result === null
              ? "timeout"
              : !result.ok
                ? "failed"
                : result.reused
                  ? "reused"
                  : "ok",
          claims: result?.ok ? result.claims.length : 0,
          latencyMs: Date.now() - startedAt,
        }),
      );
      return result;
    });
}
