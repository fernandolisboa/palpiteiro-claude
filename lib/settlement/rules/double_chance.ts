import type { SettlementRule } from "@/lib/settlement/registry";
import { SettlementError } from "@/lib/settlement/schemas";

// Conjunto de resultados de 90' que cada dupla COBRE (1X/X2/12). A dupla vence
// (`won`) sse o resultado real do jogo está no conjunto; senão perde. SEM push
// (dupla chance não tem reembolso, como 1X2/btts).
const ALLOWED: Record<string, readonly ("home" | "draw" | "away")[]> = {
  home_or_draw: ["home", "draw"], // 1X
  away_or_draw: ["away", "draw"], // X2
  home_or_away: ["home", "away"], // 12
};

/**
 * Regra pura de dupla chance (double_chance). Lê o placar de 90'
 * (homeScore/awayScore), deriva o resultado UMA vez (h>a→home / h<a→away /
 * h===a→draw) e testa pertencimento ao conjunto coberto pela dupla apostada.
 *
 * Null-split (rows degradadas de histórico) → SettlementError: deixa pending,
 * NUNCA settle errado (precedente "prefer skip over silent wrong settle"). Ao
 * vivo o resultDataFromRegulationScore sempre popula o split.
 *
 * Seleção desconhecida → SettlementError (NÃO 'lost' como o match_result faz pra
 * não-correspondência): uma key fora de {home_or_draw,away_or_draw,home_or_away}
 * é bug de dado (jsonb/seed), não uma aposta perdida — deixa pending pra
 * inspeção. Inalcançável em prod (a selection vem do join de market_selections,
 * restrito às 3 keys seedadas).
 *
 * `_marketParams` é ignorado: dupla chance não carrega linha (params null).
 */
export const doubleChanceRule: SettlementRule = (
  selection,
  _marketParams,
  resultData,
) => {
  const { homeScore, awayScore } = resultData;
  if (homeScore === null || awayScore === null) {
    throw new SettlementError(
      "double_chance needs a 90' score split; null score cannot settle",
      { homeScore, awayScore },
    );
  }
  const allowed = ALLOWED[selection];
  if (!allowed) {
    throw new SettlementError(
      `unknown double_chance selection: ${selection}`,
      { selection },
    );
  }
  const resultado =
    homeScore > awayScore ? "home" : homeScore < awayScore ? "away" : "draw";
  return allowed.includes(resultado) ? "won" : "lost";
};
