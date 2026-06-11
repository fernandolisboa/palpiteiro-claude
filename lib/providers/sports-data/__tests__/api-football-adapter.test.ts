import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inMemoryCache } from "@/lib/cache/in-memory";
import { ApiFootballAdapter, __testing } from "@/lib/providers/sports-data/api-football/adapter";
import {
  ApiFootballHttpError,
  ApiFootballSchemaError,
  ApiFootballTimeoutError,
} from "@/lib/providers/sports-data/api-football/errors";
import type {
  ApiFootballFixture,
  ApiFootballInjury,
  ApiFootballLineup,
  ApiFootballStandings,
} from "@/lib/providers/sports-data/api-football/schemas";
import { StandingsItemSchema } from "@/lib/providers/sports-data/api-football/schemas";
import { API_FOOTBALL_TEAM_IDS } from "@/lib/providers/sports-data/api-football/team-ids";
import {
  SportsDataNotFoundError,
  SportsDataTransientError,
  SportsDataUnsupportedError,
  type FixtureRef,
} from "@/lib/providers/sports-data/types";

const {
  toNormalizedFixture,
  toNormalizedFixtureResult,
  toNormalizedStanding,
  toNormalizedInjury,
  toNormalizedTeamLineup,
  mapStatusToNormalized,
  resolveApiFootballTeamId,
  seasonForApiFootballLeagueId,
  wrapApiFootballError,
} = __testing;

// ─── Synthetic API-Football payloads ────────────────────────────────────────

function makeFixture(overrides: Partial<ApiFootballFixture> = {}): ApiFootballFixture {
  const defaults: ApiFootballFixture = {
    fixture: {
      id: 12345,
      date: "2026-05-15T19:00:00+00:00",
      timestamp: Math.floor(Date.parse("2026-05-15T19:00:00Z") / 1000),
      timezone: "UTC",
      status: { long: "Not Started", short: "NS", elapsed: null },
      venue: { id: 1, name: "Maracanã", city: "Rio de Janeiro" },
    },
    league: {
      id: 71,
      name: "Serie A",
      country: "Brazil",
      season: 2026,
      round: "Regular Season - 5",
    },
    teams: {
      home: { id: 127, name: "Flamengo", winner: null },
      away: { id: 124, name: "Fluminense", winner: null },
    },
    goals: { home: null, away: null },
    score: {
      halftime: { home: null, away: null },
      fulltime: { home: null, away: null },
      extratime: null,
      penalty: null,
    },
  };
  return { ...defaults, ...overrides };
}

// ─── Normalization helpers ──────────────────────────────────────────────────

describe("mapStatusToNormalized", () => {
  it("scheduled codes map to scheduled", () => {
    expect(mapStatusToNormalized("NS")).toBe("scheduled");
    expect(mapStatusToNormalized("TBD")).toBe("scheduled");
  });
  it("live codes map to live", () => {
    expect(mapStatusToNormalized("1H")).toBe("live");
    expect(mapStatusToNormalized("2H")).toBe("live");
    expect(mapStatusToNormalized("HT")).toBe("live");
  });
  it("finished codes map to finished", () => {
    expect(mapStatusToNormalized("FT")).toBe("finished");
    expect(mapStatusToNormalized("AET")).toBe("finished");
  });
  it("postponed / cancelled map correctly", () => {
    expect(mapStatusToNormalized("PST")).toBe("postponed");
    expect(mapStatusToNormalized("CANC")).toBe("cancelled");
    expect(mapStatusToNormalized("ABD")).toBe("cancelled");
  });
});

describe("toNormalizedFixture", () => {
  it("produces a composite id and canonical team names", () => {
    const f = makeFixture();
    const n = toNormalizedFixture(f, "brasileirao_a");
    expect(n.id).toBe(
      "brasileirao_a:2026-05-15T19:00:00.000Z:CR Flamengo:Fluminense FC",
    );
    expect(n.league).toBe("brasileirao_a");
    expect(n.homeTeam).toBe("CR Flamengo");
    expect(n.awayTeam).toBe("Fluminense FC");
    expect(n.status).toBe("scheduled");
    expect(n.venue).toBe("Maracanã");
    expect(n.score).toEqual({ home: null, away: null });
    expect(n.kickoffTimestampMs).toBe(
      Date.parse("2026-05-15T19:00:00Z"),
    );
  });

  it("passes through provider team name when no canonical match exists", () => {
    const f = makeFixture({
      teams: {
        home: { id: 99, name: "MysteryTeamThatDoesNotMatchAnyCanonical", winner: null },
        away: { id: 124, name: "Fluminense", winner: null },
      },
    });
    const n = toNormalizedFixture(f, "brasileirao_a");
    expect(n.homeTeam).toBe("MysteryTeamThatDoesNotMatchAnyCanonical");
    expect(n.awayTeam).toBe("Fluminense FC");
  });
});

describe("toNormalizedFixtureResult", () => {
  it("uses score.fulltime (90'), ignoring extra time on knockouts", () => {
    // A knockout that went to extra time: goals (final) = 3-2 incl. ET, but the
    // 90' regulation score was 1-1 → over/under must settle on 1-1 (2 goals).
    const f = makeFixture({
      fixture: {
        id: 999,
        date: "2026-07-10T19:00:00+00:00",
        timestamp: Math.floor(Date.parse("2026-07-10T19:00:00Z") / 1000),
        timezone: "UTC",
        status: { long: "Match Finished After Extra Time", short: "AET", elapsed: 120 },
        venue: { id: 1, name: "Stadium", city: "City" },
      },
      goals: { home: 3, away: 2 },
      score: {
        halftime: { home: 0, away: 1 },
        fulltime: { home: 1, away: 1 },
        extratime: { home: 2, away: 1 },
        penalty: null,
      },
    });
    const r = toNormalizedFixtureResult(f);
    expect(r.status).toBe("finished");
    expect(r.regulationScore).toEqual({ home: 1, away: 1 });
  });

  it("returns null regulationScore when the 90' score isn't available yet", () => {
    const r = toNormalizedFixtureResult(makeFixture());
    expect(r.status).toBe("scheduled");
    expect(r.regulationScore).toBeNull();
  });
});

// ─── Standings normalization ────────────────────────────────────────────────

function makeStandings(): ApiFootballStandings {
  return {
    league: {
      id: 71,
      name: "Serie A",
      country: "Brazil",
      season: 2026,
      standings: [
        [
          {
            rank: 1,
            team: { id: 127, name: "Flamengo" },
            points: 30,
            goalsDiff: 15,
            group: "Serie A",
            form: "WWDWW",
            status: "same",
            description: null,
            all: { played: 12, win: 9, draw: 3, lose: 0, goals: { for: 25, against: 10 } },
            home: { played: 6, win: 5, draw: 1, lose: 0, goals: { for: 15, against: 5 } },
            away: { played: 6, win: 4, draw: 2, lose: 0, goals: { for: 10, against: 5 } },
            update: "2026-05-13T00:00:00+00:00",
          },
        ],
      ],
    },
  };
}

describe("toNormalizedStanding", () => {
  it("normalizes a single-table standing", () => {
    const s = toNormalizedStanding(makeStandings(), "brasileirao_a");
    expect(s.league).toBe("brasileirao_a");
    expect(s.tables).toHaveLength(1);
    const first = s.tables[0]!;
    expect(first.group).toBe("Serie A");
    expect(first.teams).toHaveLength(1);
    expect(first.teams[0]).toMatchObject({
      position: 1,
      team: "CR Flamengo",
      played: 12,
      won: 9,
      draw: 3,
      lost: 0,
      goalsFor: 25,
      goalsAgainst: 10,
      points: 30,
    });
    expect(first.teams[0]?.homeSplit).toEqual({
      played: 6,
      wins: 5,
      draws: 1,
      losses: 0,
      goalsFor: 15,
      goalsAgainst: 5,
    });
  });
});

// ─── Standings normalization — World Cup groups ─────────────────────────────

function makeWorldCupStandings(): ApiFootballStandings {
  type Row = ApiFootballStandings["league"]["standings"][number][number];
  const row = (rank: number, name: string, group: string): Row => ({
    rank,
    team: { id: rank, name },
    points: 0,
    goalsDiff: 0,
    group,
    form: null,
    status: "same",
    description: null,
    all: { played: 0, win: 0, draw: 0, lose: 0, goals: { for: 0, against: 0 } },
    // Real WC payload: neutral-venue / pre-tournament → null home/away splits.
    home: {
      played: null,
      win: null,
      draw: null,
      lose: null,
      goals: { for: null, against: null },
    },
    away: {
      played: null,
      win: null,
      draw: null,
      lose: null,
      goals: { for: null, against: null },
    },
    update: "2026-06-11T00:00:00+00:00",
  });
  return {
    league: {
      id: 1,
      name: "World Cup",
      country: "World",
      season: 2026,
      standings: [
        [row(1, "Mexico", "Group A"), row(2, "South Africa", "Group A")],
        [row(1, "Brazil", "Group B"), row(2, "Morocco", "Group B")],
        // 2026 format: a 13th table ranking the third-placed teams.
        [row(3, "Mexico", "Ranking of third-placed teams")],
      ],
    },
  };
}

describe("toNormalizedStanding — World Cup groups", () => {
  it("maps each group (incl. the third-placed ranking) to its own table", () => {
    const s = toNormalizedStanding(makeWorldCupStandings(), "world_cup");
    expect(s.league).toBe("world_cup");
    expect(s.tables).toHaveLength(3);
    expect(s.tables.map((t) => t.group)).toEqual([
      "Group A",
      "Group B",
      "Ranking of third-placed teams",
    ]);
    expect(s.tables[0]?.teams.map((t) => t.team)).toEqual([
      "Mexico",
      "South Africa",
    ]);
    // Null home/away splits are omitted (both optional), not emitted as nulls.
    expect(s.tables[0]?.teams[0]?.homeSplit).toBeUndefined();
    expect(s.tables[0]?.teams[0]?.awaySplit).toBeUndefined();
  });

  it("schema accepts null home/away splits (WC neutral-venue payload)", () => {
    const raw = {
      league: {
        id: 1,
        name: "World Cup",
        country: "World",
        season: 2026,
        standings: [
          [
            {
              rank: 1,
              team: { id: 16, name: "Mexico" },
              points: 0,
              goalsDiff: 0,
              group: "Group A",
              form: null,
              status: "same",
              description: "Playoffs",
              all: {
                played: 0,
                win: 0,
                draw: 0,
                lose: 0,
                goals: { for: 0, against: 0 },
              },
              home: {
                played: null,
                win: null,
                draw: null,
                lose: null,
                goals: { for: null, against: null },
              },
              away: {
                played: null,
                win: null,
                draw: null,
                lose: null,
                goals: { for: null, against: null },
              },
              update: "2026-05-26T00:00:00+00:00",
            },
          ],
        ],
      },
    };
    expect(() => StandingsItemSchema.parse(raw)).not.toThrow();
  });
});

// ─── Injury normalization ───────────────────────────────────────────────────

function makeInjury(overrides: Partial<ApiFootballInjury["player"]> = {}): ApiFootballInjury {
  return {
    player: {
      id: 1,
      name: "Test Player",
      photo: null,
      type: "Missing Fixture",
      reason: "Knee injury",
      ...overrides,
    },
    team: { id: 127, name: "Flamengo" },
    fixture: { id: 12345 },
    league: { id: 71, season: 2026 },
  };
}

describe("toNormalizedInjury", () => {
  it("maps Missing Fixture + Knee -> injured", () => {
    const n = toNormalizedInjury(makeInjury());
    expect(n).toEqual({
      player: { name: "Test Player" },
      type: "injury",
      reason: "Knee injury",
      status: "injured",
    });
  });
  it("maps Questionable -> doubtful", () => {
    const n = toNormalizedInjury(
      makeInjury({ type: "Questionable", reason: "Doubtful" }),
    );
    expect(n.status).toBe("doubtful");
    expect(n.type).toBe("injury");
  });
  it("maps Card -> suspended (type=suspension)", () => {
    const n = toNormalizedInjury(
      makeInjury({ type: "Missing Fixture", reason: "Red card" }),
    );
    expect(n.status).toBe("suspended");
    expect(n.type).toBe("suspension");
  });
});

// ─── Lineup normalization ───────────────────────────────────────────────────

function makeLineup(): ApiFootballLineup {
  return {
    team: { id: 127, name: "Flamengo" },
    formation: "4-3-3",
    startXI: [
      { player: { id: 1, name: "GK", number: 1, pos: "G", grid: "1:1" } },
      { player: { id: 2, name: "RB", number: 2, pos: "D", grid: "2:4" } },
      { player: { id: 3, name: "CM", number: 8, pos: "M", grid: "3:2" } },
      { player: { id: 4, name: "ST", number: 9, pos: "F", grid: "4:2" } },
    ],
    substitutes: [
      { player: { id: 11, name: "Sub1", number: 12, pos: null, grid: null } },
    ],
    coach: null,
  };
}

describe("toNormalizedTeamLineup", () => {
  it("normalizes starters with role labels and bench", () => {
    const t = toNormalizedTeamLineup(makeLineup(), "brasileirao_a");
    expect(t.team).toBe("CR Flamengo");
    expect(t.formation).toBe("4-3-3");
    expect(t.starters).toHaveLength(4);
    expect(t.starters[0]).toEqual({ name: "GK", shirtNumber: 1, position: "GK" });
    expect(t.starters[1]).toEqual({ name: "RB", shirtNumber: 2, position: "DEF" });
    expect(t.starters[2]).toEqual({ name: "CM", shirtNumber: 8, position: "MID" });
    expect(t.starters[3]).toEqual({ name: "ST", shirtNumber: 9, position: "FWD" });
    expect(t.bench).toHaveLength(1);
    expect(t.bench?.[0]?.position).toBeUndefined();
  });
});

// ─── Error mapping ──────────────────────────────────────────────────────────

describe("wrapApiFootballError", () => {
  const ctx = { hint: "test" };

  it("maps 5xx HTTP -> SportsDataTransientError", () => {
    const err = new ApiFootballHttpError(
      "Transient",
      "/fixtures",
      { date: "2026-05-15" },
      503,
      "Service Unavailable",
    );
    expect(() => wrapApiFootballError(err, "getFixturesByDate", ctx)).toThrow(
      SportsDataTransientError,
    );
  });

  it("maps 404 HTTP -> SportsDataNotFoundError (no cascade)", () => {
    const err = new ApiFootballHttpError(
      "Not found",
      "/fixtures",
      { id: 1 },
      404,
      "Not Found",
    );
    expect(() => wrapApiFootballError(err, "getFixtureByMatch", ctx)).toThrow(
      SportsDataNotFoundError,
    );
  });

  it("maps 429 HTTP -> SportsDataTransientError (rate-limited final)", () => {
    const err = new ApiFootballHttpError(
      "Rate limited",
      "/fixtures",
      {},
      429,
      "",
    );
    expect(() => wrapApiFootballError(err, "getH2H", ctx)).toThrow(
      SportsDataTransientError,
    );
  });

  it("maps timeout -> SportsDataTransientError", () => {
    const err = new ApiFootballTimeoutError("/fixtures", {});
    expect(() => wrapApiFootballError(err, "getFixtureByMatch", ctx)).toThrow(
      SportsDataTransientError,
    );
  });

  it("maps schema error -> SportsDataTransientError (provider drift)", async () => {
    const { z } = await import("zod");
    const zodErr = (() => {
      const r = z.string().safeParse(123);
      if (r.success) throw new Error("zod did not fail");
      return r.error;
    })();
    const err = new ApiFootballSchemaError(
      "Schema fail",
      "/fixtures",
      {},
      zodErr,
    );
    expect(() => wrapApiFootballError(err, "getStandings", ctx)).toThrow(
      SportsDataTransientError,
    );
  });

  it("rethrows non-API-Football errors unchanged", () => {
    const original = new TypeError("Network down");
    expect(() => wrapApiFootballError(original, "getH2H", ctx)).toThrow(
      TypeError,
    );
  });
});

// ─── Season helper ──────────────────────────────────────────────────────────
// The adapter's free `getFixturesByDate` falls back to the per-league season
// logic in leagues.ts (Brasileirão calendar-year, Champions cross-year) via
// `seasonForApiFootballLeagueId`. These tests pin the boundary months that
// the previous local `currentSeason(leagueId)` in constants.ts got wrong
// (Jan–Mar for Brasileirão returning current year instead of previous, and
// July for Champions returning current year instead of previous).

describe("seasonForApiFootballLeagueId — Brasileirão (id 71)", () => {
  it("January → previous year (off-season)", () => {
    expect(
      seasonForApiFootballLeagueId(71, new Date("2026-01-15T12:00:00Z")),
    ).toBe(2025);
  });

  it("March → previous year (final off-season month)", () => {
    expect(
      seasonForApiFootballLeagueId(71, new Date("2026-03-31T23:59:59Z")),
    ).toBe(2025);
  });

  it("April → current year (season kicks off)", () => {
    expect(
      seasonForApiFootballLeagueId(71, new Date("2026-04-15T12:00:00Z")),
    ).toBe(2026);
  });
});

describe("seasonForApiFootballLeagueId — Champions League (id 2)", () => {
  it("July → previous year (final off-season month)", () => {
    expect(
      seasonForApiFootballLeagueId(2, new Date("2026-07-15T12:00:00Z")),
    ).toBe(2025);
  });

  it("August → current year (new season starts)", () => {
    expect(
      seasonForApiFootballLeagueId(2, new Date("2026-08-15T12:00:00Z")),
    ).toBe(2026);
  });

  it("January → previous year (season started prior August)", () => {
    expect(
      seasonForApiFootballLeagueId(2, new Date("2026-01-15T12:00:00Z")),
    ).toBe(2025);
  });
});

describe("seasonForApiFootballLeagueId — unmapped id", () => {
  it("throws so callers can't silently use a wrong season", () => {
    expect(() =>
      seasonForApiFootballLeagueId(39, new Date("2026-05-15T12:00:00Z")),
    ).toThrow(/No SupportedLeague mapped/);
  });
});

// ─── Team-ID resolution ──────────────────────────────────────────────────────

describe("resolveApiFootballTeamId", () => {
  it("throws SportsDataTransientError for an unmapped name (cascade signal)", () => {
    expect(() =>
      resolveApiFootballTeamId("Unmapped Test FC", "brasileirao_a", "getH2H"),
    ).toThrow(SportsDataTransientError);
  });

  it("returns the mapped id for a canonical team", () => {
    expect(
      resolveApiFootballTeamId("CR Flamengo", "brasileirao_a", "getH2H"),
    ).toBe(API_FOOTBALL_TEAM_IDS.brasileirao_a["CR Flamengo"]);
  });

  it("throws when the canonical name isn't in the populated map", () => {
    (API_FOOTBALL_TEAM_IDS.brasileirao_a as Record<string, number>)[
      "CR Flamengo"
    ] = 127;
    expect(() =>
      resolveApiFootballTeamId("Unknown FC", "brasileirao_a", "getH2H"),
    ).toThrow(SportsDataTransientError);
  });
});

// ─── ApiFootballAdapter class — capabilities ────────────────────────────────

describe("ApiFootballAdapter capabilities", () => {
  it("name = api-football; injuries + lineups true; all leagues supported", () => {
    const a = new ApiFootballAdapter();
    expect(a.capabilities.name).toBe("api-football");
    expect(a.capabilities.supportsInjuries).toBe(true);
    expect(a.capabilities.supportsLineups).toBe(true);
    expect(a.capabilities.supportedLeagues.has("brasileirao_a")).toBe(true);
    expect(a.capabilities.supportedLeagues.has("champions_league")).toBe(true);
    expect(a.capabilities.supportedLeagues.has("world_cup")).toBe(true);
  });
});

// ─── Adapter methods — mocked via the underlying free functions ─────────────

vi.mock("@/lib/providers/sports-data/api-football/adapter", async (importOriginal) => {
  // Pass-through mock that lets us spy on the free fns from outside while
  // preserving the class definition.
  return await importOriginal();
});

describe("ApiFootballAdapter.getH2H throws when team isn't mapped", () => {
  it("transient error (so FallbackProvider cascades)", async () => {
    const a = new ApiFootballAdapter();
    // Unknown canonical name → resolveTeamId throws Transient (cascade signal).
    await expect(
      a.getH2H("Unmapped Test FC", "Fluminense FC", "brasileirao_a", 5),
    ).rejects.toThrow(SportsDataTransientError);
  });
});

describe("ApiFootballAdapter.getTeamForm throws when team isn't mapped", () => {
  it("transient error", async () => {
    const a = new ApiFootballAdapter();
    await expect(
      a.getTeamForm("Unmapped Test FC", "brasileirao_a", 5),
    ).rejects.toThrow(SportsDataTransientError);
  });
});

describe("ApiFootballAdapter.getInjuriesByTeam throws when team isn't mapped", () => {
  it("transient error", async () => {
    const a = new ApiFootballAdapter();
    await expect(
      a.getInjuriesByTeam("Unmapped Test FC", "brasileirao_a"),
    ).rejects.toThrow(SportsDataTransientError);
  });
});

describe("ApiFootballAdapter — World Cup injuries are Unsupported", () => {
  // API-Football has no injury coverage for any WC edition; surfaced as
  // Unsupported so predict.ts records absences_available=false instead of the
  // empty-list "squad fully fit" path. The guard fires even for mapped teams.
  const a = new ApiFootballAdapter();
  const ref: FixtureRef = {
    league: "world_cup",
    kickoffAt: "2026-06-11T19:00:00.000Z",
    homeTeam: "Mexico",
    awayTeam: "South Africa",
  };

  it("getInjuriesByFixture throws SportsDataUnsupportedError", async () => {
    await expect(a.getInjuriesByFixture(ref)).rejects.toThrow(
      SportsDataUnsupportedError,
    );
  });

  it("getInjuriesByTeam throws SportsDataUnsupportedError", async () => {
    await expect(a.getInjuriesByTeam("Brazil", "world_cup")).rejects.toThrow(
      SportsDataUnsupportedError,
    );
  });
});

// ─── getFixturesBySeason — single competition+season fetch ──────────────────
// Asserts the adapter issues ONE /fixtures?league&season call (no per-day
// iteration) and returns normalized fixtures. We stub global fetch so the
// request layer goes through the real cache/HTTP path but never hits the
// network; the cache key for this league+season is cleared so we observe a
// real fetch, not a cache hit.

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

// Wraps fixtures in the API-Football envelope FixtureEnvelopeSchema requires.
function fixtureEnvelope(response: ApiFootballFixture[]): unknown {
  return {
    get: "fixtures",
    parameters: {},
    errors: [],
    results: response.length,
    paging: { current: 1, total: 1 },
    response,
  };
}

describe("ApiFootballAdapter.getFixturesBySeason", () => {
  const ORIGINAL_KEY = process.env.API_FOOTBALL_KEY;
  // Brasileirão season 2026: deterministic via currentSeasonByLeague (month >= 4
  // in May → 2026). Cache key matches buildCacheKey("/fixtures", {league,season}).
  const cacheKey = "sports-data:api-football:fixtures:league:71:season:2026";

  beforeEach(async () => {
    process.env.API_FOOTBALL_KEY = "test-key";
    await inMemoryCache.delete(cacheKey);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (ORIGINAL_KEY === undefined) delete process.env.API_FOOTBALL_KEY;
    else process.env.API_FOOTBALL_KEY = ORIGINAL_KEY;
  });

  it("issues a SINGLE /fixtures?league&season call and normalizes fixtures", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(fixtureEnvelope([makeFixture()])));

    const a = new ApiFootballAdapter();
    const fixtures = await a.getFixturesBySeason("brasileirao_a");

    // Exactly one HTTP call — the whole-competition fetch, not day-by-day.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchSpy.mock.calls[0]![0]);
    expect(calledUrl).toContain("/fixtures");
    expect(calledUrl).toContain("league=71");
    expect(calledUrl).toContain("season=2026");
    // No date param: this is the season-wide variant, not getFixturesByDate.
    expect(calledUrl).not.toContain("date=");

    // Output is normalized through the same toNormalizedFixture path.
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]).toEqual(
      toNormalizedFixture(makeFixture(), "brasileirao_a"),
    );
  });

  it("honors an explicit season override on the query", async () => {
    const overrideKey = "sports-data:api-football:fixtures:league:71:season:2024";
    await inMemoryCache.delete(overrideKey);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(fixtureEnvelope([])));

    const a = new ApiFootballAdapter();
    await a.getFixturesBySeason("brasileirao_a", 2024);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("season=2024");
  });
});

describe("ApiFootballAdapter.getInjuriesByFixture — logs WARN when fixture not matched", () => {
  const ref: FixtureRef = {
    league: "brasileirao_a",
    kickoffAt: "2026-05-15T19:00:00.000Z",
    homeTeam: "Flamengo",
    awayTeam: "Fluminense FC",
  };

  it("emits injuries_fixture_not_matched and returns empty arrays", async () => {
    const a = new ApiFootballAdapter();
    // getFixtureByMatch returning undefined simulates canonicalization drift
    // (provider name unmapped) — the line-867 silent-return path.
    vi.spyOn(a, "getFixtureByMatch").mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await a.getInjuriesByFixture(ref);

    expect(result).toEqual({ home: [], away: [] });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(payload).toEqual({
      event: "injuries_fixture_not_matched",
      league: "brasileirao_a",
      kickoffAt: "2026-05-15T19:00:00.000Z",
      homeTeam: "Flamengo",
      awayTeam: "Fluminense FC",
    });

    warnSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("emits injuries_fixture_not_matched when the raw re-match misses", async () => {
    // Path 2 (adapter line ~896): getFixtureByMatch succeeds, but the raw
    // getFixturesByDate result has no fixture whose canonicalized team names
    // equal ref.homeTeam/ref.awayTeam, so the native id re-find returns
    // undefined. This is a distinct emission from path 1 — the two log blocks
    // are duplicated inline, so it needs its own coverage.
    //
    // We can't spy on the bare module-level getFixturesByDate the adapter calls
    // internally (ESM same-module binding), so we seed inMemoryCache: the free
    // getFixturesByDate hits the cache first and returns our raw envelope
    // without any HTTP/API key. The clock is pinned so currentSeason (and thus
    // the cache key) is deterministic.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-08T12:00:00.000Z")); // month 6 → season 2026
    const season = 2026;
    const cacheKey = `sports-data:api-football:fixtures:date:2026-05-15:league:71:season:${season}`;
    // Raw fixture whose teams canonicalize to names that do NOT equal the ref,
    // so native.find(...) misses and we fall into the line-896 guard.
    const mismatchedRaw = makeFixture({
      teams: {
        home: { id: 99, name: "Some Other FC", winner: null },
        away: { id: 98, name: "Another Other FC", winner: null },
      },
    });
    await inMemoryCache.set(cacheKey, { response: [mismatchedRaw] }, 60_000);

    const a = new ApiFootballAdapter();
    vi.spyOn(a, "getFixtureByMatch").mockResolvedValue(
      toNormalizedFixture(makeFixture(), "brasileirao_a"),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await a.getInjuriesByFixture(ref);

    expect(result).toEqual({ home: [], away: [] });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(warnSpy.mock.calls[0]![0] as string);
    expect(payload).toEqual({
      event: "injuries_fixture_not_matched",
      league: "brasileirao_a",
      kickoffAt: "2026-05-15T19:00:00.000Z",
      homeTeam: "Flamengo",
      awayTeam: "Fluminense FC",
    });

    await inMemoryCache.delete(cacheKey);
    warnSpy.mockRestore();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
});
