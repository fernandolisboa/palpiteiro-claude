import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inMemoryCache } from "@/lib/cache/in-memory";
import { SYNC_HORIZON_DAYS } from "@/lib/config/active-leagues";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { __setSportsDataProviderForTesting } from "@/lib/providers/sports-data";
import type {
  NormalizedFixture,
  SportsDataProvider,
} from "@/lib/providers/sports-data/types";
import { ensureUpcomingFixturesSynced } from "@/lib/sync/sync-upcoming-fixtures";

// DB é mockado: o sync só deve persistir, não tocar Postgres real nos testes.
const upsertSpy = vi.fn();
vi.mock("@/lib/db/queries/matches", () => ({
  upsertMatchesFromProvider: (fixtures: NormalizedFixture[]) =>
    upsertSpy(fixtures),
}));

function makeProvider(
  getFixturesByDate: ReturnType<typeof vi.fn>,
): SportsDataProvider {
  return {
    capabilities: {
      name: "test",
      supportsInjuries: true,
      supportsLineups: true,
      supportedLeagues: new Set<SupportedLeague>([
        "brasileirao_a",
        "champions_league",
        "world_cup",
      ]),
    },
    getFixturesByDate: getFixturesByDate as never,
    getFixtureByMatch: vi.fn() as never,
    getH2H: vi.fn() as never,
    getStandings: vi.fn() as never,
    getInjuriesByFixture: vi.fn() as never,
    getInjuriesByTeam: vi.fn() as never,
    getLineups: vi.fn() as never,
    getTeamForm: vi.fn() as never,
  };
}

describe("ensureUpcomingFixturesSynced", () => {
  beforeEach(async () => {
    upsertSpy.mockClear();
    await inMemoryCache.delete("sync:upcoming-fixtures:lock");
  });

  afterEach(() => {
    __setSportsDataProviderForTesting(undefined);
  });

  it("sincroniza só ligas ativas (Copa), nunca ligas de clube", async () => {
    const getFixturesByDate = vi.fn().mockResolvedValue([]);
    __setSportsDataProviderForTesting(makeProvider(getFixturesByDate));

    await ensureUpcomingFixturesSynced(new Date("2026-06-07T00:00:00.000Z"));

    const leaguesRequested = getFixturesByDate.mock.calls.map(
      ([, league]) => league,
    );
    expect(new Set(leaguesRequested)).toEqual(new Set(["world_cup"]));
    expect(leaguesRequested).not.toContain("brasileirao_a");
    expect(leaguesRequested).not.toContain("champions_league");
  });

  it("itera SYNC_HORIZON_DAYS day-buckets por liga ativa", async () => {
    const getFixturesByDate = vi.fn().mockResolvedValue([]);
    __setSportsDataProviderForTesting(makeProvider(getFixturesByDate));

    await ensureUpcomingFixturesSynced(new Date("2026-06-07T00:00:00.000Z"));

    // 1 liga ativa × SYNC_HORIZON_DAYS dias.
    expect(getFixturesByDate).toHaveBeenCalledTimes(SYNC_HORIZON_DAYS);
    const dates = getFixturesByDate.mock.calls.map(([date]) => date);
    expect(new Set(dates).size).toBe(SYNC_HORIZON_DAYS);
  });
});
