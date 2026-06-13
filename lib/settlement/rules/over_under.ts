import { z } from "zod";

import type { SettlementRule } from "@/lib/settlement/registry";
import { SettlementError } from "@/lib/settlement/schemas";

// A linha vive em market_params (ex.: { line: 2.5 }) — NUNCA num sufixo de key.
// `.strict()` rejeita params com chaves extras (boundary de jsonb não confiável).
const ParamsSchema = z.object({ line: z.number().finite() }).strict();

/**
 * Regra pura de over/under. Lê SÓ `resultData.totalGoals` (I2 — homeScore/
 * awayScore degradam a null no histórico e nenhuma regra pode exigi-los).
 * Linha de meio-gol (2.5) com totais inteiros nunca empata, então push é
 * inalcançável aí; mas a regra cobre linhas inteiras (3.0 → 3 gols = push).
 */
export const overUnderRule: SettlementRule = (
  selection,
  rawParams,
  resultData,
) => {
  const parsed = ParamsSchema.safeParse(rawParams);
  if (!parsed.success) {
    throw new SettlementError("over_under params invalid", {
      issues: parsed.error.issues,
    });
  }
  const { line } = parsed.data;
  const total = resultData.totalGoals;
  if (total === line) return "push";
  const won = selection === "over" ? total > line : total < line;
  return won ? "won" : "lost";
};
