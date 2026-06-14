import type { SettlementRule } from "@/lib/settlement/registry";
import { SettlementError } from "@/lib/settlement/schemas";

/**
 * Regra pura de 1X2 (match_result). Lê o placar de 90' (homeScore/awayScore) e
 * decide o resultado do jogo:
 *   - h > a → 'home'  (mandante venceu)
 *   - h < a → 'away'  (visitante venceu)
 *   - h === a → 'draw' (empate)
 * A seleção apostada vence (`won`) sse casa com o resultado; senão perde. SEM
 * push (1X2 não tem reembolso).
 *
 * Null-split (homeScore/awayScore degradam a null em rows de histórico onde o
 * split de 90' não é confiável) → SettlementError: deixa pending, NUNCA settle
 * errado (precedente "prefer skip over silent wrong settle"). Ao vivo o
 * resultDataFromRegulationScore sempre popula o split, então 1X2 ao vivo sempre
 * liquida; só linhas degradadas de histórico ficam pending.
 *
 * `_marketParams` é ignorado: 1X2 não carrega linha (params null no descriptor).
 */
export const matchResultRule: SettlementRule = (
  selection,
  _marketParams,
  resultData,
) => {
  const { homeScore, awayScore } = resultData;
  if (homeScore === null || awayScore === null) {
    throw new SettlementError(
      "match_result needs a 90' score split; null score cannot settle",
      { homeScore, awayScore },
    );
  }
  const resultado =
    homeScore > awayScore ? "home" : homeScore < awayScore ? "away" : "draw";
  return selection === resultado ? "won" : "lost";
};
