// Mercados que o harness de calibração mede (#453, Report 03 rec. 3): os de partição
// do MVP (Tier 1 + Tier 2), que persistem P(seleção) do modelo em
// prediction_selection_odds e liquidam por placar de 90'. correct_score e os
// independent_binary (artilheiro/assistência) ficam de fora: sem partição de-vigável
// ou com amostra rala demais pra reliability fazer sentido.
export const CALIBRATED_MARKETS = [
  "over_under",
  "match_result",
  "btts",
  "double_chance",
] as const;

export type CalibratedMarketKey = (typeof CALIBRATED_MARKETS)[number];

export const CALIBRATED_MARKET_LABEL: Record<CalibratedMarketKey, string> = {
  over_under: "over/under",
  match_result: "1X2",
  btts: "ambos marcam",
  double_chance: "dupla chance",
};

// Como cada predição vira pares (p, y):
//  - binário (over/under, btts): UM par, na seleção "positiva". O outro lado é o
//    espelho (1−p, 1−y) — mesmo Brier e log-loss, e duplicar só dobraria o n e
//    espelharia os bins. over/under segue byte-idêntico ao harness original.
//  - N-ário (1X2, dupla chance): um par POR seleção (um-contra-o-resto), agrupados.
//    Na dupla chance 2 das 3 seleções acontecem por jogo (Σ=2), o que o um-contra-o-
//    resto absorve sem caso especial.
export const POSITIVE_SELECTION: Record<CalibratedMarketKey, string | null> = {
  over_under: "over",
  btts: "yes",
  match_result: null,
  double_chance: null,
};

export function isCalibratedMarket(v: unknown): v is CalibratedMarketKey {
  return (
    typeof v === "string" &&
    (CALIBRATED_MARKETS as readonly string[]).includes(v)
  );
}

/** `?market=` da URL → mercado. Fora do enum cai no over/under (a visão original). */
export function parseMarketSegment(v: unknown): CalibratedMarketKey {
  return isCalibratedMarket(v) ? v : "over_under";
}
