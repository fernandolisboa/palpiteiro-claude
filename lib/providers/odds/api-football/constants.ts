// Correct score (placar exato) na api-football é bet=10 — validado ao vivo na liga
// 71 (Brasileirão), cotado só pelo Bet365 (ADR 0025 §1). Scorer/assist (92/93/212)
// ficam pro #290 (precisam de âncora de elenco via /fixtures/events).
export const BET_ID_CORRECT_SCORE = 10 as const;

// providerMarketKey do descriptor CORRECT_SCORE: o adapter estampa em
// NormalizedOddsMarket.key e o OddsFallbackProvider roteia por ele (namespace bet_*
// é cedido pela The Odds API ao api-football).
export const CORRECT_SCORE_PROVIDER_KEY = "bet_10" as const;

// Artilheiro a qualquer momento (anytime scorer) = bet=92; assistência = bet=212
// na api-football (#290, ADR 0025 emenda). bet=93 (first scorer) NÃO entra (vencedor
// único mutuamente-exclusivo, não binário independente — diferido na emenda). Shape
// do `value` (id numérico vs só nome) NÃO verificado ao vivo (liga pausada) →
// normalizer defensivo, inspecionar 1º payload real antes de confiar no matching.
export const BET_ID_ANYTIME_SCORER = 92 as const;
export const BET_ID_ASSIST = 212 as const;

// providerMarketKeys roteados pelo OddsFallbackProvider (supportsMarket) pro
// api-football. O adapter estampa estes em NormalizedOddsMarket.key.
export const ANYTIME_SCORER_PROVIDER_KEY = "bet_92" as const;
export const ASSIST_PROVIDER_KEY = "bet_212" as const;
