/*
 * Manual validation of the sports-data abstraction (issue #24).
 *
 * Exercises three scenarios against live providers, with strict quota
 * discipline:
 *   1. Primary OK: real call routes through the configured primary.
 *   2. Primary fails -> fallback activates: a mock primary throwing
 *      SportsDataTransientError forces cascade; the real fallback serves.
 *   3. Capabilities union: confirms the FallbackProvider reports the union.
 *
 * Budget: <=6 real calls total (usually 2). Aborts on 429 or quota error.
 *
 * Run:
 *   pnpm tsx scripts/test-providers.ts
 *   pnpm tsx scripts/test-providers.ts --primary=football-data-org \
 *                                       --fallback=api-football
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { ApiFootballAdapter } from "@/lib/providers/sports-data/api-football/adapter";
import { FallbackProvider } from "@/lib/providers/sports-data/fallback-provider";
import { FootballDataOrgAdapter } from "@/lib/providers/sports-data/football-data-org/adapter";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import {
  SportsDataNotFoundError,
  SportsDataTransientError,
  SportsDataUnsupportedError,
  type FixtureRef,
  type NormalizedFixture,
  type NormalizedH2H,
  type NormalizedInjury,
  type NormalizedLineup,
  type NormalizedStanding,
  type ProviderCapabilities,
  type SportsDataProvider,
} from "@/lib/providers/sports-data/types";

type ProviderName = "api-football" | "football-data-org";

const TARGET_LEAGUE: SupportedLeague = "brasileirao_a";

function parseArgs(): { primary: ProviderName; fallback: ProviderName } {
  let primary: ProviderName =
    (process.env.SPORTS_DATA_PRIMARY as ProviderName) ?? "api-football";
  let fallback: ProviderName =
    (process.env.SPORTS_DATA_FALLBACK as ProviderName) ??
    "football-data-org";
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--primary=")) primary = arg.slice("--primary=".length) as ProviderName;
    if (arg.startsWith("--fallback=")) fallback = arg.slice("--fallback=".length) as ProviderName;
  }
  return { primary, fallback };
}

function makeAdapter(name: ProviderName): SportsDataProvider {
  return name === "api-football"
    ? new ApiFootballAdapter()
    : new FootballDataOrgAdapter();
}

// A mock provider that always throws SportsDataTransientError on every method.
// Used by scenario 2 to force cascade without burning real-provider quota.
function makeFailingMockProvider(name = "mock-primary"): SportsDataProvider {
  const fail = async (method: string): Promise<never> => {
    throw new SportsDataTransientError(
      `injected ${method} failure for cascade test`,
      name,
      method,
      new Error("simulated 503"),
    );
  };
  const capabilities: ProviderCapabilities = {
    name,
    supportsInjuries: true,
    supportsLineups: true,
    supportedLeagues: new Set<SupportedLeague>([
      "brasileirao_a",
      "champions_league",
    ]),
  };
  return {
    capabilities,
    getFixturesByDate: () => fail("getFixturesByDate"),
    getFixturesBySeason: () => fail("getFixturesBySeason"),
    getFixtureByMatch: () => fail("getFixtureByMatch"),
    getFixtureResult: () => fail("getFixtureResult"),
    getH2H: () => fail("getH2H"),
    getStandings: () => fail("getStandings"),
    getInjuriesByFixture: () => fail("getInjuriesByFixture"),
    getInjuriesByTeam: () => fail("getInjuriesByTeam"),
    getLineups: () => fail("getLineups"),
    getTeamForm: () => fail("getTeamForm"),
  } satisfies SportsDataProvider;
}

function nextDateIso(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function isLikelyQuota429(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return m.includes("429") || m.includes("rate limit") || m.includes("quota");
}

let realCallsConsumed = 0;
function noteCall(provider: string, label: string): void {
  realCallsConsumed += 1;
  console.log(`  [real call ${realCallsConsumed}] ${provider} :: ${label}`);
}

async function scenario1PrimaryOK({
  primary,
  fallback,
}: {
  primary: ProviderName;
  fallback: ProviderName;
}): Promise<void> {
  console.log("\n[scenario 1/3] Primary OK");
  console.log(`  primary=${primary} fallback=${fallback}`);
  console.log(`  league=${TARGET_LEAGUE} date=${nextDateIso(3)}`);
  const provider = new FallbackProvider(
    makeAdapter(primary),
    makeAdapter(fallback),
  );
  console.log(`  composed name: ${provider.capabilities.name}`);
  try {
    noteCall(primary, "getFixturesByDate");
    const fixtures = await provider.getFixturesByDate(
      nextDateIso(3),
      TARGET_LEAGUE,
    );
    console.log(`  -> ${fixtures.length} fixture(s)`);
    if (fixtures[0]) {
      console.log(
        `     example: ${fixtures[0].homeTeam} vs ${fixtures[0].awayTeam} @ ${fixtures[0].kickoffAt}`,
      );
      console.log(`     status: ${fixtures[0].status}`);
    }
    if (fixtures.length === 0) {
      console.log(
        "     (no fixtures in window — expected if league is between matchdays)",
      );
    }
    console.log("  ✓ primary call succeeded");
  } catch (err) {
    if (isLikelyQuota429(err)) {
      console.error(`  ✗ aborting: quota/429 from ${primary}`);
      throw err;
    }
    if (err instanceof SportsDataTransientError) {
      console.log(
        `  ! primary failed transiently; expected fallback to have run automatically:\n    ${err.message}`,
      );
    } else {
      console.error(`  ✗ unexpected error: ${err}`);
      throw err;
    }
  }
}

async function scenario2FallbackActivates({
  fallback,
}: {
  fallback: ProviderName;
}): Promise<void> {
  console.log("\n[scenario 2/3] Primary fails -> fallback activates");
  const mockPrimary = makeFailingMockProvider("mock-primary");
  const realFallback = makeAdapter(fallback);
  const provider = new FallbackProvider(mockPrimary, realFallback);
  console.log(`  composed name: ${provider.capabilities.name}`);
  console.log("  (watch for `event=fallback_activated` warn line below)");
  try {
    noteCall(fallback, "getFixturesByDate (via fallback)");
    const fixtures = await provider.getFixturesByDate(
      nextDateIso(3),
      TARGET_LEAGUE,
    );
    console.log(`  -> ${fixtures.length} fixture(s) served by ${fallback}`);
    if (fixtures[0]) {
      console.log(
        `     example: ${fixtures[0].homeTeam} vs ${fixtures[0].awayTeam} @ ${fixtures[0].kickoffAt}`,
      );
    }
    console.log("  ✓ fallback cascade exercised end-to-end");
  } catch (err) {
    if (isLikelyQuota429(err)) {
      console.error(`  ✗ aborting: quota/429 from ${fallback}`);
      throw err;
    }
    console.error(`  ✗ unexpected error: ${err}`);
    throw err;
  }
}

async function scenario3Capabilities({
  primary,
  fallback,
}: {
  primary: ProviderName;
  fallback: ProviderName;
}): Promise<void> {
  console.log("\n[scenario 3/3] Capabilities union (no API calls)");
  const provider = new FallbackProvider(
    makeAdapter(primary),
    makeAdapter(fallback),
  );
  const c = provider.capabilities;
  console.log(`  name: ${c.name}`);
  console.log(`  supportsInjuries: ${c.supportsInjuries}`);
  console.log(`  supportsLineups: ${c.supportsLineups}`);
  console.log(
    `  supportedLeagues: ${Array.from(c.supportedLeagues).sort().join(", ")}`,
  );
  // Validate union math
  const primaryC = makeAdapter(primary).capabilities;
  const fallbackC = makeAdapter(fallback).capabilities;
  const expectedSupportsInjuries =
    primaryC.supportsInjuries || fallbackC.supportsInjuries;
  const expectedSupportsLineups =
    primaryC.supportsLineups || fallbackC.supportsLineups;
  if (
    c.supportsInjuries === expectedSupportsInjuries &&
    c.supportsLineups === expectedSupportsLineups &&
    c.supportedLeagues.has("brasileirao_a") &&
    c.supportedLeagues.has("champions_league")
  ) {
    console.log("  ✓ capabilities match expected union");
  } else {
    throw new Error(
      `capabilities mismatch: got ${JSON.stringify({
        supportsInjuries: c.supportsInjuries,
        supportsLineups: c.supportsLineups,
        supportedLeagues: Array.from(c.supportedLeagues),
      })}`,
    );
  }
}

async function main() {
  console.log("─── scripts/test-providers.ts ───");
  console.log("Budget: <=6 real provider calls; abort on quota/429.");
  const { primary, fallback } = parseArgs();
  // Suppress unused-imports warnings — the type-only refs below keep the
  // imports honest as the abstraction surface.
  void ([] as NormalizedFixture[]);
  void ([] as NormalizedH2H[]);
  void ({} as Partial<NormalizedStanding>);
  void ([] as NormalizedInjury[]);
  void ({} as Partial<NormalizedLineup>);
  void ({} as Partial<FixtureRef>);
  void SportsDataNotFoundError;
  void SportsDataUnsupportedError;

  await scenario1PrimaryOK({ primary, fallback });
  await scenario2FallbackActivates({ fallback });
  await scenario3Capabilities({ primary, fallback });

  console.log(`\nTotal real provider calls: ${realCallsConsumed}`);
  console.log("All scenarios completed.");
}

main().catch((err) => {
  console.error("\n✗ test-providers aborted:", err);
  process.exit(1);
});
