import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

export const ODDS_API_BASE_URL = "https://api.the-odds-api.com/v4";

// Confirmed via GET /v4/sports: Brasileirão + Champions (2026-05) and World Cup
// (soccer_fifa_world_cup, active=true with totals/2.5 markets — 2026-06).
export const SPORT_KEYS = {
  BRASILEIRAO_A: "soccer_brazil_campeonato",
  CHAMPIONS_LEAGUE: "soccer_uefa_champs_league",
  WORLD_CUP: "soccer_fifa_world_cup",
} as const;

export type SportKey = (typeof SPORT_KEYS)[keyof typeof SPORT_KEYS];

/**
 * League -> The Odds API sport key. Exhaustive `Record<SupportedLeague, …>` so a
 * newly added league is a COMPILE error here until mapped — replaces the old
 * per-call ternaries in predict.ts / fetch-and-snapshot.ts that silently fell
 * through to the Champions key for any non-Brasileirão league.
 */
export const SPORT_KEY_BY_LEAGUE: Record<SupportedLeague, SportKey> = {
  brasileirao_a: SPORT_KEYS.BRASILEIRAO_A,
  champions_league: SPORT_KEYS.CHAMPIONS_LEAGUE,
  world_cup: SPORT_KEYS.WORLD_CUP,
};

export function leagueToSportKey(league: SupportedLeague): SportKey {
  return SPORT_KEY_BY_LEAGUE[league];
}

// Market keys per https://the-odds-api.com/liveapi/guides/v4/#additional-markets
export const MARKETS = {
  H2H: "h2h",
  SPREADS: "spreads",
  TOTALS: "totals", // over/under (linha featured, 2.5) — primeiro mercado do Tier 1
  // alternate_totals é a ESCADA de over/under (1.5/2.5/3.5…) — mercado *additional*
  // (só por evento /events/{id}/odds; o featured 'totals' traz só a linha principal).
  // Usado pela variante OVER_UNDER_ALT (#175). Documental — a fonte de verdade do
  // providerMarketKey é o descriptor.
  ALTERNATE_TOTALS: "alternate_totals",
  // btts é um mercado *additional*: NÃO vem no batch /odds (featured); só pelo
  // endpoint por evento /events/{id}/odds. Ver descriptor BTTS (oddsSource).
  BTTS: "btts",
  // dupla chance (1X/X2/12) — também *additional* (por evento). Ver descriptor
  // DOUBLE_CHANCE (oddsSource). A fonte de verdade do providerMarketKey é o
  // descriptor; esta const é documental (não é consumida no fetch).
  DOUBLE_CHANCE: "double_chance",
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
