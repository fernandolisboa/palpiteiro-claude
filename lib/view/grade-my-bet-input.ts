// Parse PT-BR de odd, compartilhado pelo parse de aposta (lib/ai/bet-parse) e pelo
// registro de apostas (lib/bets/slip-schema). O schema do antigo "Avaliar valor"
// (ADR 0034) saiu com o GradeMyBet (#556, ADR 0053).

/**
 * Parse PT-BR de odd decimal: vírgula → ponto ANTES do parse ('1,85' → 1.85).
 * O repo NÃO tinha parse PT-BR (grep confirmou) — é net-new. Number.parseFloat
 * tolera lixo à direita ('1,85x' → 1.85), mas o `.pipe(z.number().finite().gt(1))`
 * rejeita NaN/≤1 logo em seguida, então a fronteira fica fail-closed.
 */
export function parsePtBrOdd(raw: string): number {
  return Number.parseFloat(raw.replace(",", "."));
}
