import type { OutcomeResult, SettlementOutcome } from "@/lib/settlement/schemas";

// Toda a matemática de profit do settlement vive AQUI (ADR D1), em UM lugar, pra
// não divergir entre o cron e o override. round2 é cópia VERBATIM de
// compute.ts:25-27 (com `+ Number.EPSILON`) — NÃO usar a variante de kpis.ts (sem
// epsilon): re-settlar histórico over/under tem que dar byte-idêntico (I1).
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Profit em units pro resultado de uma REGRA (SettlementOutcome). won/lost são o
 * caso pleno; half_win/half_loss existem pra forward-proof de handicap asiático
 * (ADR 0016 D4) e hoje têm ZERO callers (nenhuma regra do MVP os emite); push
 * devolve o stake → profit 0.
 */
export function profitForOutcome(
  outcome: SettlementOutcome,
  odd: number,
  stake: number,
): number {
  switch (outcome) {
    case "won":
      return round2(stake * (odd - 1));
    case "lost":
      return round2(-stake);
    case "push":
      return 0;
    case "half_win":
      return round2(0.5 * stake * (odd - 1));
    case "half_loss":
      return round2(-0.5 * stake);
  }
}

/**
 * Colapsa o resultado largo de uma regra no enum PERSISTIDO. half_win→won,
 * half_loss→lost; o resto é identidade. Garante que o registry nunca alarga o
 * enum gravado em prediction_outcomes.result (I3).
 */
export function persistedResult(outcome: SettlementOutcome): OutcomeResult {
  if (outcome === "half_win") return "won";
  if (outcome === "half_loss") return "lost";
  return outcome;
}

/**
 * Profit pra um resultado escolhido EXPLICITAMENTE — usado pelo override manual,
 * onde o admin seta won/lost/void direto. Retorna null quando won/lost é pedido
 * sem odd de entrada pra precificar (ex.: um `pass`): o caller deve rejeitar em
 * vez de chutar. O branch `push` é inalcançável em #166 — push só vira
 * selecionável no override em #168 (VALID_RESULTS o barra hoje); coberto por
 * money.test mesmo assim.
 */
export function profitForResult(
  result: OutcomeResult,
  odd: number | null,
  stake: number,
): number | null {
  if (result === "void" || result === "push") return 0;
  if (odd === null) return null;
  return result === "won" ? round2(stake * (odd - 1)) : round2(-stake);
}
