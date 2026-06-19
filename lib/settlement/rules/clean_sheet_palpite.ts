import { z } from "zod";

import type { PalpiteResultData } from "@/db/schema";
import { SettlementError } from "@/lib/settlement/schemas";

// Clean sheet de PALPITE (#354): "o lado `side` NÃO sofre gol" — i.e. o ADVERSÁRIO
// marca 0 no placar de 90'. side="home" → awayScore === 0. Liquida só do regulationScore.
const CleanSheetParamsSchema = z.object({
  side: z.enum(["home", "away"]),
});

/**
 * Regra pura de clean sheet. "won" sse o adversário do `side` marcou 0 no placar de
 * 90', senão "lost". Lança SettlementError em params inválidos ou split de 90' null
 * (prefer-skip → PENDING).
 */
export function settleCleanSheetPalpite(
  params: unknown,
  resultData: PalpiteResultData,
): "won" | "lost" {
  const parsed = CleanSheetParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new SettlementError("invalid clean_sheet palpite params", {
      issues: parsed.error.issues,
    });
  }
  if (resultData.homeScore === null || resultData.awayScore === null) {
    throw new SettlementError("missing 90' split for clean_sheet palpite");
  }
  // side="home" mantém clean sheet sse o VISITANTE (adversário) marcou 0, e vice-versa.
  const opponentScore =
    parsed.data.side === "home" ? resultData.awayScore : resultData.homeScore;
  return opponentScore === 0 ? "won" : "lost";
}
