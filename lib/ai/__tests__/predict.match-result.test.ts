import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type FixtureRef,
  type NormalizedFixture,
  type NormalizedLineup,
  type NormalizedStanding,
  type ProviderCapabilities,
  type SportsDataProvider,
} from "@/lib/providers/sports-data/types";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type { OddsApiEventOdds } from "@/lib/providers/odds-api-schemas";

// ─── Module mocks (mirrors predict.test.ts; no real DB/Anthropic/HTTP) ───────

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

const insertValues = vi.fn();
vi.mock("@/lib/db", () => {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve([matchRow])),
      })),
    })),
  }));
  const insert = vi.fn(() => ({
    values: (...args: unknown[]) => {
      insertValues(...args);
      return {
        returning: vi.fn(() =>
          Promise.resolve([{ id: "row-1", aiCallId: "row-1" }]),
        ),
      };
    },
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
      getFixturesBySeason: vi.fn() as never,
      getFixtureByMatch: getFixtureByMatch as never,
      getFixtureResult: vi.fn() as never,
      getFixtureEvents: vi.fn() as never,
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

const getLatestFreshSelectionOddsSnapshots = vi.fn();
vi.mock("@/lib/db/queries/odds-snapshots", () => ({
  getLatestFreshSelectionOddsSnapshots: (...args: unknown[]) =>
    getLatestFreshSelectionOddsSnapshots(...args),
}));

const resolveMarketCatalog = vi.fn();
vi.mock("@/lib/db/queries/market-catalog", () => ({
  resolveMarketCatalog: (...args: unknown[]) => resolveMarketCatalog(...args),
}));

const anthropicCreate = vi.fn();
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({ messages: { create: anthropicCreate } }),
}));

const getDefaultModelId = vi.fn();
const getGenerationParams = vi.fn();
vi.mock("@/lib/db/queries/ai-config", () => ({
  getDefaultModelId: (...args: unknown[]) => getDefaultModelId(...args),
  getGenerationParams: (...args: unknown[]) => getGenerationParams(...args),
}));

const getPreferredModelId = vi.fn();
vi.mock("@/lib/db/queries/users", () => ({
  getPreferredModelId: (...args: unknown[]) => getPreferredModelId(...args),
}));

import { matchResultCartridge } from "@/lib/ai/markets/match_result";
import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";
import { predict } from "@/lib/ai/predict";

// ─── Fixtures ────────────────────────────────────────────────────────────────

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

// h2h event carrying a 3-way (h2h) market for the fallback path.
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
          key: "h2h",
          last_update: "2026-05-15T12:00:00Z",
          outcomes: [
            { name: "CR Flamengo", price: 1.85 },
            { name: "Fluminense FC", price: 4.2 },
            { name: "Draw", price: 3.5 },
          ],
        },
      ],
    },
  ],
};

// Fresh N-way (3-selection) capture; odds are STRINGS (numeric → string in Drizzle).
function freshSnapshot3Way(
  homeOdd = "1.850",
  drawOdd = "3.500",
  awayOdd = "4.200",
) {
  return {
    bookmaker: "Pinnacle",
    capturedAt: new Date(),
    overroundPct: "4.00",
    selections: [
      { key: "home", odd: homeOdd },
      { key: "draw", odd: drawOdd },
      { key: "away", odd: awayOdd },
    ],
  };
}

function anthropicMessage(input: Record<string, unknown>) {
  return {
    id: "msg-1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-5-20250929",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [
      { type: "tool_use", id: "tu-1", name: "submit_prediction", input },
    ],
    usage: { input_tokens: 1200, output_tokens: 300 },
  };
}

const HOME_OUTPUT = {
  recommendation: "home",
  confidence_pct: 58,
  prob_home: 58,
  prob_draw: 25,
  prob_away: 17,
  rationale: "Mandante forte joga em casa contra um visitante irregular.",
  key_factors: ["mando de campo", "forma recente superior"],
  minimum_odd: 1.6,
};

// catalog 3-vias (home/draw/away).
function catalog3Way() {
  return {
    marketId: "mkt-mr",
    idByKey: new Map([
      ["home", "sel-home"],
      ["draw", "sel-draw"],
      ["away", "sel-away"],
    ]),
    keyById: new Map([
      ["sel-home", "home"],
      ["sel-draw", "draw"],
      ["sel-away", "away"],
    ]),
  };
}

function setHappyPath() {
  getFixtureByMatch.mockResolvedValue(FIXTURE);
  getTeamForm.mockResolvedValue([]);
  getH2H.mockResolvedValue([]);
  getStandings.mockResolvedValue(STANDINGS);
  getInjuriesByFixture.mockResolvedValue({ home: [], away: [] });
  getLineups.mockResolvedValue(LINEUPS);
  getOddsForSport.mockResolvedValue([ODDS_EVENT]);
  getLatestFreshSelectionOddsSnapshots.mockResolvedValue(freshSnapshot3Way());
  resolveMarketCatalog.mockResolvedValue(catalog3Way());
  getDefaultModelId.mockResolvedValue("claude-opus-4-8");
  getGenerationParams.mockResolvedValue({
    maxTokens: 16000,
    effort: "high",
    temperature: 0.3,
  });
  getPreferredModelId.mockResolvedValue(null);
  anthropicCreate.mockResolvedValue(anthropicMessage(HOME_OUTPUT));
}

beforeEach(() => {
  // #231: predict tem backstop hasKey() (client mockado → só a PRESENÇA importa).
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  vi.clearAllMocks();
  vi.restoreAllMocks();
  setHappyPath();
});

// implied normalizada de uma seleção, na MESMA ordem do predict (probs[idx]*100).
function impliedPctOf(
  home: number,
  draw: number,
  away: number,
  side: "home" | "draw" | "away",
) {
  const { probs } = computeMarketImpliedProbabilities([home, draw, away]);
  const idx = side === "home" ? 0 : side === "draw" ? 1 : 2;
  return probs[idx] * 100;
}

describe("predict(match_result) — 3-way happy path through the generic path", () => {
  it("returns the N-way carrier (3 selections) with model probs + odds", async () => {
    const spy = vi.spyOn(matchResultCartridge, "buildPredictionInput");
    const result = await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "match_result",
    });

    expect(result.prediction).toEqual({ id: "row-1", aiCallId: "row-1" });
    expect(result.marketKey).toBe("match_result");
    // 3 selections carry the model distribution + frozen odds.
    expect(result.selections).toEqual([
      { key: "home", modelProbPct: 58, odd: 1.85 },
      { key: "draw", modelProbPct: 25, odd: 3.5 },
      { key: "away", modelProbPct: 17, odd: 4.2 },
    ]);
    // Generic dispatch happened exactly once (the cartridge was resolved).
    expect(spy).toHaveBeenCalledTimes(1);
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
  });

  it("legacy-write skipped: market NULL + over/under odds NULL; marketId/selectionId set", async () => {
    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: true,
        marketKey: "match_result",
      }),
    ).resolves.toBeDefined();

    // insertValues[0] = ai_calls; [1] = predictions; [2] = PSO rows.
    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    // 1X2 carries no line.
    expect(predictionRow.marketParams).toBeNull();
    // Source-of-truth columns are set (generic).
    expect(predictionRow.marketId).toBe("mkt-mr");
    expect(predictionRow.selectionId).toBe("sel-home");
    expect(predictionRow.recommendation).toBe("home");
  });

  it("edge computed N-way per recommended selection (home), never 100−x", async () => {
    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: true,
        marketKey: "match_result",
      }),
    ).resolves.toBeDefined();

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    const impliedHome = impliedPctOf(1.85, 3.5, 4.2, "home");
    expect(predictionRow.impliedProbPct).toBe(impliedHome.toFixed(2));
    // edge = prob_home(58) − normalized implied(home). Aqui prob_home === confidence_pct.
    expect(predictionRow.edgePct).toBe((58 - impliedHome).toFixed(2));
    expect(predictionRow.oddAtRecommendation).toBe("1.850");
  });

  it("edge persistido usa selectionProbs(output)[rec] (prob_home), NÃO confidence_pct — casa com a grade N-vias", async () => {
    // confidence_pct ≠ prob_home de propósito: o edge persistido deve sair de
    // prob_home (a MESMA prob por seleção que a grade exibe), não de confidence_pct.
    // Sem o fix, a row gravaria 62−implied e divergiria da grade (60−implied).
    anthropicCreate.mockResolvedValue(
      anthropicMessage({
        ...HOME_OUTPUT,
        confidence_pct: 62,
        prob_home: 60,
        prob_draw: 24,
        prob_away: 16,
      }),
    );
    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: true,
        marketKey: "match_result",
      }),
    ).resolves.toBeDefined();

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    const impliedHome = impliedPctOf(1.85, 3.5, 4.2, "home");
    // edge da prob_home (60), não da confidence_pct (62).
    expect(predictionRow.edgePct).toBe((60 - impliedHome).toFixed(2));
    expect(predictionRow.edgePct).not.toBe((62 - impliedHome).toFixed(2));
    // confidence_pct persistido segue sendo output.confidence_pct (62) — intocado.
    expect(predictionRow.confidencePct).toBe("62.00");
  });

  it("PSO carries model_prob_pct per selection for all 3 selections", async () => {
    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: true,
        marketKey: "match_result",
      }),
    ).resolves.toBeDefined();

    const psoRows = insertValues.mock.calls[2]?.[0] as Array<{
      selectionId: string;
      odd: string;
      modelProbPct: string | null;
    }>;
    expect(psoRows).toHaveLength(3);
    const byId = Object.fromEntries(
      psoRows.map((r) => [r.selectionId, r.modelProbPct]),
    );
    expect(byId["sel-home"]).toBe("58.00");
    expect(byId["sel-draw"]).toBe("25.00");
    expect(byId["sel-away"]).toBe("17.00");
    const odds = Object.fromEntries(psoRows.map((r) => [r.selectionId, r.odd]));
    expect(odds["sel-home"]).toBe("1.850");
    expect(odds["sel-draw"]).toBe("3.500");
    expect(odds["sel-away"]).toBe("4.200");
  });
});

describe("predict(match_result) — pass case", () => {
  it("pass: selectionId null, no edge, PSO still writes all 3 model probs", async () => {
    anthropicCreate.mockResolvedValue(
      anthropicMessage({
        recommendation: "pass",
        confidence_pct: 40,
        prob_home: 40,
        prob_draw: 33,
        prob_away: 27,
        rationale: "Mercado eficiente; nenhum lado com edge claro.",
        key_factors: ["mercado equilibrado", "favoritismo precificado"],
      }),
    );

    const result = await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "match_result",
    });

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(predictionRow.recommendation).toBe("pass");
    expect(predictionRow.selectionId).toBeNull();
    expect(predictionRow.oddAtRecommendation).toBeNull();
    expect(predictionRow.impliedProbPct).toBeNull();
    expect(predictionRow.edgePct).toBeNull();
    expect(predictionRow.minimumOdd).toBeNull();
    // The carrier still exposes the full distribution.
    expect(result.selections.map((s) => s.modelProbPct)).toEqual([40, 33, 27]);

    const psoRows = insertValues.mock.calls[2]?.[0] as Array<{
      modelProbPct: string | null;
    }>;
    expect(psoRows).toHaveLength(3);
    expect(psoRows.map((r) => r.modelProbPct)).toEqual([
      "40.00",
      "33.00",
      "27.00",
    ]);
  });
});

describe("predict(match_result) — complete-seed guard fails before the paid call", () => {
  it("catalog missing the 'away' selection → throws before client.messages.create, 0 inserts", async () => {
    resolveMarketCatalog.mockResolvedValue({
      marketId: "mkt-mr",
      idByKey: new Map([
        ["home", "sel-home"],
        ["draw", "sel-draw"],
      ]), // missing 'away'
      keyById: new Map([
        ["sel-home", "home"],
        ["sel-draw", "draw"],
      ]),
    });

    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: true,
        marketKey: "match_result",
      }),
    ).rejects.toThrow("seedado incompleto");

    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });
});
