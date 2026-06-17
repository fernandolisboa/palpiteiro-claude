import type { SettlementRule } from "@/lib/settlement/registry";
import { SettlementError } from "@/lib/settlement/schemas";

// Parse defensivo de uma chave de seleção cs_H_A → { home, away }. Retorna null
// em qualquer chave fora do formato (não acontece pra rows reais, que vêm do seed,
// mas mantém a regra total e segura).
function parseCorrectScoreKey(
  selection: string,
): { home: number; away: number } | null {
  const m = selection.match(/^cs_(\d+)_(\d+)$/);
  if (!m) return null;
  return { home: Number(m[1]), away: Number(m[2]) };
}

/**
 * Regra pura de placar exato (correct_score). Lê o placar de 90'
 * (homeScore/awayScore) e decide: a célula apostada (cs_H_A) vence (`won`) SSE o
 * placar real casa exatamente; senão perde (`lost`). SEM push (correct score não
 * tem reembolso).
 *
 * Null-split (homeScore/awayScore degradam a null em rows de histórico onde o
 * split de 90' não é confiável) → SettlementError: deixa pending, NUNCA settle
 * errado (precedente "prefer skip over silent wrong settle").
 *
 * Placar real FORA do grid 0..3 (ex.: 4-0, 5-2): a célula in-grid prevista
 * objetivamente NÃO ocorreu → `lost` (NÃO throw — senão um 4-0 legítimo ficaria
 * pending pra sempre). O grid é limitado por design (ADR 0025); um placar > 3
 * gols simplesmente não está entre as 16 células e portanto a aposta perde.
 *
 * `_marketParams` é ignorado: correct_score não carrega linha (params null no
 * descriptor).
 */
export const correctScoreRule: SettlementRule = (
  selection,
  _marketParams,
  resultData,
) => {
  const { homeScore, awayScore } = resultData;
  if (homeScore === null || awayScore === null) {
    throw new SettlementError(
      "correct_score needs a 90' score split; null score cannot settle",
      { homeScore, awayScore },
    );
  }
  const cell = parseCorrectScoreKey(selection);
  if (!cell) {
    throw new SettlementError(
      "correct_score selection is not a valid cs_H_A cell",
      { selection },
    );
  }
  // Placar real fora do grid 0..3 → a célula prevista não ocorreu (perde, não throw).
  if (homeScore > 3 || awayScore > 3) {
    return "lost";
  }
  return cell.home === homeScore && cell.away === awayScore ? "won" : "lost";
};
