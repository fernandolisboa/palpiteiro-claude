import { CANONICAL_TEAMS } from "@/lib/providers/sports-data/canonical-teams";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

// Stopwords stripped during fuzzy match. Lowercase, ASCII-folded.
const TEAM_NAME_STOPWORDS = new Set([
  "fc",
  "afc",
  "sc",
  "ac",
  "cr",
  "ec",
  "ca",
  "fk",
  "cf",
  "kv",
  "sk",
  "bc",
  "rb",
  "ssc",
  "pae",
  "pfc",
  "fbpa",
  "fbc",
  "ag",
  "af",
  "sfp",
  "do",
  "de",
  "da",
  "club",
  "clube",
  // "and": The Odds API escreve "Brighton and Hove Albion"; football-data usa "&".
  "and",
  // "atletico"/"athletic" NÃO são stopwords (ADR 0049): com elas, "Atlético Madrid"
  // virava "madrid" e casava por inclusão com "Real Madrid" (1X2 invertido no
  // dérbi), e "Athletic Club" virava "" (nunca casava odds de "Athletic Bilbao").
]);

/**
 * Normalizes a team name for fuzzy matching across providers. Strips
 * diacritics, lowercases, removes non-alphanumeric chars, then drops common
 * stopwords (FC, SC, Club, etc.). Same logic that used to live in
 * `lib/ai/predict.ts:normalizeTeamName`, hoisted so both predict.ts and
 * sports-data adapters share it.
 */
export function normalizeTeamName(name: string): string {
  const folded = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  const tokens = folded
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !TEAM_NAME_STOPWORDS.has(t));
  return tokens.join(" ");
}

/**
 * Explicit provider-spelling -> canonical-name overrides, per league, for names
 * that match canonical via neither exact nor fuzzy logic. These are real
 * cross-provider spelling differences: API-Football abbreviates club names
 * ("Palmeiras" vs canonical "SE Palmeiras", "Bayer Leverkusen" vs
 * "Bayer 04 Leverkusen") and national teams drift between providers
 * (football-data.org "Czechia" vs API-Football "Czech Republic"). The table is
 * provider-agnostic: each alternate spelling is unique to one provider, so a
 * flat per-league map is unambiguous. Generated/maintained alongside
 * scripts/generate-team-ids.ts (its warnings list anything still unmapped).
 */
const TEAM_NAME_ALIASES: Partial<
  Record<SupportedLeague, Readonly<Record<string, string>>>
> = {
  brasileirao_a: {
    Palmeiras: "SE Palmeiras",
    Botafogo: "Botafogo FR",
    Corinthians: "SC Corinthians Paulista",
    "Atletico-MG": "CA Mineiro",
    // Resolvia só pelo stopword "atletico" (removido na ADR 0049).
    "Atletico Paranaense": "CA Paranaense",
  },
  champions_league: {
    Monaco: "AS Monaco FC",
    "Bayer Leverkusen": "Bayer 04 Leverkusen",
    Inter: "FC Internazionale Milano",
    "FC Copenhagen": "FC København",
    "Bodo/Glimt": "FK Bodø/Glimt",
    "Kairat Almaty": "FK Kairat",
    Newcastle: "Newcastle United FC",
    Marseille: "Olympique de Marseille",
    "Olympiakos Piraeus": "PAE Olympiakos SFP",
    "PSV Eindhoven": "PSV",
    Pafos: "Paphos FC",
    Qarabag: "Qarabağ Ağdam FK",
    "Union St. Gilloise": "Royale Union Saint-Gilloise",
    Benfica: "Sport Lisboa e Benfica",
    "Sporting CP": "Sporting Clube de Portugal",
    Tottenham: "Tottenham Hotspur FC",
  },
  world_cup: {
    Czechia: "Czech Republic",
    Turkey: "Türkiye",
    "United States": "USA",
  },
  premier_league: {
    Brighton: "Brighton & Hove Albion FC",
    Coventry: "Coventry City FC",
    Ipswich: "Ipswich Town FC",
    Leeds: "Leeds United FC",
    Newcastle: "Newcastle United FC",
    Tottenham: "Tottenham Hotspur FC",
  },
  la_liga: {
    Alaves: "Deportivo Alavés",
    "Celta Vigo": "RC Celta de Vigo",
    "Deportivo La Coruna": "RC Deportivo La Coruña",
    Espanyol: "RCD Espanyol",
    Levante: "Levante UD",
    "Real Betis": "Real Betis Balompié",
    "Real Sociedad": "Real Sociedad de Fútbol",
    // Canônicos encurtados de propósito (ADR 0049): o nome completo do
    // football-data contém "Barcelona"/"Madrid" e casaria por inclusão as odds
    // do rival da mesma cidade.
    "RCD Espanyol de Barcelona": "RCD Espanyol",
    "Rayo Vallecano de Madrid": "Rayo Vallecano",
    "Real Racing Club de Santander": "Racing Santander",
    "Real Racing Club": "Racing Santander",
  },
};

/**
 * Maps a provider's team name to the canonical name for a given league.
 *
 * Strategy:
 *   1. Exact match against the canonical list (fast path — most provider
 *      names match canonical when canonical was seeded from that provider).
 *   2. Explicit alias override (TEAM_NAME_ALIASES) for known spelling drift.
 *   3. Fuzzy match via normalizeTeamName comparison.
 *   4. Undefined when no match — caller decides what to do (typically pass
 *      the provider name through; downstream lookups may still match).
 */
export function canonicalizeTeamName(
  providerName: string,
  league: SupportedLeague,
): string | undefined {
  const canonical = CANONICAL_TEAMS[league];
  if (canonical.includes(providerName)) return providerName;
  const alias = TEAM_NAME_ALIASES[league]?.[providerName];
  if (alias && canonical.includes(alias)) return alias;
  const normProvider = normalizeTeamName(providerName);
  if (!normProvider) return undefined;
  for (const c of canonical) {
    if (normalizeTeamName(c) === normProvider) return c;
  }
  return undefined;
}

/**
 * Same as `canonicalizeTeamName` but returns the provider's name unchanged
 * when no canonical match exists. Useful when the caller wants a best-effort
 * label without surfacing a "missing" branch (e.g., displaying recent H2H
 * opponents that may include teams outside the canonical list).
 */
export function canonicalizeOrPassthrough(
  providerName: string,
  league: SupportedLeague,
): string {
  return canonicalizeTeamName(providerName, league) ?? providerName;
}
