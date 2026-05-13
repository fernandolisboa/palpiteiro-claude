import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

/**
 * Canonical-name -> provider-native team ID map for football-data-org.
 * Generated from /v4/competitions/{code}/teams.
 * Re-run scripts/generate-team-ids.ts to refresh.
 */
export const FOOTBALL_DATA_ORG_TEAM_IDS: Record<SupportedLeague, Readonly<Record<string, number>>> = {
  brasileirao_a: {
    "Fluminense FC": 1765,
    "CA Mineiro": 1766,
    "Grêmio FBPA": 1767,
    "CA Paranaense": 1768,
    "SE Palmeiras": 1769,
    "Botafogo FR": 1770,
    "Cruzeiro EC": 1771,
    "Chapecoense AF": 1772,
    "São Paulo FC": 1776,
    "EC Bahia": 1777,
    "SC Corinthians Paulista": 1779,
    "CR Vasco da Gama": 1780,
    "EC Vitória": 1782,
    "CR Flamengo": 1783,
    "Coritiba FBC": 4241,
    "RB Bragantino": 4286,
    "Clube do Remo": 4287,
    "Mirassol FC": 4364,
    "SC Internacional": 6684,
    "Santos FC": 6685,
  },
  champions_league: {
    "Bayer 04 Leverkusen": 3,
    "Borussia Dortmund": 4,
    "FC Bayern München": 5,
    "Eintracht Frankfurt": 19,
    "Arsenal FC": 57,
    "Chelsea FC": 61,
    "Liverpool FC": 64,
    "Manchester City FC": 65,
    "Newcastle United FC": 67,
    "Tottenham Hotspur FC": 73,
    "Athletic Club": 77,
    "Club Atlético de Madrid": 78,
    "FC Barcelona": 81,
    "Real Madrid CF": 86,
    "Villarreal CF": 94,
    "Atalanta BC": 102,
    "FC Internazionale Milano": 108,
    "Juventus FC": 109,
    "SSC Napoli": 113,
    "Sporting Clube de Portugal": 498,
    "Olympique de Marseille": 516,
    "Paris Saint-Germain FC": 524,
    "AS Monaco FC": 548,
    "Galatasaray SK": 610,
    "Qarabağ Ağdam FK": 611,
    "PAE Olympiakos SFP": 654,
    "PSV": 674,
    "AFC Ajax": 678,
    "Club Brugge KV": 851,
    "SK Slavia Praha": 930,
    "FC København": 1876,
    "Sport Lisboa e Benfica": 1903,
    "Royale Union Saint-Gilloise": 3929,
    "FK Bodø/Glimt": 5721,
    "FK Kairat": 10601,
    "Paphos FC": 11034,
  },
};

export function resolveTeamId(name: string, league: SupportedLeague): number | undefined {
  return FOOTBALL_DATA_ORG_TEAM_IDS[league][name];
}
