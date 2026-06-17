// Correct score (placar exato) na api-football é bet=10 — validado ao vivo na liga
// 71 (Brasileirão), cotado só pelo Bet365 (ADR 0025 §1). Scorer/assist (92/93/212)
// ficam pro #290 (precisam de âncora de elenco via /fixtures/events).
export const BET_ID_CORRECT_SCORE = 10 as const;

// providerMarketKey do descriptor CORRECT_SCORE: o adapter estampa em
// NormalizedOddsMarket.key e o OddsFallbackProvider roteia por ele (namespace bet_*
// é cedido pela The Odds API ao api-football).
export const CORRECT_SCORE_PROVIDER_KEY = "bet_10" as const;
