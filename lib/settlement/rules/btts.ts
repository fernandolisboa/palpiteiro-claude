import type { SettlementRule } from "@/lib/settlement/registry";
import { SettlementError } from "@/lib/settlement/schemas";

/**
 * Regra pura de BTTS (ambos marcam). Lê o placar de 90' (homeScore/awayScore):
 *   - both = homeScore > 0 && awayScore > 0  (os DOIS times marcaram)
 *   - seleção 'yes' vence (`won`) sse `both`; 'no' vence sse `!both`.
 * SEM push (btts não tem reembolso).
 *
 * BTTS NÃO pode liquidar por `totalGoals` (o escalar não distingue 2-0 de 1-1):
 * exige o split. Null-split (rows de histórico onde o split de 90' não é
 * confiável) → SettlementError: deixa pending, NUNCA settle errado (precedente
 * "prefer skip over silent wrong settle"). Ao vivo o resultDataFromRegulationScore
 * sempre popula o split, então BTTS ao vivo sempre liquida.
 *
 * `_marketParams` é ignorado: btts não carrega linha (params null no descriptor).
 */
export const bttsRule: SettlementRule = (selection, _marketParams, resultData) => {
  const { homeScore, awayScore } = resultData;
  if (homeScore === null || awayScore === null) {
    throw new SettlementError(
      "btts needs a 90' score split; null score cannot settle",
      { homeScore, awayScore },
    );
  }
  const both = homeScore > 0 && awayScore > 0;
  const won = selection === "yes" ? both : !both;
  return won ? "won" : "lost";
};
