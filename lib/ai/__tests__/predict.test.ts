import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SportsDataNotFoundError,
  SportsDataTransientError,
  SportsDataUnsupportedError,
  type FixtureRef,
  type NormalizedFixture,
  type NormalizedLineup,
  type NormalizedStanding,
  type ProviderCapabilities,
  type SportsDataProvider,
} from "@/lib/providers/sports-data/types";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type { OddsApiEventOdds } from "@/lib/providers/odds-api-schemas";

// ─── Module mocks (every external boundary predict() touches) ────────────────
//
// No real DB / Anthropic / HTTP is hit. predict.ts is the sole LLM entrypoint,
// so we stub getAnthropicClient (no ANTHROPIC_API_KEY needed) and the two
// provider boundaries (sports-data + odds-api). The db mock returns a single
// analyzable match for the lookup and stub rows for the two inserts.

const matchRow = {
  id: "m-1",
  externalId: "ext-1",
  league: "brasileirao_a" as SupportedLeague,
  homeTeam: "CR Flamengo",
  awayTeam: "Fluminense FC",
  kickoffAt: new Date("2026-05-15T19:00:00.000Z"),
  status: "scheduled" as const,
  homeScore: null,
  awayScore: null,
  updatedAt: new Date("2026-05-01T00:00:00.000Z"),
};

// Chainable db stub: select().from().where().limit() resolves [matchRow];
// insert().values().returning() resolves a stub row (ai_call then prediction).
vi.mock("@/lib/db", () => {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve([matchRow])),
      })),
    })),
  }));
  const insert = vi.fn(() => ({
    values: vi.fn(() => ({
      returning: vi.fn(() =>
        Promise.resolve([{ id: "row-1", aiCallId: "row-1" }]),
      ),
    })),
  }));
  return { db: { select, insert } };
});

const getInjuriesByFixture = vi.fn();
const getTeamForm = vi.fn();
const getH2H = vi.fn();
const getStandings = vi.fn();
const getLineups = vi.fn();
const getFixtureByMatch = vi.fn();

vi.mock("@/lib/providers/sports-data", () => ({
  getSportsDataProvider: vi.fn((): SportsDataProvider => {
    const capabilities: ProviderCapabilities = {
      name: "mock",
      supportsInjuries: true,
      supportsLineups: true,
      supportedLeagues: new Set<SupportedLeague>(["brasileirao_a"]),
    };
    return {
      capabilities,
      getFixturesByDate: vi.fn() as never,
      getFixtureByMatch: getFixtureByMatch as never,
      getFixtureResult: vi.fn() as never,
      getH2H: getH2H as never,
      getStandings: getStandings as never,
      getInjuriesByFixture: getInjuriesByFixture as never,
      getInjuriesByTeam: vi.fn() as never,
      getLineups: getLineups as never,
      getTeamForm: getTeamForm as never,
    };
  }),
}));

const getOddsForSport = vi.fn();
vi.mock("@/lib/providers/odds-api", () => ({
  getOddsForSport: (...args: unknown[]) => getOddsForSport(...args),
}));

const anthropicCreate = vi.fn();
vi.mock("@/lib/ai/anthropic", () => ({
  ANTHROPIC_MODEL: "claude-sonnet-4-5-20250929",
  getAnthropicClient: () => ({ messages: { create: anthropicCreate } }),
}));

// Spy on buildPredictionInput while keeping the real implementation (and
// BuildInputError) so we can assert the absencesAvailable flag it receives.
import * as buildInputModule from "@/lib/ai/build-input";

import { predict } from "@/lib/ai/predict";

// ─── Fixtures for the happy-path mocks ───────────────────────────────────────

const REF: FixtureRef = {
  league: "brasileirao_a",
  kickoffAt: matchRow.kickoffAt.toISOString(),
  homeTeam: matchRow.homeTeam,
  awayTeam: matchRow.awayTeam,
};

const FIXTURE: NormalizedFixture = {
  id: `brasileirao_a:${REF.kickoffAt}:${REF.homeTeam}:${REF.awayTeam}`,
  league: "brasileirao_a",
  kickoffAt: REF.kickoffAt,
  kickoffTimestampMs: matchRow.kickoffAt.getTime(),
  homeTeam: matchRow.homeTeam,
  awayTeam: matchRow.awayTeam,
  status: "scheduled",
  score: { home: null, away: null },
  venue: "Maracanã",
};

// Standings MUST contain rows for both teams or buildPredictionInput throws
// BuildInputError before any LLM call.
const STANDINGS: NormalizedStanding = {
  league: "brasileirao_a",
  season: 2026,
  tables: [
    {
      teams: [
        {
          position: 1,
          team: matchRow.homeTeam,
          played: 10,
          won: 6,
          draw: 2,
          lost: 2,
          goalsFor: 18,
          goalsAgainst: 9,
          points: 20,
        },
        {
          position: 2,
          team: matchRow.awayTeam,
          played: 10,
          won: 5,
          draw: 3,
          lost: 2,
          goalsFor: 15,
          goalsAgainst: 10,
          points: 18,
        },
      ],
    },
  ],
};

const LINEUPS: NormalizedLineup | undefined = undefined;

// One odds event matching the team names within ODDS_WINDOW_MS of kickoff,
// carrying a totals market with over/under 2.5 so pickBestTotalsBookmaker
// returns a bundle.
const ODDS_EVENT: OddsApiEventOdds = {
  id: "evt-1",
  sport_key: "soccer_brazil_campeonato",
  commence_time: REF.kickoffAt,
  home_team: matchRow.homeTeam,
  away_team: matchRow.awayTeam,
  bookmakers: [
    {
      key: "pinnacle",
      title: "Pinnacle",
      last_update: "2026-05-15T12:00:00Z",
      markets: [
        {
          key: "totals",
          last_update: "2026-05-15T12:00:00Z",
          outcomes: [
            { name: "Over", price: 1.9, point: 2.5 },
            { name: "Under", price: 1.95, point: 2.5 },
          ],
        },
      ],
    },
  ],
};

// Anthropic.Message-shaped response with a tool_use block whose input
// satisfies OverUnderOutputSchema.
function anthropicMessage() {
  return {
    id: "msg-1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-5-20250929",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [
      {
        type: "tool_use",
        id: "tu-1",
        name: "submit_prediction",
        input: {
          recommendation: "over",
          confidence_pct: 60,
          rationale: "Both teams score freely; weak defenses.",
          key_factors: ["high xG", "leaky defenses"],
          minimum_odd: 1.8,
        },
      },
    ],
    usage: { input_tokens: 1200, output_tokens: 300 },
  };
}

// Wires every happy-path mock. Individual tests override one spy to inject the
// failure under test.
function setHappyPath() {
  getFixtureByMatch.mockResolvedValue(FIXTURE);
  getTeamForm.mockResolvedValue([]);
  getH2H.mockResolvedValue([]);
  getStandings.mockResolvedValue(STANDINGS);
  getInjuriesByFixture.mockResolvedValue({ home: [], away: [] });
  getLineups.mockResolvedValue(LINEUPS);
  getOddsForSport.mockResolvedValue([ODDS_EVENT]);
  anthropicCreate.mockResolvedValue(anthropicMessage());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  setHappyPath();
});

describe("predict() — graceful degrade on transient injuries error", () => {
  it("baseline: happy path resolves and calls Anthropic", async () => {
    const spy = vi.spyOn(buildInputModule, "buildPredictionInput");
    await expect(predict({ matchId: "m-1", userId: "u-1" })).resolves.toEqual({
      id: "row-1",
      aiCallId: "row-1",
    });
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0].home.absencesAvailable).toBe(true);
    expect(spy.mock.calls[0]?.[0].away.absencesAvailable).toBe(true);
  });

  it("Test A: transient injuries error degrades to absencesAvailable=false and proceeds", async () => {
    getInjuriesByFixture.mockRejectedValueOnce(
      new SportsDataTransientError(
        "api-football down",
        "api-football",
        "getInjuriesByFixture",
        new Error("503"),
      ),
    );
    const spy = vi.spyOn(buildInputModule, "buildPredictionInput");

    await expect(
      predict({ matchId: "m-1", userId: "u-1" }),
    ).resolves.toBeDefined();

    const args = spy.mock.calls[0]?.[0];
    expect(args?.home.absencesAvailable).toBe(false);
    expect(args?.away.absencesAvailable).toBe(false);
    // Degraded payload forwarded to buildPredictionInput is the empty shape.
    expect(args?.home.injuries).toEqual([]);
    expect(args?.away.injuries).toEqual([]);
    // Analysis proceeded: the paid LLM call still happened.
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
  });

  it("Test C (regression): unsupported injuries error still degrades to absencesAvailable=false", async () => {
    getInjuriesByFixture.mockRejectedValueOnce(
      new SportsDataUnsupportedError(
        "no injury endpoint",
        "football-data-org",
        "getInjuriesByFixture",
      ),
    );
    const spy = vi.spyOn(buildInputModule, "buildPredictionInput");

    await expect(
      predict({ matchId: "m-1", userId: "u-1" }),
    ).resolves.toBeDefined();

    const args = spy.mock.calls[0]?.[0];
    expect(args?.home.absencesAvailable).toBe(false);
    expect(args?.away.absencesAvailable).toBe(false);
    // Degraded payload forwarded to buildPredictionInput is the empty shape.
    expect(args?.home.injuries).toEqual([]);
    expect(args?.away.injuries).toEqual([]);
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
  });
});

describe("predict() — transient error on a CRITICAL fetch is NOT over-caught", () => {
  it("Test B: transient error on getTeamForm rejects predict() with no paid LLM call", async () => {
    getTeamForm.mockRejectedValue(
      new SportsDataTransientError(
        "api-football down",
        "api-football",
        "getTeamForm",
        new Error("503"),
      ),
    );

    await expect(predict({ matchId: "m-1", userId: "u-1" })).rejects.toThrow(
      SportsDataTransientError,
    );
    // No paid LLM call when a required fetch fails (cost safety).
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("Test B': transient error on getStandings also rejects predict() with no paid LLM call", async () => {
    getStandings.mockRejectedValue(
      new SportsDataTransientError(
        "api-football down",
        "api-football",
        "getStandings",
        new Error("503"),
      ),
    );

    await expect(predict({ matchId: "m-1", userId: "u-1" })).rejects.toThrow(
      SportsDataTransientError,
    );
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("Test D: a NON-degradeable injuries error (SportsDataNotFoundError) bubbles up and does NOT call the LLM", async () => {
    // The injuries catch maps ONLY SportsDataTransientError and
    // SportsDataUnsupportedError to the degraded signal; every other error must
    // re-throw (reject predict) and never reach the paid LLM call. This pins the
    // `throw err` branch so broadening the catch to swallow all errors regresses.
    getInjuriesByFixture.mockRejectedValue(
      new SportsDataNotFoundError(
        "fixture has no injury entity",
        "api-football",
        "getInjuriesByFixture",
      ),
    );

    await expect(predict({ matchId: "m-1", userId: "u-1" })).rejects.toThrow(
      SportsDataNotFoundError,
    );
    // No degrade, no analysis: the paid LLM call must not happen.
    expect(anthropicCreate).not.toHaveBeenCalled();
  });
});
