import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FallbackProvider } from "@/lib/providers/sports-data/fallback-provider";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import {
  SportsDataNotFoundError,
  SportsDataTransientError,
  SportsDataUnsupportedError,
  type FixtureRef,
  type NormalizedFixture,
  type ProviderCapabilities,
  type SportsDataProvider,
} from "@/lib/providers/sports-data/types";

// Test factory: builds a mock SportsDataProvider with overridable capabilities
// and per-method spies. Every method defaults to vi.fn so we can assert which
// calls happened or didn't.
function makeMockProvider(
  name: string,
  caps: Partial<Omit<ProviderCapabilities, "name">> = {},
): SportsDataProvider & { __spies: Record<string, ReturnType<typeof vi.fn>> } {
  const spies: Record<string, ReturnType<typeof vi.fn>> = {
    getFixturesByDate: vi.fn(),
    getFixtureByMatch: vi.fn(),
    getH2H: vi.fn(),
    getStandings: vi.fn(),
    getInjuriesByFixture: vi.fn(),
    getInjuriesByTeam: vi.fn(),
    getLineups: vi.fn(),
    getTeamForm: vi.fn(),
  };
  const capabilities: ProviderCapabilities = {
    name,
    supportsInjuries: caps.supportsInjuries ?? true,
    supportsLineups: caps.supportsLineups ?? true,
    supportedLeagues:
      caps.supportedLeagues ??
      new Set<SupportedLeague>(["brasileirao_a", "champions_league"]),
  };
  return {
    capabilities,
    getFixturesByDate: spies.getFixturesByDate as never,
    getFixtureByMatch: spies.getFixtureByMatch as never,
    getH2H: spies.getH2H as never,
    getStandings: spies.getStandings as never,
    getInjuriesByFixture: spies.getInjuriesByFixture as never,
    getInjuriesByTeam: spies.getInjuriesByTeam as never,
    getLineups: spies.getLineups as never,
    getTeamForm: spies.getTeamForm as never,
    __spies: spies,
  };
}

const REF: FixtureRef = {
  league: "brasileirao_a",
  kickoffAt: "2026-05-15T19:00:00.000Z",
  homeTeam: "CR Flamengo",
  awayTeam: "Fluminense FC",
};

const SAMPLE_FIXTURE: NormalizedFixture = {
  id: "brasileirao_a:2026-05-15T19:00:00.000Z:CR Flamengo:Fluminense FC",
  league: "brasileirao_a",
  kickoffAt: "2026-05-15T19:00:00.000Z",
  kickoffTimestampMs: Date.parse("2026-05-15T19:00:00.000Z"),
  homeTeam: "CR Flamengo",
  awayTeam: "Fluminense FC",
  status: "scheduled",
  score: { home: null, away: null },
};

describe("FallbackProvider.capabilities", () => {
  it("name = fallback(primary,fallback)", () => {
    const p = makeMockProvider("p");
    const f = makeMockProvider("f");
    const fp = new FallbackProvider(p, f);
    expect(fp.capabilities.name).toBe("fallback(p,f)");
  });

  it("OR of supportsInjuries and supportsLineups", () => {
    const p = makeMockProvider("p", {
      supportsInjuries: true,
      supportsLineups: false,
    });
    const f = makeMockProvider("f", {
      supportsInjuries: false,
      supportsLineups: true,
    });
    const fp = new FallbackProvider(p, f);
    expect(fp.capabilities.supportsInjuries).toBe(true);
    expect(fp.capabilities.supportsLineups).toBe(true);
  });

  it("union of supportedLeagues", () => {
    const p = makeMockProvider("p", {
      supportedLeagues: new Set<SupportedLeague>(["brasileirao_a"]),
    });
    const f = makeMockProvider("f", {
      supportedLeagues: new Set<SupportedLeague>(["champions_league"]),
    });
    const fp = new FallbackProvider(p, f);
    expect(fp.capabilities.supportedLeagues.has("brasileirao_a")).toBe(true);
    expect(fp.capabilities.supportedLeagues.has("champions_league")).toBe(true);
    expect(fp.capabilities.supportedLeagues.size).toBe(2);
  });
});

describe("FallbackProvider cascade — happy path", () => {
  it("returns primary result without touching fallback", async () => {
    const p = makeMockProvider("p");
    const f = makeMockProvider("f");
    p.__spies.getFixturesByDate.mockResolvedValueOnce([SAMPLE_FIXTURE]);
    const fp = new FallbackProvider(p, f);
    const result = await fp.getFixturesByDate("2026-05-15", "brasileirao_a");
    expect(result).toEqual([SAMPLE_FIXTURE]);
    expect(p.__spies.getFixturesByDate).toHaveBeenCalledTimes(1);
    expect(f.__spies.getFixturesByDate).not.toHaveBeenCalled();
  });
});

describe("FallbackProvider cascade — error classification", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("does NOT cascade on SportsDataNotFoundError", async () => {
    const p = makeMockProvider("p");
    const f = makeMockProvider("f");
    p.__spies.getStandings.mockRejectedValueOnce(
      new SportsDataNotFoundError("404", "p", "getStandings"),
    );
    const fp = new FallbackProvider(p, f);
    await expect(fp.getStandings("brasileirao_a")).rejects.toThrow(
      SportsDataNotFoundError,
    );
    expect(f.__spies.getStandings).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("cascades on SportsDataTransientError and emits fallback_activated log", async () => {
    const p = makeMockProvider("p");
    const f = makeMockProvider("f");
    p.__spies.getStandings.mockRejectedValueOnce(
      new SportsDataTransientError(
        "503",
        "p",
        "getStandings",
        new Error("upstream"),
      ),
    );
    f.__spies.getStandings.mockResolvedValueOnce({
      league: "brasileirao_a",
      season: 2026,
      tables: [],
    });
    const fp = new FallbackProvider(p, f);
    const result = await fp.getStandings("brasileirao_a");
    expect(result?.season).toBe(2026);
    expect(f.__spies.getStandings).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(warnSpy.mock.calls[0]?.[0] as string);
    expect(payload).toMatchObject({
      event: "fallback_activated",
      method: "getStandings",
      primary: "p",
      fallback: "f",
    });
    expect(payload.cause).toContain("SportsDataTransientError");
  });

  it("re-throws last transient when both providers fail transiently", async () => {
    const p = makeMockProvider("p");
    const f = makeMockProvider("f");
    p.__spies.getH2H.mockRejectedValueOnce(
      new SportsDataTransientError("p fail", "p", "getH2H", undefined),
    );
    f.__spies.getH2H.mockRejectedValueOnce(
      new SportsDataTransientError("f fail", "f", "getH2H", undefined),
    );
    const fp = new FallbackProvider(p, f);
    await expect(
      fp.getH2H("CR Flamengo", "Fluminense FC", "brasileirao_a", 5),
    ).rejects.toMatchObject({
      name: "SportsDataTransientError",
      providerName: "f",
      message: "f fail",
    });
  });

  it("rethrows non-SportsDataError unchanged (programmer error path)", async () => {
    const p = makeMockProvider("p");
    const f = makeMockProvider("f");
    p.__spies.getFixturesByDate.mockRejectedValueOnce(
      new TypeError("Cannot read properties"),
    );
    const fp = new FallbackProvider(p, f);
    await expect(
      fp.getFixturesByDate("2026-05-15", "brasileirao_a"),
    ).rejects.toThrow(TypeError);
    expect(f.__spies.getFixturesByDate).not.toHaveBeenCalled();
  });
});

describe("FallbackProvider capability gating", () => {
  it("skips a provider whose capabilities.supportsInjuries=false", async () => {
    const p = makeMockProvider("p", { supportsInjuries: false });
    const f = makeMockProvider("f", { supportsInjuries: true });
    f.__spies.getInjuriesByFixture.mockResolvedValueOnce({
      home: [],
      away: [],
    });
    const fp = new FallbackProvider(p, f);
    await fp.getInjuriesByFixture(REF);
    expect(p.__spies.getInjuriesByFixture).not.toHaveBeenCalled();
    expect(f.__spies.getInjuriesByFixture).toHaveBeenCalledTimes(1);
  });

  it("throws SportsDataUnsupportedError when neither provider has capability", async () => {
    const p = makeMockProvider("p", { supportsInjuries: false });
    const f = makeMockProvider("f", { supportsInjuries: false });
    const fp = new FallbackProvider(p, f);
    await expect(fp.getInjuriesByFixture(REF)).rejects.toThrow(
      SportsDataUnsupportedError,
    );
    expect(p.__spies.getInjuriesByFixture).not.toHaveBeenCalled();
    expect(f.__spies.getInjuriesByFixture).not.toHaveBeenCalled();
  });

  it("skips a provider that doesn't support the league", async () => {
    const p = makeMockProvider("p", {
      supportedLeagues: new Set<SupportedLeague>(["brasileirao_a"]),
    });
    const f = makeMockProvider("f", {
      supportedLeagues: new Set<SupportedLeague>(["champions_league"]),
    });
    f.__spies.getFixturesByDate.mockResolvedValueOnce([]);
    const fp = new FallbackProvider(p, f);
    await fp.getFixturesByDate("2026-05-15", "champions_league");
    expect(p.__spies.getFixturesByDate).not.toHaveBeenCalled();
    expect(f.__spies.getFixturesByDate).toHaveBeenCalledTimes(1);
  });

  it("getLineups falls through when one provider doesn't support lineups", async () => {
    const p = makeMockProvider("p", { supportsLineups: false });
    const f = makeMockProvider("f", { supportsLineups: true });
    f.__spies.getLineups.mockResolvedValueOnce(undefined);
    const fp = new FallbackProvider(p, f);
    await fp.getLineups(REF);
    expect(p.__spies.getLineups).not.toHaveBeenCalled();
    expect(f.__spies.getLineups).toHaveBeenCalledTimes(1);
  });

  it("bubbles up Unsupported for World Cup injuries without cascading to FDO", async () => {
    // Mirrors production wiring (ADR-0006): API-Football supports injuries but
    // throws Unsupported for World Cup; football-data.org has no injuries at
    // all. The injuries gate filters FDO out, leaving only API-Football, whose
    // Unsupported must bubble up (NOT cascade) so predict.ts sets
    // absences_available=false rather than serving an empty injury list.
    const wcRef: FixtureRef = {
      league: "world_cup",
      kickoffAt: "2026-06-20T19:00:00.000Z",
      homeTeam: "Brazil",
      awayTeam: "Argentina",
    };
    const apiFootball = makeMockProvider("api-football", {
      supportsInjuries: true,
      supportedLeagues: new Set<SupportedLeague>([
        "brasileirao_a",
        "champions_league",
        "world_cup",
      ]),
    });
    const footballDataOrg = makeMockProvider("football-data-org", {
      supportsInjuries: false,
      supportedLeagues: new Set<SupportedLeague>([
        "brasileirao_a",
        "champions_league",
        "world_cup",
      ]),
    });
    apiFootball.__spies.getInjuriesByFixture.mockRejectedValueOnce(
      new SportsDataUnsupportedError(
        "API-Football has no injury coverage for the World Cup competition",
        "api-football",
        "getInjuriesByFixture",
      ),
    );
    const fp = new FallbackProvider(apiFootball, footballDataOrg);
    await expect(fp.getInjuriesByFixture(wcRef)).rejects.toThrow(
      SportsDataUnsupportedError,
    );
    expect(apiFootball.__spies.getInjuriesByFixture).toHaveBeenCalledTimes(1);
    // FDO is gated out by supportsInjuries=false — it never serves WC injuries.
    expect(footballDataOrg.__spies.getInjuriesByFixture).not.toHaveBeenCalled();
  });
});

describe("FallbackProvider does not double-log on success", () => {
  it("no warn when primary succeeds", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = makeMockProvider("p");
    const f = makeMockProvider("f");
    p.__spies.getStandings.mockResolvedValueOnce({
      league: "brasileirao_a",
      season: 2026,
      tables: [],
    });
    const fp = new FallbackProvider(p, f);
    await fp.getStandings("brasileirao_a");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
