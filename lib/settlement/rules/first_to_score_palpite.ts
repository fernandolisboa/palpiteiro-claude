import { z } from "zod";

import type { PalpiteResultData } from "@/db/schema";
import { SettlementError } from "@/lib/settlement/schemas";

// Primeiro a marcar de PALPITE (#354): {firstToScore: "home"|"away"|"none"}.
// "none" = previsão de 0-0 (ninguém marca). Liquida dos eventos de gol de regulação
// (derivados no builder palpite-result-data.ts), NÃO do placar puro.
const FirstToScoreParamsSchema = z.object({
  firstToScore: z.enum(["home", "away", "none"]),
});

/**
 * Regra pura de primeiro a marcar. Espelha a SPINE skip-over-wrong-settle de scorer.ts:
 * se eventsAvailable !== true OU resultData.firstToScore for undefined (ambíguo:
 * primeiro-gol-é-OG / minuto null / empate de minuto / feed incompleto) → lança
 * SettlementError → PENDING (NUNCA fabrica o lado errado). Com o dado derivado: "won"
 * sse o palpite == o derivado, senão "lost".
 */
export function settleFirstToScorePalpite(
  params: unknown,
  resultData: PalpiteResultData,
): "won" | "lost" {
  const parsed = FirstToScoreParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new SettlementError("invalid first_to_score palpite params", {
      issues: parsed.error.issues,
    });
  }
  if (resultData.eventsAvailable !== true) {
    throw new SettlementError(
      "first_to_score settlement needs eventsAvailable=true → leave pending",
      { eventsAvailable: resultData.eventsAvailable },
    );
  }
  if (resultData.firstToScore === undefined) {
    throw new SettlementError(
      "first_to_score is ambiguous (own-goal-first / null minute / minute tie / incomplete feed) → leave pending",
    );
  }
  return parsed.data.firstToScore === resultData.firstToScore ? "won" : "lost";
}
