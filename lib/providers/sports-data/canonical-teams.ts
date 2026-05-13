import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

/**
 * Canonical team names per league. Bootstrap source: football-data.org
 * /v4/competitions/{code}/teams. When API-Football is reachable, run
 * `pnpm tsx scripts/generate-team-ids.ts --provider=api-football` to
 * verify coverage and reconcile any spelling differences.
 *
 * Each adapter maintains its own `team-ids.ts` mapping these canonical
 * names to the provider-native team IDs. canonical-teams.test.ts asserts
 * both adapter maps cover 100% of this list.
 */
export const CANONICAL_TEAMS: Record<SupportedLeague, readonly string[]> = {
  brasileirao_a: [
    "Botafogo FR",
    "CA Mineiro",
    "CA Paranaense",
    "CR Flamengo",
    "CR Vasco da Gama",
    "Chapecoense AF",
    "Clube do Remo",
    "Coritiba FBC",
    "Cruzeiro EC",
    "EC Bahia",
    "EC Vitória",
    "Fluminense FC",
    "Grêmio FBPA",
    "Mirassol FC",
    "RB Bragantino",
    "SC Corinthians Paulista",
    "SC Internacional",
    "SE Palmeiras",
    "Santos FC",
    "São Paulo FC",
  ] as const,
  champions_league: [
    "AFC Ajax",
    "AS Monaco FC",
    "Arsenal FC",
    "Atalanta BC",
    "Athletic Club",
    "Bayer 04 Leverkusen",
    "Borussia Dortmund",
    "Chelsea FC",
    "Club Atlético de Madrid",
    "Club Brugge KV",
    "Eintracht Frankfurt",
    "FC Barcelona",
    "FC Bayern München",
    "FC Internazionale Milano",
    "FC København",
    "FK Bodø/Glimt",
    "FK Kairat",
    "Galatasaray SK",
    "Juventus FC",
    "Liverpool FC",
    "Manchester City FC",
    "Newcastle United FC",
    "Olympique de Marseille",
    "PAE Olympiakos SFP",
    "PSV",
    "Paphos FC",
    "Paris Saint-Germain FC",
    "Qarabağ Ağdam FK",
    "Real Madrid CF",
    "Royale Union Saint-Gilloise",
    "SK Slavia Praha",
    "SSC Napoli",
    "Sport Lisboa e Benfica",
    "Sporting Clube de Portugal",
    "Tottenham Hotspur FC",
    "Villarreal CF",
  ] as const,
};

export function isCanonicalTeam(name: string, league: SupportedLeague): boolean {
  return CANONICAL_TEAMS[league].includes(name);
}
