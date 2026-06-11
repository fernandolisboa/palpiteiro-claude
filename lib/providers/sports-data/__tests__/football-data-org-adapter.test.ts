import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inMemoryCache } from "@/lib/cache/in-memory";
import { FootballDataOrgAdapter, __testing } from "@/lib/providers/sports-data/football-data-org/adapter";
import {
  FootballDataOrgHttpError,
  FootballDataOrgSchemaError,
  FootballDataOrgTimeoutError,
} from "@/lib/providers/sports-data/football-data-org/errors";
import type {
  FootballDataOrgMatch,
  FootballDataOrgMatchWithLineup,
  FootballDataOrgStandingsResponse,
} from "@/lib/providers/sports-data/football-data-org/schemas";
import {
  SportsDataNotFoundError,
  SportsDataTransientError,
  SportsDataUnsupportedError,
} from "@/lib/providers/sports-data/types";

const {
  toNormalizedFixture,
  toNormalizedFixtureResult,
  toNormalizedStanding,
  toNormalizedTeamLineup,
  wrapFootballDataOrgError,
  resolveTeamId,
  buildCacheKey,
} = __testing;

function makeMatch(
  overrides: Partial<FootballDataOrgMatch> = {},
): FootballDataOrgMatch {
  const defaults: FootballDataOrgMatch = {
    id: 554896,
    utcDate: "2026-05-16T22:00:00Z",
    status: "TIMED",
    matchday: 16,
    stage: "REGULAR_SEASON",
    group: null,
    lastUpdated: "2026-05-12T15:21:09Z",
    homeTeam: { id: 1765, name: "Fluminense FC" },
    awayTeam: { id: 1776, name: "São Paulo FC" },
    score: {
      winner: null,
      duration: "REGULAR",
      fullTime: { home: null, away: null },
      halfTime: { home: null, away: null },
    },
  };
  return { ...defaults, ...overrides };
}

describe("FootballDataOrgAdapter capabilities", () => {
  it("name=football-data-org, supportsInjuries=false, supportsLineups=true", () => {
    const a = new FootballDataOrgAdapter();
    expect(a.capabilities.name).toBe("football-data-org");
    expect(a.capabilities.supportsInjuries).toBe(false);
    expect(a.capabilities.supportsLineups).toBe(true);
    expect(a.capabilities.supportedLeagues.has("brasileirao_a")).toBe(true);
    expect(a.capabilities.supportedLeagues.has("champions_league")).toBe(true);
    expect(a.capabilities.supportedLeagues.has("world_cup")).toBe(true);
  });
});

describe("toNormalizedFixture (football-data-org)", () => {
  it("maps a TIMED match to scheduled with composite id", () => {
    const n = toNormalizedFixture(makeMatch(), "brasileirao_a");
    expect(n.id).toBe(
      "brasileirao_a:2026-05-16T22:00:00.000Z:Fluminense FC:São Paulo FC",
    );
    expect(n.status).toBe("scheduled");
    expect(n.score).toEqual({ home: null, away: null });
    expect(n.kickoffTimestampMs).toBe(Date.parse("2026-05-16T22:00:00Z"));
    expect(n.homeTeam).toBe("Fluminense FC");
    expect(n.awayTeam).toBe("São Paulo FC");
  });

  it("maps FINISHED match with score", () => {
    const n = toNormalizedFixture(
      makeMatch({
        status: "FINISHED",
        score: {
          winner: "HOME_TEAM",
          duration: "REGULAR",
          fullTime: { home: 2, away: 1 },
          halfTime: { home: 1, away: 0 },
        },
      }),
      "brasileirao_a",
    );
    expect(n.status).toBe("finished");
    expect(n.score).toEqual({ home: 2, away: 1 });
  });

  it("maps POSTPONED / CANCELLED correctly", () => {
    const p = toNormalizedFixture(
      makeMatch({ status: "POSTPONED" }),
      "brasileirao_a",
    );
    expect(p.status).toBe("postponed");
    const c = toNormalizedFixture(
      makeMatch({ status: "CANCELLED" }),
      "brasileirao_a",
    );
    expect(c.status).toBe("cancelled");
  });

  it("unknown status -> other", () => {
    const u = toNormalizedFixture(
      makeMatch({ status: "WEIRD_STATE" }),
      "brasileirao_a",
    );
    expect(u.status).toBe("other");
  });
});

describe("toNormalizedFixtureResult (football-data-org)", () => {
  it("uses regularTime (90') when a knockout went to extra time / penalties", () => {
    // v4: fullTime is the running final score incl. ET+pens (7-6 after a
    // shootout); regularTime holds the 90' score (1-1) used for over/under.
    const r = toNormalizedFixtureResult(
      makeMatch({
        status: "FINISHED",
        score: {
          winner: "HOME_TEAM",
          duration: "PENALTY_SHOOTOUT",
          fullTime: { home: 7, away: 6 },
          regularTime: { home: 1, away: 1 },
          halfTime: { home: 0, away: 1 },
          extraTime: { home: 1, away: 1 },
          penalties: { home: 5, away: 4 },
        },
      }),
    );
    expect(r.status).toBe("finished");
    expect(r.regulationScore).toEqual({ home: 1, away: 1 });
  });

  it("refuses to settle (null) when a knockout went to ET but regularTime is missing", () => {
    // Provider gap: duration says it went beyond 90' but no regularTime field.
    // fullTime includes ET, so settling on it would be wrong → leave pending.
    const r = toNormalizedFixtureResult(
      makeMatch({
        status: "FINISHED",
        score: {
          winner: "HOME_TEAM",
          duration: "EXTRA_TIME",
          fullTime: { home: 3, away: 2 },
          extraTime: { home: 1, away: 0 },
          halfTime: { home: 1, away: 1 },
        },
      }),
    );
    expect(r.regulationScore).toBeNull();
  });

  it("falls back to fullTime when the match ended in regulation", () => {
    const r = toNormalizedFixtureResult(
      makeMatch({
        status: "FINISHED",
        score: {
          winner: "HOME_TEAM",
          duration: "REGULAR",
          fullTime: { home: 2, away: 1 },
          halfTime: { home: 1, away: 0 },
        },
      }),
    );
    expect(r.regulationScore).toEqual({ home: 2, away: 1 });
  });

  it("returns null regulationScore before the match has a score", () => {
    expect(toNormalizedFixtureResult(makeMatch()).regulationScore).toBeNull();
  });
});

describe("toNormalizedStanding (football-data-org)", () => {
  it("merges TOTAL/HOME/AWAY into per-team rows with splits", () => {
    const response: FootballDataOrgStandingsResponse = {
      standings: [
        {
          stage: "REGULAR_SEASON",
          type: "TOTAL",
          group: null,
          table: [
            {
              position: 1,
              team: { id: 1769, name: "SE Palmeiras" },
              playedGames: 15,
              form: null,
              won: 10,
              draw: 4,
              lost: 1,
              points: 34,
              goalsFor: 25,
              goalsAgainst: 12,
              goalDifference: 13,
            },
          ],
        },
        {
          stage: "REGULAR_SEASON",
          type: "HOME",
          group: null,
          table: [
            {
              position: 1,
              team: { id: 1769, name: "SE Palmeiras" },
              playedGames: 8,
              form: null,
              won: 6,
              draw: 2,
              lost: 0,
              points: 20,
              goalsFor: 14,
              goalsAgainst: 5,
              goalDifference: 9,
            },
          ],
        },
        {
          stage: "REGULAR_SEASON",
          type: "AWAY",
          group: null,
          table: [
            {
              position: 1,
              team: { id: 1769, name: "SE Palmeiras" },
              playedGames: 7,
              form: null,
              won: 4,
              draw: 2,
              lost: 1,
              points: 14,
              goalsFor: 11,
              goalsAgainst: 7,
              goalDifference: 4,
            },
          ],
        },
      ],
      season: { id: 2026 } as never,
    };
    const s = toNormalizedStanding(response, "brasileirao_a");
    expect(s.tables).toHaveLength(1);
    expect(s.tables[0]?.group).toBeUndefined();
    const row = s.tables[0]!.teams[0]!;
    expect(row.team).toBe("SE Palmeiras");
    expect(row.played).toBe(15);
    expect(row.won).toBe(10);
    expect(row.points).toBe(34);
    expect(row.homeSplit).toEqual({
      played: 8,
      wins: 6,
      draws: 2,
      losses: 0,
      goalsFor: 14,
      goalsAgainst: 5,
    });
    expect(row.awaySplit).toEqual({
      played: 7,
      wins: 4,
      draws: 2,
      losses: 1,
      goalsFor: 11,
      goalsAgainst: 7,
    });
  });

  it("preserves CL group structure (multiple groups)", () => {
    const response: FootballDataOrgStandingsResponse = {
      standings: [
        {
          stage: "GROUP_STAGE",
          type: "TOTAL",
          group: "GROUP_A",
          table: [],
        },
        {
          stage: "GROUP_STAGE",
          type: "TOTAL",
          group: "GROUP_B",
          table: [],
        },
      ],
    };
    const s = toNormalizedStanding(response, "champions_league");
    expect(s.tables).toHaveLength(2);
    expect(s.tables.map((t) => t.group).sort()).toEqual(["GROUP_A", "GROUP_B"]);
  });

  it("preserves World Cup group structure", () => {
    const response: FootballDataOrgStandingsResponse = {
      standings: [
        { stage: "GROUP_STAGE", type: "TOTAL", group: "GROUP_A", table: [] },
        { stage: "GROUP_STAGE", type: "TOTAL", group: "GROUP_L", table: [] },
      ],
    };
    const s = toNormalizedStanding(response, "world_cup");
    expect(s.tables).toHaveLength(2);
    expect(s.tables.map((t) => t.group).sort()).toEqual(["GROUP_A", "GROUP_L"]);
  });
});

describe("toNormalizedFixture — World Cup (football-data-org)", () => {
  it("canonicalizes national-team names, including alias drift, for world_cup", () => {
    const m = makeMatch({
      id: 700001,
      utcDate: "2026-06-12T02:00:00Z",
      stage: "GROUP_STAGE",
      group: "GROUP_A",
      homeTeam: { id: 772, name: "South Korea" },
      awayTeam: { id: 798, name: "Czechia" },
    });
    const n = toNormalizedFixture(m, "world_cup");
    expect(n.league).toBe("world_cup");
    expect(n.homeTeam).toBe("South Korea");
    // football-data.org "Czechia" aliases to the canonical "Czech Republic".
    expect(n.awayTeam).toBe("Czech Republic");
  });
});

describe("toNormalizedTeamLineup (football-data-org)", () => {
  it("returns undefined when lineup is absent", () => {
    const team: FootballDataOrgMatchWithLineup["homeTeam"] = {
      id: 1,
      name: "Test FC",
    };
    expect(toNormalizedTeamLineup(team, "brasileirao_a")).toBeUndefined();
  });

  it("normalizes a lineup with positions collapsed to GK/DEF/MID/FWD", () => {
    const team: FootballDataOrgMatchWithLineup["homeTeam"] = {
      id: 1765,
      name: "Fluminense FC",
      formation: "4-3-3",
      lineup: [
        { id: 1, name: "Keeper", position: "Goalkeeper", shirtNumber: 1 },
        { id: 2, name: "RB", position: "Right-Back", shirtNumber: 2 },
        { id: 3, name: "CM", position: "Central Midfield", shirtNumber: 8 },
        { id: 4, name: "ST", position: "Centre-Forward", shirtNumber: 9 },
      ],
      bench: [{ id: 11, name: "Sub1", position: "Right Winger", shirtNumber: 11 }],
    };
    const t = toNormalizedTeamLineup(team, "brasileirao_a")!;
    expect(t.team).toBe("Fluminense FC");
    expect(t.formation).toBe("4-3-3");
    expect(t.starters).toHaveLength(4);
    expect(t.starters[0]?.position).toBe("GK");
    expect(t.starters[1]?.position).toBe("DEF");
    expect(t.starters[2]?.position).toBe("MID");
    expect(t.starters[3]?.position).toBe("FWD");
    expect(t.bench).toHaveLength(1);
    expect(t.bench?.[0]?.position).toBe("FWD");
  });
});

describe("wrapFootballDataOrgError", () => {
  const ctx = { hint: "test" };

  it("maps 5xx -> SportsDataTransientError", () => {
    const err = new FootballDataOrgHttpError(
      "503",
      "/competitions/BSA/matches",
      {},
      503,
      "",
    );
    expect(() => wrapFootballDataOrgError(err, "getFixturesByDate", ctx)).toThrow(
      SportsDataTransientError,
    );
  });

  it("maps 429 -> SportsDataTransientError", () => {
    const err = new FootballDataOrgHttpError(
      "429",
      "/competitions/BSA/matches",
      {},
      429,
      "",
    );
    expect(() => wrapFootballDataOrgError(err, "getFixturesByDate", ctx)).toThrow(
      SportsDataTransientError,
    );
  });

  it("maps 404 -> SportsDataNotFoundError", () => {
    const err = new FootballDataOrgHttpError(
      "404",
      "/matches/123",
      {},
      404,
      "Not found",
    );
    expect(() => wrapFootballDataOrgError(err, "getFixtureByMatch", ctx)).toThrow(
      SportsDataNotFoundError,
    );
  });

  it("maps timeout -> SportsDataTransientError", () => {
    const err = new FootballDataOrgTimeoutError("/matches/123", {});
    expect(() => wrapFootballDataOrgError(err, "getFixtureByMatch", ctx)).toThrow(
      SportsDataTransientError,
    );
  });

  it("maps schema error -> SportsDataTransientError", async () => {
    const { z } = await import("zod");
    const r = z.string().safeParse(123);
    if (r.success) throw new Error("zod did not fail");
    const err = new FootballDataOrgSchemaError(
      "Schema fail",
      "/standings",
      {},
      r.error,
    );
    expect(() => wrapFootballDataOrgError(err, "getStandings", ctx)).toThrow(
      SportsDataTransientError,
    );
  });
});

describe("resolveTeamId (football-data-org)", () => {
  it("resolves a known canonical name", () => {
    expect(resolveTeamId("SE Palmeiras", "brasileirao_a", "getH2H")).toBe(
      1769,
    );
  });

  it("resolves Champions League team", () => {
    expect(
      resolveTeamId("FC Bayern München", "champions_league", "getH2H"),
    ).toBe(5);
  });

  it("throws SportsDataNotFoundError for unknown name", () => {
    expect(() =>
      resolveTeamId("Definitely Not A Team", "brasileirao_a", "getH2H"),
    ).toThrow(SportsDataNotFoundError);
  });
});

describe("getInjuries methods throw SportsDataUnsupportedError", () => {
  it("getInjuriesByFixture", async () => {
    const a = new FootballDataOrgAdapter();
    await expect(
      a.getInjuriesByFixture({
        league: "brasileirao_a",
        kickoffAt: "2026-05-16T22:00:00.000Z",
        homeTeam: "Fluminense FC",
        awayTeam: "São Paulo FC",
      }),
    ).rejects.toThrow(SportsDataUnsupportedError);
  });

  it("getInjuriesByTeam", async () => {
    const a = new FootballDataOrgAdapter();
    await expect(
      a.getInjuriesByTeam("SE Palmeiras", "brasileirao_a"),
    ).rejects.toThrow(SportsDataUnsupportedError);
  });
});

// ─── getFixturesBySeason — single competition-matches fetch (season param) ──
// Asserts the adapter issues ONE /competitions/{code}/matches?season call and
// normalizes the result. The v4 `season` filter (confirmed via docs) returns
// the whole competition+season in one shot — no date-window iteration.

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("FootballDataOrgAdapter.getFixturesBySeason", () => {
  const ORIGINAL_KEY = process.env.FOOTBALL_DATA_ORG_API_KEY;
  // brasileirao_a calendar-year season: May 2026 → currentSeason returns 2026.
  const cacheKey =
    "sports-data:football-data-org:competitions:BSA:matches:season:2026";

  beforeEach(async () => {
    process.env.FOOTBALL_DATA_ORG_API_KEY = "test-key";
    await inMemoryCache.delete(cacheKey);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (ORIGINAL_KEY === undefined) delete process.env.FOOTBALL_DATA_ORG_API_KEY;
    else process.env.FOOTBALL_DATA_ORG_API_KEY = ORIGINAL_KEY;
  });

  it("issues a SINGLE competition-matches call with season and normalizes", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ matches: [makeMatch()] }));

    const a = new FootballDataOrgAdapter();
    const fixtures = await a.getFixturesBySeason("brasileirao_a");

    // Exactly one HTTP call — the whole-competition fetch, not day-by-day.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchSpy.mock.calls[0]![0]);
    expect(calledUrl).toContain("/competitions/BSA/matches");
    expect(calledUrl).toContain("season=2026");
    // Season-wide variant: no date window.
    expect(calledUrl).not.toContain("dateFrom=");
    expect(calledUrl).not.toContain("dateTo=");

    // Output is normalized through the same toNormalizedFixture path.
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]).toEqual(
      toNormalizedFixture(makeMatch(), "brasileirao_a"),
    );
  });

  it("honors an explicit season override on the query", async () => {
    const overrideKey =
      "sports-data:football-data-org:competitions:BSA:matches:season:2024";
    await inMemoryCache.delete(overrideKey);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ matches: [] }));

    const a = new FootballDataOrgAdapter();
    await a.getFixturesBySeason("brasileirao_a", 2024);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("season=2024");
  });
});

describe("cache key format", () => {
  it("uses sports-data:football-data-org: prefix and sorts params", () => {
    expect(buildCacheKey("/competitions/BSA/matches", { dateTo: "X", dateFrom: "Y" })).toBe(
      "sports-data:football-data-org:competitions:BSA:matches:dateFrom:Y:dateTo:X",
    );
  });

  it("produces same key for getH2H and getTeamForm on /teams/X/matches", () => {
    // Cache-share assertion: both methods generate the same cache key for the
    // same {teamId, status, limit} combo, so the second caller is a hit.
    const k1 = buildCacheKey("/teams/123/matches", {
      status: "FINISHED",
      limit: 50,
    });
    const k2 = buildCacheKey("/teams/123/matches", {
      limit: 50,
      status: "FINISHED",
    });
    expect(k1).toBe(k2);
    expect(k1).toBe(
      "sports-data:football-data-org:teams:123:matches:limit:50:status:FINISHED",
    );
  });
});
