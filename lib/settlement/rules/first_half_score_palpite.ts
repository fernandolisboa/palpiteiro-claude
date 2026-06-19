import { z } from "zod";

import type { PalpiteResultData } from "@/db/schema";
import { SettlementError } from "@/lib/settlement/schemas";

// Placar do 1º tempo de PALPITE (#354): {home, away} (0–20). Liquida do split do
// intervalo (halftimeHomeScore/Away), NÃO do placar de 90'. Mesmo schema do exact_score.
const FirstHalfScoreParamsSchema = z.object({
  home: z.number().int().min(0).max(20),
  away: z.number().int().min(0).max(20),
});

/**
 * Regra pura de placar do 1º tempo. "won" sse o placar palpitado == o split do
 * intervalo, senão "lost". Se o split do intervalo for undefined/null (provider não
 * entregou o halftime) → lança SettlementError → PENDING (prefer-skip — NUNCA fabrica
 * loss por falta do split).
 */
export function settleFirstHalfScorePalpite(
  params: unknown,
  resultData: PalpiteResultData,
): "won" | "lost" {
  const parsed = FirstHalfScoreParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new SettlementError("invalid first_half_score palpite params", {
      issues: parsed.error.issues,
    });
  }
  const { halftimeHomeScore, halftimeAwayScore } = resultData;
  if (
    halftimeHomeScore === undefined ||
    halftimeHomeScore === null ||
    halftimeAwayScore === undefined ||
    halftimeAwayScore === null
  ) {
    throw new SettlementError(
      "missing halftime split for first_half_score palpite → leave pending",
      { halftimeHomeScore, halftimeAwayScore },
    );
  }
  return parsed.data.home === halftimeHomeScore &&
    parsed.data.away === halftimeAwayScore
    ? "won"
    : "lost";
}
