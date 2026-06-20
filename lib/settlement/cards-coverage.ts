import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

// Gate de COBERTURA por liga da liquidação de cartões (#394, ADR 0033). Espelha o
// fail-closed de COVERED_LEAGUES_BY_MARKET (market-catalog.ts): só ligas com fonte web
// EMPIRICAMENTE provada (taxa de A≡B, alucinação, cobertura de ≥2 origens) entram aqui.
//
// VAZIO de propósito = INÉRCIA TOTAL por construção: toda row de cartões falha o gate ⇒
// o fan-out web NÃO dispara pra liga nenhuma ⇒ zero gasto, zero badge. É o que mantém o
// tipo `cards` (settleable=true nas rows NOVAS) inerte SEM o dono precisar virar flag —
// ligar uma liga é decisão de ENGENHARIA após provar a fonte, não um gate manual (memória
// owner-no-manual-feature-gates). ORTOGONAL a deriveSettleable, que é league-BLIND (só vê
// `type`); a cobertura é o eixo-liga, e vive no ORQUESTRADOR (gate ANTES da chamada paga),
// nunca em settleable.ts.
export const CARDS_COVERED_LEAGUES = new Set<SupportedLeague>([]);

export function isCardsCovered(league: SupportedLeague): boolean {
  return CARDS_COVERED_LEAGUES.has(league);
}
