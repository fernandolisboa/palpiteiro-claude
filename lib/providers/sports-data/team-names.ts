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
  "atletico",
  "athletic",
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
 * Maps a provider's team name to the canonical name for a given league.
 *
 * Strategy:
 *   1. Exact match against the canonical list (fast path — most provider
 *      names match canonical when canonical was seeded from that provider).
 *   2. Fuzzy match via normalizeTeamName comparison.
 *   3. Undefined when no match — caller decides what to do (typically pass
 *      the provider name through; downstream lookups may still match).
 */
export function canonicalizeTeamName(
  providerName: string,
  league: SupportedLeague,
): string | undefined {
  const canonical = CANONICAL_TEAMS[league];
  if (canonical.includes(providerName)) return providerName;
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
