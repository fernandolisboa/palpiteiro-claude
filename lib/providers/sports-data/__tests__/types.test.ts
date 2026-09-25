import { describe, expect, it } from "vitest";

import {
  FixtureRefSchema,
  NormalizedFixtureSchema,
  NormalizedInjurySchema,
  NormalizedLineupSchema,
  NormalizedStandingSchema,
  SportsDataError,
  SportsDataNotFoundError,
  SportsDataTransientError,
  SportsDataUnsupportedError,
  compositeFixtureKey,
} from "@/lib/providers/sports-data/types";

describe("compositeFixtureKey", () => {
  it("formats as `${league}:${kickoffAt}:${home}:${away}`", () => {
    expect(
      compositeFixtureKey({
        league: "brasileirao_a",
        kickoffAt: "2026-05-15T19:00:00Z",
        homeTeam: "Flamengo",
        awayTeam: "Fluminense",
      }),
    ).toBe("brasileirao_a:2026-05-15T19:00:00Z:Flamengo:Fluminense");
  });

  it("produces the same id for the same logical fixture regardless of provider", () => {
    const ref = {
      league: "champions_league" as const,
      kickoffAt: "2026-04-09T19:00:00Z",
      homeTeam: "Real Madrid",
      awayTeam: "Manchester City",
    };
    expect(compositeFixtureKey(ref)).toBe(compositeFixtureKey({ ...ref }));
  });
});

describe("NormalizedFixtureSchema", () => {
  it("accepts a valid fixture", () => {
    const valid = {
      id: "brasileirao_a:2026-05-15T19:00:00Z:Flamengo:Fluminense",
      league: "brasileirao_a",
      kickoffAt: "2026-05-15T19:00:00Z",
      kickoffTimestampMs: Date.parse("2026-05-15T19:00:00Z"),
      homeTeam: "Flamengo",
      awayTeam: "Fluminense",
      status: "scheduled",
      score: { home: null, away: null },
    };
    expect(NormalizedFixtureSchema.parse(valid)).toMatchObject({
      homeTeam: "Flamengo",
      awayTeam: "Fluminense",
    });
  });

  it("rejects an unknown status", () => {
    const bad = {
      id: "x",
      league: "brasileirao_a",
      kickoffAt: "2026-05-15T19:00:00Z",
      kickoffTimestampMs: 0,
      homeTeam: "A",
      awayTeam: "B",
      status: "unknown",
      score: { home: null, away: null },
    };
    expect(NormalizedFixtureSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an unsupported league", () => {
    const bad = {
      id: "x",
      league: "not_a_league",
      kickoffAt: "2026-05-15T19:00:00Z",
      kickoffTimestampMs: 0,
      homeTeam: "A",
      awayTeam: "B",
      status: "scheduled",
      score: { home: null, away: null },
    };
    expect(NormalizedFixtureSchema.safeParse(bad).success).toBe(false);
  });
});

describe("NormalizedStandingSchema", () => {
  it("accepts a standing with a single table (no group)", () => {
    const valid = {
      league: "brasileirao_a",
      season: 2026,
      tables: [
        {
          teams: [
            {
              position: 1,
              team: "Flamengo",
              played: 10,
              won: 7,
              draw: 2,
              lost: 1,
              goalsFor: 20,
              goalsAgainst: 8,
              points: 23,
            },
          ],
        },
      ],
    };
    expect(NormalizedStandingSchema.parse(valid).tables).toHaveLength(1);
  });

  it("accepts a standing with multiple groups (CL group stage)", () => {
    const valid = {
      league: "champions_league",
      season: 2026,
      tables: [
        { group: "A", teams: [] },
        { group: "B", teams: [] },
      ],
    };
    expect(NormalizedStandingSchema.parse(valid).tables).toHaveLength(2);
  });
});

describe("NormalizedInjurySchema", () => {
  it("accepts all three absence states", () => {
    for (const status of ["injured", "suspended", "doubtful"] as const) {
      const valid = {
        player: { name: "Player" },
        type: status === "suspended" ? "suspension" : "injury",
        status,
      };
      expect(NormalizedInjurySchema.parse(valid).status).toBe(status);
    }
  });
});

describe("NormalizedLineupSchema", () => {
  it("does NOT enforce 11-starter constraint (gate happens at AI-input layer)", () => {
    const valid = {
      fixtureId: "x",
      home: { team: "A", starters: [] },
      away: { team: "B", starters: [{ name: "P1" }] },
    };
    expect(NormalizedLineupSchema.parse(valid).away.starters).toHaveLength(1);
  });
});

describe("FixtureRefSchema", () => {
  it("validates a complete ref", () => {
    expect(
      FixtureRefSchema.parse({
        league: "brasileirao_a",
        kickoffAt: "2026-05-15T19:00:00Z",
        homeTeam: "Flamengo",
        awayTeam: "Fluminense",
      }).homeTeam,
    ).toBe("Flamengo");
  });
});

describe("Error hierarchy", () => {
  it("SportsDataTransientError extends SportsDataError", () => {
    const err = new SportsDataTransientError(
      "5xx",
      "api-football",
      "getFixturesByDate",
      new Error("upstream"),
    );
    expect(err).toBeInstanceOf(SportsDataError);
    expect(err).toBeInstanceOf(SportsDataTransientError);
    expect(err.name).toBe("SportsDataTransientError");
    expect(err.providerName).toBe("api-football");
    expect(err.method).toBe("getFixturesByDate");
    expect(err.originalError).toBeInstanceOf(Error);
  });

  it("SportsDataNotFoundError extends SportsDataError and is NOT transient", () => {
    const err = new SportsDataNotFoundError("404", "api-football", "x");
    expect(err).toBeInstanceOf(SportsDataError);
    expect(err).not.toBeInstanceOf(SportsDataTransientError);
  });

  it("SportsDataUnsupportedError extends SportsDataError", () => {
    const err = new SportsDataUnsupportedError(
      "no caps",
      "football-data-org",
      "getInjuriesByFixture",
    );
    expect(err).toBeInstanceOf(SportsDataError);
    expect(err).not.toBeInstanceOf(SportsDataTransientError);
    expect(err).not.toBeInstanceOf(SportsDataNotFoundError);
  });

  it("error context is preserved", () => {
    const err = new SportsDataNotFoundError("not found", "p", "m", {
      fixtureId: "abc",
    });
    expect(err.context).toEqual({ fixtureId: "abc" });
  });
});
