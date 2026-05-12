export const ODDS_API_BASE_URL = "https://api.the-odds-api.com/v4";

// Confirmed via GET /v4/sports (2026-05) — both keys present and active.
export const SPORT_KEYS = {
  BRASILEIRAO_A: "soccer_brazil_campeonato",
  CHAMPIONS_LEAGUE: "soccer_uefa_champs_league",
} as const;

export type SportKey = (typeof SPORT_KEYS)[keyof typeof SPORT_KEYS];

// Market keys per https://the-odds-api.com/liveapi/guides/v4/#additional-markets
export const MARKETS = {
  H2H: "h2h",
  SPREADS: "spreads",
  TOTALS: "totals", // over/under — único mercado relevante no MVP
} as const;

export type MarketKey = (typeof MARKETS)[keyof typeof MARKETS];

// Bookmakers brasileiros (Betano, bet365, Pinnacle, Betfair EX EU) ficam todos
// sob a região "eu". Não existe região dedicada "br" na The Odds API.
export const REGIONS = {
  EU: "eu",
  UK: "uk",
  US: "us",
  US2: "us2",
  AU: "au",
} as const;

export type RegionKey = (typeof REGIONS)[keyof typeof REGIONS];
