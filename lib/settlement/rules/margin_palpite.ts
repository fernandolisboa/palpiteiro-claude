import { z } from "zod";

import type { PalpiteResultData } from "@/db/schema";
import { SettlementError } from "@/lib/settlement/schemas";

// Margem de vitória de PALPITE (#354): "o lado `side` ganha por `minMargin`+".
// `minMargin` >= 1 (a regra aceita qualquer margem; o FLOOR >= 2 é gate de EMISSÃO em
// geração, não aqui). Liquida só do regulationScore (90'). Validado por Zod como
// defense-in-depth (a geração já escreve o shape certo).
export const MarginParamsSchema = z.object({
  side: z.enum(["home", "away"]),
  minMargin: z.number().int().min(1),
});

/**
 * Regra pura de margem. "won" sse o lado `side` venceu por `>= minMargin` no placar de
 * 90', senão "lost". Lança SettlementError em params inválidos ou split de 90' null
 * (prefer-skip → o orquestrador bucketa em errors → PENDING). NUNCA registrada no
 * registry de valor (palpite tem caminho próprio, ADR 0028).
 */
export function settleMarginPalpite(
  params: unknown,
  resultData: PalpiteResultData,
): "won" | "lost" {
  const parsed = MarginParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new SettlementError("invalid margin palpite params", {
      issues: parsed.error.issues,
    });
  }
  if (resultData.homeScore === null || resultData.awayScore === null) {
    throw new SettlementError("missing 90' split for margin palpite");
  }
  const { side, minMargin } = parsed.data;
  const diff =
    side === "home"
      ? resultData.homeScore - resultData.awayScore
      : resultData.awayScore - resultData.homeScore;
  return diff >= minMargin ? "won" : "lost";
}
