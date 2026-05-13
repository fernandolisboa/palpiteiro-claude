import { ApiFootballAdapter } from "@/lib/providers/sports-data/api-football/adapter";
import { FallbackProvider } from "@/lib/providers/sports-data/fallback-provider";
import { FootballDataOrgAdapter } from "@/lib/providers/sports-data/football-data-org/adapter";
import type { SportsDataProvider } from "@/lib/providers/sports-data/types";

type ProviderName = "api-football" | "football-data-org";

const VALID_PROVIDERS: readonly ProviderName[] = [
  "api-football",
  "football-data-org",
] as const;

function parseProviderName(
  value: string | undefined,
  fallback: ProviderName,
): ProviderName {
  if (value === undefined || value === "") return fallback;
  if ((VALID_PROVIDERS as readonly string[]).includes(value)) {
    return value as ProviderName;
  }
  throw new Error(
    `Invalid sports-data provider: "${value}". ` +
      `Expected one of: ${VALID_PROVIDERS.join(", ")}.`,
  );
}

function makeAdapter(name: ProviderName): SportsDataProvider {
  if (name === "api-football") return new ApiFootballAdapter();
  return new FootballDataOrgAdapter();
}

let cached: SportsDataProvider | undefined;

/**
 * Returns the SportsDataProvider configured for this process.
 *
 * Composition is driven by env vars (read once on first call, memoized):
 *   SPORTS_DATA_PRIMARY   default 'api-football'
 *   SPORTS_DATA_FALLBACK  default 'football-data-org'
 *
 * When the two are equal (or only one is set effectively), returns the
 * single adapter directly without wrapping in FallbackProvider — saves the
 * overhead of running every call through the cascade machinery.
 */
export function getSportsDataProvider(): SportsDataProvider {
  if (cached) return cached;
  const primary = parseProviderName(
    process.env.SPORTS_DATA_PRIMARY,
    "api-football",
  );
  const fallback = parseProviderName(
    process.env.SPORTS_DATA_FALLBACK,
    "football-data-org",
  );
  if (primary === fallback) {
    cached = makeAdapter(primary);
    return cached;
  }
  cached = new FallbackProvider(makeAdapter(primary), makeAdapter(fallback));
  return cached;
}

/**
 * Test seam: overrides the memoized provider. Passing `undefined` clears
 * the cache so the next `getSportsDataProvider()` rebuilds from env.
 *
 * Production code MUST NOT call this — it's intentionally underscored.
 */
export function __setSportsDataProviderForTesting(
  provider: SportsDataProvider | undefined,
): void {
  cached = provider;
}

// Re-export the surface that callers most commonly need so they don't have
// to drill into individual files.
export {
  FallbackProvider,
  ApiFootballAdapter,
  FootballDataOrgAdapter,
};
export type {
  SportsDataProvider,
} from "@/lib/providers/sports-data/types";
export {
  SportsDataError,
  SportsDataTransientError,
  SportsDataNotFoundError,
  SportsDataUnsupportedError,
  compositeFixtureKey,
} from "@/lib/providers/sports-data/types";
export type {
  FixtureRef,
  NormalizedFixture,
  NormalizedH2H,
  NormalizedStanding,
  NormalizedInjury,
  NormalizedLineup,
  NormalizedForm,
  NormalizedTeamLineup,
  NormalizedLineupPlayer,
  NormalizedStandingTeam,
  NormalizedFixtureStatus,
  ProviderCapabilities,
} from "@/lib/providers/sports-data/types";
export type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
export { currentSeason } from "@/lib/providers/sports-data/leagues";
