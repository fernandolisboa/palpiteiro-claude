import { z } from "zod";

export const SUPPORTED_LEAGUES = [
  "brasileirao_a",
  "champions_league",
  "world_cup",
] as const;
export type SupportedLeague = (typeof SUPPORTED_LEAGUES)[number];
export const SupportedLeagueSchema = z.enum(SUPPORTED_LEAGUES);

// Provider-specific league identifiers. Confirmed via each provider's docs:
//   API-Football v3: league IDs 71 (BSA), 2 (UCL), 1 (World Cup).
//   football-data.org v4: codes BSA / CL / WC (numeric IDs 2013 / 2001 / 2000 also accepted).
export const API_FOOTBALL_LEAGUE_IDS: Record<SupportedLeague, number> = {
  brasileirao_a: 71,
  champions_league: 2,
  world_cup: 1,
};

export const FOOTBALL_DATA_ORG_LEAGUE_CODES: Record<SupportedLeague, string> = {
  brasileirao_a: "BSA",
  champions_league: "CL",
  world_cup: "WC",
};

/**
 * Returns the season label for a league at a given instant. The label matches
 * what each provider expects on its `season` query param.
 *
 * - Brasileirão Série A (calendar-year): April–December. January–March uses the
 *   prior year's label (last season is the most recently completed one — the
 *   current season hasn't kicked off yet).
 * - Champions League (cross-year): August–May. The label is the year the
 *   season starts. January–July uses the prior year's label.
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
  // champions_league (and future cross-year European competitions)
  return month >= 8 ? year : year - 1;
}
