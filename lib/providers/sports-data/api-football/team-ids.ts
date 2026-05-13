import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

/**
 * Canonical-name -> API-Football team ID map.
 *
 * EMPTY ON PURPOSE — at the time of issue #24 the API-Football account was
 * suspended, so the generator could not be run for this provider. Populate by
 * running `pnpm tsx scripts/generate-team-ids.ts --provider=api-football`
 * once the account is reactivated. The script reads canonical names from
 * canonical-teams.ts and reconciles them against API-Football's spellings —
 * any mismatches surface as console warnings and need manual aliasing here.
 *
 * Until populated, the ApiFootballAdapter's name-based methods (getH2H,
 * getTeamForm, getInjuriesByTeam) throw SportsDataTransientError when an
 * unknown canonical name is requested. The FallbackProvider treats Transient
 * as a cascade signal, so the call is retried against the next adapter (e.g.
 * football-data-org). This is the deliberate ADR-0005 contract (see lines
 * 102–109): from the caller's perspective an unmapped name is functionally
 * equivalent to a provider outage, so cascading keeps the system operational
 * while this map is being populated.
 */
export const API_FOOTBALL_TEAM_IDS: Record<
  SupportedLeague,
  Readonly<Record<string, number>>
> = {
  brasileirao_a: {},
  champions_league: {},
};

export function resolveTeamId(
  name: string,
  league: SupportedLeague,
): number | undefined {
  return API_FOOTBALL_TEAM_IDS[league][name];
}
