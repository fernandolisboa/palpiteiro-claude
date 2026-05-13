import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

/**
 * Canonical team names per league. Uses API-Football's spelling as the
 * reference since it's the primary provider. Drift between providers is
 * isolated to each adapter's team-ids.ts map.
 *
 * Populated by scripts/generate-team-ids.ts (issue #24 step 3 for
 * api-football and step 7 for football-data-org). Both adapters' team-ids
 * maps MUST cover every name listed here — regression test in
 * canonical-teams.test.ts enforces this once the maps exist.
 */
export const CANONICAL_TEAMS: Record<SupportedLeague, readonly string[]> = {
  brasileirao_a: [],
  champions_league: [],
};

export function isCanonicalTeam(
  name: string,
  league: SupportedLeague,
): boolean {
  return CANONICAL_TEAMS[league].includes(name);
}
