import { z } from "zod";

import type { PalpiteResultData } from "@/db/schema";
import { SettlementError } from "@/lib/settlement/schemas";

// Cartões de PALPITE (#419 emite a linha fun-only; #394 a liquida): total de AMARELOS
// do jogo `>= line`, com line ∈ {4, 6} (as rungs FIXAS do projeto CARDS_LINE,
// settleable-rows.ts) e scope "total". `line` é pinada aos literais 4|6 — uma params
// corrompida (ex.: {line:5} ou {scope:"partial"}) lança → PENDENTE, nunca liquida contra
// uma linha sem sentido.
const CardsParamsSchema = z.object({
  line: z.union([z.literal(4), z.literal(6)]),
  scope: z.literal("total"),
});

/**
 * Regra pura de cartões. Espelha a SPINE skip-over-wrong-settle de
 * first_to_score_palpite.ts: lê SÓ `resultData.yellowCardsTotal` e compara `>= line`.
 * `yellowCardsTotal === undefined` (extração web não reconciliou A≡B, liga não-coberta,
 * sem chave, ou contagem ambígua) → lança SettlementError → PENDENTE (NUNCA fabrica um
 * número plausível). TODA a orquestração de A≡B / decorrelação / origens / attempt-cap
 * vive FORA daqui (settle-palpites.ts + extract-cards-from-web.ts) — esta regra é pura,
 * sem I/O, mesma fronteira de first_to_score.
 */
export function settleCardsPalpite(
  params: unknown,
  resultData: PalpiteResultData,
): "won" | "lost" {
  const parsed = CardsParamsSchema.safeParse(params);
  if (!parsed.success) {
    throw new SettlementError("invalid cards palpite params", {
      issues: parsed.error.issues,
    });
  }
  if (resultData.yellowCardsTotal === undefined) {
    throw new SettlementError(
      "cards settlement needs yellowCardsTotal → leave pending",
    );
  }
  return resultData.yellowCardsTotal >= parsed.data.line ? "won" : "lost";
}
