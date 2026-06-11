import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inMemoryCache } from "@/lib/cache/in-memory";
import { ACTIVE_LEAGUES } from "@/lib/config/active-leagues";
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

function makeProvider(overrides?: {
  getFixturesBySeason?: ReturnType<typeof vi.fn>;
  getFixturesByDate?: ReturnType<typeof vi.fn>;
}): SportsDataProvider {
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
    getFixturesByDate: (overrides?.getFixturesByDate ??
      vi.fn().mockResolvedValue([])) as never,
    getFixturesBySeason: (overrides?.getFixturesBySeason ??
      vi.fn().mockResolvedValue([])) as never,
    getFixtureByMatch: vi.fn() as never,
    getFixtureResult: vi.fn() as never,
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

  it("busca a temporada inteira de cada liga ativa numa chamada por liga", async () => {
    const getFixturesBySeason = vi.fn().mockResolvedValue([]);
    const getFixturesByDate = vi.fn().mockResolvedValue([]);
    __setSportsDataProviderForTesting(
      makeProvider({ getFixturesBySeason, getFixturesByDate }),
    );

    await ensureUpcomingFixturesSynced(new Date("2026-06-07T00:00:00.000Z"));

    // Uma chamada de getFixturesBySeason por liga ativa — sem laço de dias.
    expect(getFixturesBySeason).toHaveBeenCalledTimes(ACTIVE_LEAGUES.length);
    const leaguesRequested = getFixturesBySeason.mock.calls.map(
      ([league]) => league,
    );
    expect(new Set(leaguesRequested)).toEqual(new Set(ACTIVE_LEAGUES));
    // Sync competição-inteira não usa o fetch por dia-calendário.
    expect(getFixturesByDate).not.toHaveBeenCalled();
  });

  it("sincroniza só ligas ativas (Copa), nunca ligas de clube", async () => {
    const getFixturesBySeason = vi.fn().mockResolvedValue([]);
    __setSportsDataProviderForTesting(makeProvider({ getFixturesBySeason }));

    await ensureUpcomingFixturesSynced(new Date("2026-06-07T00:00:00.000Z"));

    const leaguesRequested = getFixturesBySeason.mock.calls.map(
      ([league]) => league,
    );
    expect(new Set(leaguesRequested)).toEqual(new Set(["world_cup"]));
    expect(leaguesRequested).not.toContain("brasileirao_a");
    expect(leaguesRequested).not.toContain("champions_league");
  });

  it("upserta as fixtures retornadas pelo provider", async () => {
    const fixture = { id: "wc-1" } as unknown as NormalizedFixture;
    const getFixturesBySeason = vi.fn().mockResolvedValue([fixture]);
    __setSportsDataProviderForTesting(makeProvider({ getFixturesBySeason }));

    await ensureUpcomingFixturesSynced(new Date("2026-06-07T00:00:00.000Z"));

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy).toHaveBeenCalledWith([fixture]);
  });

  it("o lock evita um segundo sync concorrente (stampede)", async () => {
    const getFixturesBySeason = vi.fn().mockResolvedValue([]);
    __setSportsDataProviderForTesting(makeProvider({ getFixturesBySeason }));

    const now = new Date("2026-06-07T00:00:00.000Z");
    await ensureUpcomingFixturesSynced(now);
    // Segundo request enquanto o lock de 1h ainda está válido: no-op.
    await ensureUpcomingFixturesSynced(now);

    expect(getFixturesBySeason).toHaveBeenCalledTimes(ACTIVE_LEAGUES.length);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
  });

  it("uma falha de provider é isolada por allSettled e libera nada do lock", async () => {
    // Com >1 liga ativa, o allSettled isolaria a liga que falha e ainda
    // upsertaria as demais. Com uma única liga ativa, garantimos pelo menos
    // que a falha não derruba o sync: ainda há um upsert (com [] de fixtures)
    // e o lock NÃO é liberado (allSettled não relança).
    const getFixturesBySeason = vi
      .fn()
      .mockRejectedValue(new Error("provider boom"));
    __setSportsDataProviderForTesting(makeProvider({ getFixturesBySeason }));

    await ensureUpcomingFixturesSynced(new Date("2026-06-07T00:00:00.000Z"));

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy).toHaveBeenCalledWith([]);
    // Lock permanece (allSettled engole o erro), então um retry imediato é no-op.
    expect(
      await inMemoryCache.get<number>("sync:upcoming-fixtures:lock"),
    ).not.toBeUndefined();
  });
});
