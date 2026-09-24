import { z } from "zod";

export const SUPPORTED_LEAGUES = [
  "brasileirao_a",
  "champions_league",
  "world_cup",
  "serie_a",
  "bundesliga",
  "ligue_1",
  "copa_libertadores",
  "copa_sudamericana",
] as const;
export type SupportedLeague = (typeof SUPPORTED_LEAGUES)[number];
export const SupportedLeagueSchema = z.enum(SUPPORTED_LEAGUES);

// Provider-specific league identifiers. Confirmed via each provider's docs:
//   API-Football v3: league IDs 71 (BSA), 2 (UCL), 1 (World Cup), 135 (Serie A),
//   78 (Bundesliga), 61 (Ligue 1), 13 (Copa Libertadores), 11 (Copa Sudamericana).
//   football-data.org v4: codes BSA / CL / WC / SA / BL1 / FL1 (numeric IDs
//   2013 / 2001 / 2000 / 2019 / 2002 / 2015 also accepted) — all in the free tier.
//   The CONMEBOL cups are NOT on football-data.org's free tier (Libertadores is paid
//   "CLI"; Sudamericana isn't offered), so they have no code: API-Football is their
//   only fixtures source (ADR 0045).
export const API_FOOTBALL_LEAGUE_IDS: Record<SupportedLeague, number> = {
  brasileirao_a: 71,
  champions_league: 2,
  world_cup: 1,
  serie_a: 135,
  bundesliga: 78,
  ligue_1: 61,
  copa_libertadores: 13,
  copa_sudamericana: 11,
};

// Partial: a league missing here isn't served by football-data.org (the adapter
// leaves it out of supportedLeagues, so the FallbackProvider never routes it there).
export const FOOTBALL_DATA_ORG_LEAGUE_CODES: Partial<
  Record<SupportedLeague, string>
> = {
  brasileirao_a: "BSA",
  champions_league: "CL",
  world_cup: "WC",
  serie_a: "SA",
  bundesliga: "BL1",
  ligue_1: "FL1",
};

/**
 * Returns the season label for a league at a given instant. The label matches
 * what each provider expects on its `season` query param.
 *
 * - Brasileirão Série A (calendar-year): April–December. January–March uses the
 *   prior year's label (last season is the most recently completed one — the
 *   current season hasn't kicked off yet).
 * - Champions League and the European domestic leagues (Serie A, Bundesliga,
 *   Ligue 1) are cross-year: August–May. The label is the year the season
 *   starts. January–July uses the prior year's label.
 * - CONMEBOL cups (Libertadores, Sudamericana): calendar-year, preliminary rounds
 *   from early February to the final in November. January uses the prior year's
 *   label (the new edition hasn't kicked off).
 * - World Cup: single edition. Both providers key the 2026 tournament on
 *   season `2026` (the year it starts). Bump this when the next edition (2030)
 *   is onboarded.
 */
export function currentSeason(
  league: SupportedLeague,
  now: Date = new Date(),
): number {
  if (league === "world_cup") {
    return 2026;
  }
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1-12
  if (league === "brasileirao_a") {
    return month >= 4 ? year : year - 1;
  }
  if (league === "copa_libertadores" || league === "copa_sudamericana") {
    return month >= 2 ? year : year - 1;
  }
  // champions_league + European domestic leagues (cross-year)
  return month >= 8 ? year : year - 1;
}
