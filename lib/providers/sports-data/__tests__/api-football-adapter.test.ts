import { describe, expect, it, vi } from "vitest";

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
