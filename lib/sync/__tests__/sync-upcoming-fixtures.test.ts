import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACTIVE_LEAGUES } from "@/lib/config/active-leagues";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { __setSportsDataProviderForTesting } from "@/lib/providers/sports-data";
import type {
  NormalizedFixture,
  SportsDataProvider,
} from "@/lib/providers/sports-data/types";
import { ensureUpcomingFixturesSynced } from "@/lib/sync/sync-upcoming-fixtures";
import { acquireSyncLock, releaseSyncLock } from "@/lib/sync/lock";

// DB é mockado: o sync só deve persistir, não tocar Postgres real nos testes.
const upsertSpy = vi.fn();
vi.mock("@/lib/db/queries/matches", () => ({
  upsertMatchesFromProvider: (fixtures: NormalizedFixture[]) =>
    upsertSpy(fixtures),
}));

// Lock mockado: simula a semântica check-and-set (1º acquire vence, próximos
// no-mesmo-"lock" falham) sem KV nem in-memory store real. `force` sempre vence.
// Estado de lock compartilhado pelo mock — via vi.hoisted pra ser inicializado
// ANTES do factory hoisted de vi.mock, e externo (não closure-local) pra que
// `beforeEach` possa zerá-lo.
const lockState = vi.hoisted(() => ({ held: false }));
vi.mock("@/lib/sync/lock", () => ({
  acquireSyncLock: vi.fn(async (opts?: { force?: boolean; ttlMs?: number }) => {
    if (opts?.force) {
      lockState.held = true;
      return true;
    }
    if (lockState.held) return false;
    lockState.held = true;
    return true;
  }),
  releaseSyncLock: vi.fn(async () => {
    lockState.held = false;
  }),
}));

const acquireMock = vi.mocked(acquireSyncLock);
const releaseMock = vi.mocked(releaseSyncLock);

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
    getFixtureEvents: vi.fn() as never,
    getH2H: vi.fn() as never,
    getStandings: vi.fn() as never,
    getInjuriesByFixture: vi.fn() as never,
    getInjuriesByTeam: vi.fn() as never,
    getLineups: vi.fn() as never,
    getTeamForm: vi.fn() as never,
  };
}

describe("ensureUpcomingFixturesSynced", () => {
  beforeEach(() => {
    upsertSpy.mockClear();
    acquireMock.mockClear();
    releaseMock.mockClear();
    lockState.held = false;
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

    await ensureUpcomingFixturesSynced();

    // Uma chamada de getFixturesBySeason por liga ativa — sem laço de dias.
    expect(getFixturesBySeason).toHaveBeenCalledTimes(ACTIVE_LEAGUES.length);
    const leaguesRequested = getFixturesBySeason.mock.calls.map(
      ([league]) => league,
    );
    expect(new Set(leaguesRequested)).toEqual(new Set(ACTIVE_LEAGUES));
    // Sync competição-inteira não usa o fetch por dia-calendário.
    expect(getFixturesByDate).not.toHaveBeenCalled();
  });

  it("sincroniza só ligas ativas (Brasileirão + Champions), nunca a Copa encerrada (#491)", async () => {
    const getFixturesBySeason = vi.fn().mockResolvedValue([]);
    __setSportsDataProviderForTesting(makeProvider({ getFixturesBySeason }));

    await ensureUpcomingFixturesSynced();

    const leaguesRequested = getFixturesBySeason.mock.calls.map(
      ([league]) => league,
    );
    expect(new Set(leaguesRequested)).toEqual(
      new Set(["brasileirao_a", "champions_league"]),
    );
    expect(leaguesRequested).not.toContain("world_cup");
  });

  it("upserta as fixtures de todas as ligas ativas num upsert só", async () => {
    const bsa = { id: "bsa-1" } as unknown as NormalizedFixture;
    const ucl = { id: "ucl-1" } as unknown as NormalizedFixture;
    const getFixturesBySeason = vi.fn((league: string) =>
      Promise.resolve(league === "brasileirao_a" ? [bsa] : [ucl]),
    );
    __setSportsDataProviderForTesting(makeProvider({ getFixturesBySeason }));

    await ensureUpcomingFixturesSynced();

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy).toHaveBeenCalledWith([bsa, ucl]);
  });

  it("não roda (no-op) quando o lock não é adquirido", async () => {
    const getFixturesBySeason = vi.fn().mockResolvedValue([]);
    __setSportsDataProviderForTesting(makeProvider({ getFixturesBySeason }));

    // 1º acquire vence; 2º falha o lock → no-op.
    await ensureUpcomingFixturesSynced();
    await ensureUpcomingFixturesSynced();

    expect(getFixturesBySeason).toHaveBeenCalledTimes(ACTIVE_LEAGUES.length);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
  });

  it("o lock evita um segundo sync concorrente (stampede)", async () => {
    const getFixturesBySeason = vi.fn().mockResolvedValue([]);
    __setSportsDataProviderForTesting(makeProvider({ getFixturesBySeason }));

    await ensureUpcomingFixturesSynced();
    // Segundo request enquanto o lock ainda está válido: no-op.
    await ensureUpcomingFixturesSynced();

    expect(getFixturesBySeason).toHaveBeenCalledTimes(ACTIVE_LEAGUES.length);
    expect(upsertSpy).toHaveBeenCalledTimes(1);
  });

  it("force:true roda MESMO com o lock já segurado (cron)", async () => {
    const getFixturesBySeason = vi.fn().mockResolvedValue([]);
    __setSportsDataProviderForTesting(makeProvider({ getFixturesBySeason }));

    await ensureUpcomingFixturesSynced(); // segura o lock
    await ensureUpcomingFixturesSynced({ force: true }); // bypassa e roda

    // Duas rodadas completas: 2 chamadas por liga, 2 upserts.
    expect(getFixturesBySeason).toHaveBeenCalledTimes(
      ACTIVE_LEAGUES.length * 2,
    );
    expect(upsertSpy).toHaveBeenCalledTimes(2);
    expect(acquireMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ force: true }),
    );
  });

  it("uma falha de provider é isolada por allSettled e NÃO libera o lock", async () => {
    // Com >1 liga ativa, o allSettled isolaria a liga que falha e ainda
    // upsertaria as demais. Com uma única liga ativa, garantimos pelo menos
    // que a falha não derruba o sync: ainda há um upsert (com [] de fixtures)
    // e o lock NÃO é liberado (allSettled não relança).
    const getFixturesBySeason = vi
      .fn()
      .mockRejectedValue(new Error("provider boom"));
    __setSportsDataProviderForTesting(makeProvider({ getFixturesBySeason }));

    await ensureUpcomingFixturesSynced();

    expect(upsertSpy).toHaveBeenCalledTimes(1);
    expect(upsertSpy).toHaveBeenCalledWith([]);
    // Lock permanece (allSettled engole o erro): release nunca foi chamado.
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("libera o lock e relança quando o upsert (não o provider) lança", async () => {
    const getFixturesBySeason = vi.fn().mockResolvedValue([]);
    __setSportsDataProviderForTesting(makeProvider({ getFixturesBySeason }));
    upsertSpy.mockImplementationOnce(() => {
      throw new Error("db down");
    });

    await expect(ensureUpcomingFixturesSynced()).rejects.toThrow("db down");
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });
});
