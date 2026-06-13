import Anthropic from "@anthropic-ai/sdk";
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
//
// `insertValues` is a hoisted spy shared across every insert().values() call, so
// tests can read the exact row written to each table. predict() inserts ai_calls
// FIRST, then predictions, then prediction_selection_odds (SEQUENTIAL — #165),
// so insertValues.mock.calls[0] is the ai_call row, [1] the prediction row, and
// [2] the PSO rows array. The returning() stub gives the first two an `id` (the
// ai_call needs `aiCallId` downstream; the prediction row is the resolved value);
// the PSO insert awaits .values() directly (no .returning()).
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

const getLatestFreshOddsSnapshot = vi.fn();
vi.mock("@/lib/db/queries/odds-snapshots", () => ({
  getLatestFreshOddsSnapshot: (...args: unknown[]) =>
    getLatestFreshOddsSnapshot(...args),
}));

// Catalog resolver consolidado (#165): predict() o chama no bloco de reads
// PRÉ-chamada-paga (marketId + selection id↔key). Stub fixo do mercado
// over/under — sem ele, a query de marketSelections (sem .limit()) cairia no
// branch não-awaitable do select stub e estouraria com TypeError.
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

// Spy on buildPredictionInput while keeping the real implementation (and
// BuildInputError) so we can assert the absencesAvailable flag it receives.
// O módulo MOVEU pro cartucho over/under (#165) — predict.ts importa o mesmo
// binding nomeado, então o vi.spyOn deste módulo continua interceptando.
import * as buildInputModule from "@/lib/ai/markets/over_under/build-input";
import { buildPredictionInput } from "@/lib/ai/markets/over_under/build-input";
import { overUnderCartridge } from "@/lib/ai/markets/over_under";
import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";

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

// A persisted snapshot row, mirroring DbOddsSnapshot. Numeric/decimal columns
// come back from Drizzle as JS STRINGS — predict() must Number() them at the
// boundary before any edge math.
const FRESH_SNAPSHOT = {
  id: "snap-1",
  matchId: "m-1",
  bookmaker: "Pinnacle",
  market: "over_under_2_5" as const,
  line: "2.5",
  overOdd: "1.900",
  underOdd: "1.950",
  overroundPct: "3.50",
  capturedAt: new Date(),
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
  // Default: no fresh snapshot, so every existing test keeps exercising the
  // getOddsForSport fallback path unchanged.
  getLatestFreshOddsSnapshot.mockResolvedValue(null);
  // Catálogo over/under resolvido: marketId + os mapas seleção↔id que predict()
  // usa pra selection_id (prediction) e pras rows do candidate set (PSO).
  resolveMarketCatalog.mockResolvedValue({
    marketId: "mkt-ou",
    idByKey: new Map([
      ["over", "sel-over"],
      ["under", "sel-under"],
    ]),
    keyById: new Map([
      ["sel-over", "over"],
      ["sel-under", "under"],
    ]),
  });
  // Default global resolvido pelo DB quando não há override nem preferência.
  getDefaultModelId.mockResolvedValue("claude-opus-4-8");
  getGenerationParams.mockResolvedValue({
    maxTokens: 16000,
    effort: "high",
    temperature: 0.3,
  });
  // Sem preferência por padrão — cada teste que exercita a preferência sobrescreve.
  getPreferredModelId.mockResolvedValue(null);
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
    await expect(predict({ matchId: "m-1", userId: "u-1", isAdmin: false })).resolves.toEqual({
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
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
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
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
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

    await expect(predict({ matchId: "m-1", userId: "u-1", isAdmin: false })).rejects.toThrow(
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

    await expect(predict({ matchId: "m-1", userId: "u-1", isAdmin: false })).rejects.toThrow(
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

    await expect(predict({ matchId: "m-1", userId: "u-1", isAdmin: false })).rejects.toThrow(
      SportsDataNotFoundError,
    );
    // No degrade, no analysis: the paid LLM call must not happen.
    expect(anthropicCreate).not.toHaveBeenCalled();
  });
});

describe("predict() — odds snapshot reuse vs. fallback", () => {
  it("fresh snapshot present → predict uses it and does NOT call getOddsForSport", async () => {
    getLatestFreshOddsSnapshot.mockResolvedValueOnce(FRESH_SNAPSHOT);
    const spy = vi.spyOn(buildInputModule, "buildPredictionInput");

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    // Quota guarantee: the snapshot path skips the Odds API entirely.
    expect(getOddsForSport).not.toHaveBeenCalled();
    expect(anthropicCreate).toHaveBeenCalledTimes(1);

    // Proves Number() conversion of the string columns at the boundary.
    const odds = spy.mock.calls[0]?.[0].odds;
    expect(odds?.over_2_5_decimal).toBe(1.9);
    expect(odds?.under_2_5_decimal).toBe(1.95);
    expect(odds?.bookmaker).toBe("Pinnacle");
  });

  it("no fresh snapshot → predict falls back to getOddsForSport", async () => {
    // setHappyPath default already stubs getLatestFreshOddsSnapshot → null.
    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    expect(getOddsForSport).toHaveBeenCalledTimes(1);
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
  });
});

describe("predict() — congelamento do par de odds na prediction (#104)", () => {
  it("over: persists the frozen pair (toFixed(3)) plus bookmaker alongside the recommended-side columns", async () => {
    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    // insertValues[0] = ai_calls; [1] = predictions.
    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(predictionRow.recommendation).toBe("over");
    expect(predictionRow.overOddAtPrediction).toBe("1.900");
    expect(predictionRow.underOddAtPrediction).toBe("1.950");
    expect(predictionRow.bookmaker).toBe("Pinnacle");
    // Colunas do lado recomendado preservadas (over → odd do over).
    expect(predictionRow.oddAtRecommendation).toBe("1.900");
  });

  it("pass: persists the frozen pair AND bookmaker with null recommended-side columns", async () => {
    // Fixture SEM minimum_odd — o superRefine do OverUnderOutputSchema proíbe
    // minimum_odd quando recommendation é "pass".
    anthropicCreate.mockResolvedValue({
      ...anthropicMessage(),
      content: [
        {
          type: "tool_use",
          id: "tu-1",
          name: "submit_prediction",
          input: {
            recommendation: "pass",
            confidence_pct: 53,
            rationale: "Edge too thin on both sides.",
            key_factors: ["balanced market"],
          },
        },
      ],
    });

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(predictionRow.recommendation).toBe("pass");
    // Par congelado + bookmaker persistidos também em pass (ADR 0012).
    expect(predictionRow.overOddAtPrediction).toBe("1.900");
    expect(predictionRow.underOddAtPrediction).toBe("1.950");
    expect(predictionRow.bookmaker).toBe("Pinnacle");
    // Sem lado recomendado: colunas de recomendação continuam null.
    expect(predictionRow.oddAtRecommendation).toBeNull();
    expect(predictionRow.impliedProbPct).toBeNull();
    expect(predictionRow.edgePct).toBeNull();
    expect(predictionRow.minimumOdd).toBeNull();
  });
});

// ─── Paridade #165: colunas legadas byte-idênticas + colunas novas + PSO ─────

// Snapshot fresco com odds arbitrárias (path conservador reuse) — controla os
// bytes exatos sem depender do fallback de rede.
function freshSnapshotWith(overOdd: string, underOdd: string) {
  return {
    id: "snap-x",
    matchId: "m-1",
    bookmaker: "Pinnacle",
    market: "over_under_2_5" as const,
    line: "2.5",
    overOdd,
    underOdd,
    overroundPct: "3.50",
    capturedAt: new Date(),
  };
}

// Output mockado fixo (sem API paga) com a recomendação e confiança dadas.
function toolUseMessage(input: Record<string, unknown>) {
  return {
    ...anthropicMessage(),
    content: [{ type: "tool_use", id: "tu-1", name: "submit_prediction", input }],
  };
}

// Implícita normalizada do lado, na MESMA ordem de operações do predict
// (probs[idx] * 100), pra comparar o byte do .toFixed(2) gravado.
function impliedPctOf(over: number, under: number, side: "over" | "under") {
  const { probs } = computeMarketImpliedProbabilities([over, under]);
  return (side === "over" ? probs[0] : probs[1]) * 100;
}

describe("predict() — paridade de colunas (#165): legado byte-idêntico + novas + PSO", () => {
  it("over assimétrico (2.10/1.74): legado byte-idêntico + market/selection/params + PSO == par congelado", async () => {
    getLatestFreshOddsSnapshot.mockResolvedValueOnce(
      freshSnapshotWith("2.100", "1.740"),
    );
    anthropicCreate.mockResolvedValue(
      toolUseMessage({
        recommendation: "over",
        confidence_pct: 60,
        rationale: "Jogo aberto.",
        key_factors: ["alto xG", "defesas vazadas"],
        minimum_odd: 1.8,
      }),
    );

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    // Legado byte-idêntico (mesma matemática de implied/edge que predict.ts:367-372).
    const impliedOver = impliedPctOf(2.1, 1.74, "over");
    expect(predictionRow.market).toBe("over_under_2_5");
    expect(predictionRow.recommendation).toBe("over");
    expect(predictionRow.overOddAtPrediction).toBe("2.100");
    expect(predictionRow.underOddAtPrediction).toBe("1.740");
    expect(predictionRow.oddAtRecommendation).toBe("2.100");
    expect(predictionRow.impliedProbPct).toBe(impliedOver.toFixed(2));
    expect(predictionRow.edgePct).toBe((60 - impliedOver).toFixed(2));
    expect(predictionRow.confidencePct).toBe("60.00");
    expect(predictionRow.minimumOdd).toBe("1.800");
    // stake_units fica IMPLÍCITO (default "1" no schema; #167 popula) — predict
    // NÃO grava a coluna.
    expect(predictionRow).not.toHaveProperty("stakeUnits");
    // Colunas NOVAS multi-mercado.
    expect(predictionRow.marketId).toBe("mkt-ou");
    expect(predictionRow.selectionId).toBe("sel-over");
    expect(predictionRow.marketParams).toEqual({ line: 2.5 });

    // PSO: candidate set completo (over+under), odds == par congelado byte-a-byte.
    const psoRows = insertValues.mock.calls[2]?.[0] as Array<{
      predictionId: string;
      selectionId: string;
      odd: string;
    }>;
    expect(psoRows).toHaveLength(2);
    const byKey = Object.fromEntries(
      psoRows.map((r) => [r.selectionId, r.odd]),
    );
    expect(byKey["sel-over"]).toBe(predictionRow.overOddAtPrediction);
    expect(byKey["sel-under"]).toBe(predictionRow.underOddAtPrediction);
    expect(psoRows.every((r) => r.predictionId === "row-1")).toBe(true);
  });

  it("recommendation=under: impliedProbPct/edgePct do lado under byte-idênticos ao legado", async () => {
    getLatestFreshOddsSnapshot.mockResolvedValueOnce(
      freshSnapshotWith("2.100", "1.740"),
    );
    anthropicCreate.mockResolvedValue(
      toolUseMessage({
        recommendation: "under",
        confidence_pct: 58,
        rationale: "Poucos gols esperados.",
        key_factors: ["defesas sólidas", "ritmo baixo"],
        minimum_odd: 1.7,
      }),
    );

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    const impliedUnder = impliedPctOf(2.1, 1.74, "under");
    expect(predictionRow.recommendation).toBe("under");
    expect(predictionRow.selectionId).toBe("sel-under");
    expect(predictionRow.oddAtRecommendation).toBe("1.740");
    expect(predictionRow.impliedProbPct).toBe(impliedUnder.toFixed(2));
    expect(predictionRow.edgePct).toBe((58 - impliedUnder).toFixed(2));
  });

  it("pass: selectionId null + PSO grava AMBAS as seleções do candidate set", async () => {
    getLatestFreshOddsSnapshot.mockResolvedValueOnce(
      freshSnapshotWith("1.900", "1.950"),
    );
    anthropicCreate.mockResolvedValue(
      toolUseMessage({
        recommendation: "pass",
        confidence_pct: 51,
        rationale: "Edge fino dos dois lados.",
        key_factors: ["mercado equilibrado", "dados rasos"],
      }),
    );

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(predictionRow.recommendation).toBe("pass");
    expect(predictionRow.selectionId).toBeNull();
    expect(predictionRow.marketId).toBe("mkt-ou");
    expect(predictionRow.marketParams).toEqual({ line: 2.5 });

    const psoRows = insertValues.mock.calls[2]?.[0] as Array<{
      selectionId: string;
      odd: string;
    }>;
    expect(psoRows).toHaveLength(2);
    const ids = psoRows.map((r) => r.selectionId).sort();
    expect(ids).toEqual(["sel-over", "sel-under"]);
    const byKey = Object.fromEntries(
      psoRows.map((r) => [r.selectionId, r.odd]),
    );
    expect(byKey["sel-over"]).toBe(predictionRow.overOddAtPrediction);
    expect(byKey["sel-under"]).toBe(predictionRow.underOddAtPrediction);
  });

  it("partial PSO failure após prediction commitada: degrada (não-throw), retorna a prediction", async () => {
    getLatestFreshOddsSnapshot.mockResolvedValueOnce(
      freshSnapshotWith("1.900", "1.950"),
    );
    // 3º insert (PSO) falha; os 2 primeiros (ai_calls, predictions) passam.
    let call = 0;
    insertValues.mockImplementation(() => {
      call += 1;
      if (call === 3) throw new Error("PSO write failed");
    });

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toEqual({ id: "row-1", aiCallId: "row-1" });
    // A prediction foi retornada apesar da falha do candidate set.
    expect(insertValues).toHaveBeenCalledTimes(3);
  });
});

describe("predict() — bump over_under_v2.0: prompt/mensagem byte-idênticos ao v1.3", () => {
  it("cartridge.systemPrompt é byte-idêntico ao v1.3 (string-equality completa)", () => {
    // O cartucho diz "v2.0" na versão, mas o TEXTO do prompt é idêntico ao v1.3
    // (puro restructure). Snapshot LITERAL da string INTEIRA — não um toContain de
    // trecho. É o único guard automático contra drift silencioso do prompt: QUALQUER
    // mudança de UM caractere quebra este teste (e exige bump consciente de versão).
    expect(overUnderCartridge.version).toBe("over_under_v2.0");
    expect(overUnderCartridge.systemPrompt).toMatchInlineSnapshot(`
      "Você é um analista quantitativo de apostas esportivas focado exclusivamente no mercado over/under 2.5 gols.

      Sua única tarefa é decidir, para o jogo descrito pelo usuário, entre três opções:
      - "over": apostar em mais de 2.5 gols totais
      - "under": apostar em menos de 2.5 gols totais
      - "pass": não recomendar aposta neste jogo

      Regras invioláveis:
      1. Recomende "over" ou "under" SOMENTE se sua probabilidade estimada (confidence_pct) supera a probabilidade implícita normalizada do lado correspondente em pelo menos 5 pontos percentuais (edge >= 5%). Caso contrário, retorne "pass".
      2. "pass" é a opção segura por padrão e um resultado válido e esperado. Em caso de dúvida, passe a vez. Não force uma recomendação.
      3. confidence_pct é sua probabilidade estimada para o LADO RECOMENDADO. Quando "pass", reporte sua melhor estimativa para "over".
      4. minimum_odd: odd decimal mínima na qual o palpite ainda mantém edge >= 5%. Obrigatório quando recommendation ∈ {"over","under"}; OMITIR quando "pass".
      5. Use APENAS os dados fornecidos pelo usuário. Não invente jogadores, lesões, escalações, estatísticas ou tendências.
      6. Raciocine quantitativamente quando possível: médias de gols marcados/sofridos, ritmo recente, impacto de ausências em finalização/defesa, padrão de H2H, contexto da competição.
      7. Considere a confiabilidade dos dados: poucos jogos de forma recente, ausência de escalação publicada, ou H2H muito antigo são motivos pra reduzir confiança (e provavelmente "pass").
      8. Quando a seção "Lesões / Suspensões" indicar "dados indisponíveis nesta análise" para um time, NÃO assuma que não há lesões — trate como dado faltante e reduza a confiança da análise.
      9. Responda EXCLUSIVAMENTE chamando a ferramenta \`submit_prediction\` com os campos definidos no schema dela. Não produza texto livre fora da chamada da ferramenta.

      Redação do campo rationale (tom, não conteúdo):
      - Estas regras mudam APENAS a forma de escrever o rationale. A decisão (recommendation, confidence_pct, minimum_odd) segue exclusivamente as regras invioláveis acima — decida primeiro como sempre; na dúvida sobre o edge mínimo, continue passando a vez.
      - Escreva para um leitor leigo, que NÃO conhece estatística de apostas: frases curtas, linguagem do dia a dia.
      - Abra com a conclusão em UMA frase simples (ex.: "Este jogo tem boas chances de terminar com 3 gols ou mais." / "Melhor não apostar neste jogo.").
      - Depois da conclusão, sustente com os números decisivos (médias de gols, forma recente, ausências, histórico do confronto) — a base quantitativa continua obrigatória; muda só o tom.
      - Jargão técnico apenas se explicado em meia frase no próprio texto (ex.: "probabilidade implícita — a chance que a odd embute"). Prefira "histórico de confrontos" a "H2H".
      - Não exagere a convicção pra soar didático: a frase de abertura deve refletir sua incerteza real (um caso apertado abre com "por pouco", não com certeza).
      - Mantenha o tamanho de sempre: ~450 caracteres (máx. 600). Linguagem acessível não significa texto mais longo."
    `);
  });

  it("buildUserMessage renderiza byte-idêntico ao v1.3 pro mesmo input (string-equality completa)", () => {
    // Snapshot LITERAL da mensagem markdown INTEIRA renderizada pro fixture abaixo
    // (não toContain de blocos). Pareia com o snapshot do systemPrompt: juntos
    // travam o PAYLOAD completo (system + user) contra qualquer drift silencioso.
    const input = buildPredictionInput({
      match: {
        externalId: "ext-1",
        league: "brasileirao_a",
        homeTeam: matchRow.homeTeam,
        awayTeam: matchRow.awayTeam,
        kickoffAt: matchRow.kickoffAt,
        venue: "Maracanã",
      },
      standings: STANDINGS,
      home: { form: [], injuries: [], absencesAvailable: true },
      away: { form: [], injuries: [], absencesAvailable: true },
      lineups: undefined,
      h2h: [],
      odds: {
        bookmaker: "Pinnacle",
        over_2_5_decimal: 1.9,
        under_2_5_decimal: 1.95,
        captured_at: "2026-05-15T12:00:00.000Z",
      },
      implied: { over_pct: 51.28, under_pct: 48.72 },
    });
    const message = overUnderCartridge.buildUserMessage(input, {
      daysToKickoff: 3,
    });
    expect(message).toMatchInlineSnapshot(`
      "# Jogo
      - Competição: brasileirao_a
      - Mandante: CR Flamengo
      - Visitante: Fluminense FC
      - Kickoff (UTC): 2026-05-15T19:00:00.000Z
      - Local: Maracanã

      # Mandante — CR Flamengo
      ## Classificação
      - Posição: 1, 20 pts em 10 jogos
      - Gols: 18 pró / 9 contra (saldo 9)
      ## Forma recente (mais recente primeiro)
      - (sem dados)
      ## Lesões / Suspensões
      - (nenhuma reportada)

      # Visitante — Fluminense FC
      ## Classificação
      - Posição: 2, 18 pts em 10 jogos
      - Gols: 15 pró / 10 contra (saldo 5)
      ## Forma recente (mais recente primeiro)
      - (sem dados)
      ## Lesões / Suspensões
      - (nenhuma reportada)

      # Confrontos diretos (H2H)
      - (sem histórico fornecido)

      # Odds e probabilidades implícitas
      - Bookmaker: Pinnacle (capturado em 2026-05-15T12:00:00.000Z)
      - Over 2.5: odd 1.90 → implícita normalizada 51.28%
      - Under 2.5: odd 1.95 → implícita normalizada 48.72%

      # Contexto temporal
      - Dias até o jogo: 3 (≤1 = dados mais confiáveis; ≥5 = lineup ainda indefinido, lesões podem mudar)

      # Sua tarefa
      Decida: "over", "under" ou "pass". Aplique a regra de edge >= 5%. Chame a ferramenta submit_prediction com os campos do schema."
    `);
  });
});

describe("predict() — model resolution (override > DB default) + model-aware request", () => {
  it("no override + DB default Opus → Anthropic called with opus id and NO temperature (adaptive)", async () => {
    getDefaultModelId.mockResolvedValue("claude-opus-4-8");

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    expect(getDefaultModelId).toHaveBeenCalledTimes(1);
    const arg = anthropicCreate.mock.calls[0]?.[0];
    expect(arg.model).toBe("claude-opus-4-8");
    expect(arg).not.toHaveProperty("temperature");
    expect(arg.thinking).toEqual({ type: "adaptive" });
    // CRÍTICO: o caminho default/non-admin é Opus 4.8 — forced tool_choice +
    // thinking dá 400 em produção. O payload real DEVE usar `auto`, nunca forçar.
    expect(arg.tool_choice).toEqual({ type: "auto" });

    // Critério de aceite do #57: as colunas de auditoria refletem o modelo
    // RESOLVIDO, não o `response.model` (que aqui é o id stale "sonnet" do mock).
    // ai_calls é inserido primeiro, predictions depois.
    const aiCallRow = insertValues.mock.calls[0]?.[0] as { model: string };
    const predictionRow = insertValues.mock.calls[1]?.[0] as {
      modelVersion: string;
    };
    expect(aiCallRow.model).toBe("claude-opus-4-8");
    expect(predictionRow.modelVersion).toBe("claude-opus-4-8");
  });

  it("a request carrega o max_tokens configurado com folga pro thinking (guarda o bug stopReason max_tokens)", async () => {
    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();
    const arg = anthropicCreate.mock.calls[0]?.[0];
    expect(arg.max_tokens).toBe(16000);
    // folga mínima: abaixo disso o thinking dos modelos adaptive estoura antes do tool_use
    expect(arg.max_tokens).toBeGreaterThanOrEqual(4000);
  });

  it("modelOverride Sonnet wins over DB default Opus → sonnet id + temperature 0.3", async () => {
    getDefaultModelId.mockResolvedValue("claude-opus-4-8");
    // Resposta carrega um `model` STALE (≠ id resolvido) pra provar que as
    // colunas de auditoria gravam o id RESOLVIDO, não `response.model`.
    anthropicCreate.mockResolvedValueOnce({
      ...anthropicMessage(),
      model: "claude-opus-4-8",
    });

    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: false,
        modelOverride: "claude-sonnet-4-5-20250929",
      }),
    ).resolves.toBeDefined();

    // Override curto-circuita o lookup do default global.
    expect(getDefaultModelId).not.toHaveBeenCalled();
    const arg = anthropicCreate.mock.calls[0]?.[0];
    expect(arg.model).toBe("claude-sonnet-4-5-20250929");
    expect(arg.temperature).toBe(0.3);
    expect(arg).not.toHaveProperty("thinking");
    // Sonnet não usa thinking, então forçar o submit_prediction é válido.
    expect(arg.tool_choice).toEqual({
      type: "tool",
      name: "submit_prediction",
    });

    // Auditoria reflete o modelo RESOLVIDO (override), não o `response.model`
    // stale ("claude-opus-4-8") devolvido pelo provider acima.
    const aiCallRow = insertValues.mock.calls[0]?.[0] as { model: string };
    const predictionRow = insertValues.mock.calls[1]?.[0] as {
      modelVersion: string;
    };
    expect(aiCallRow.model).toBe("claude-sonnet-4-5-20250929");
    expect(predictionRow.modelVersion).toBe("claude-sonnet-4-5-20250929");
  });

  it("modelOverride Haiku → haiku id + temperature 0.3 (temperature mode), skips DB default", async () => {
    getDefaultModelId.mockResolvedValue("claude-opus-4-8");

    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: false,
        modelOverride: "claude-haiku-4-5",
      }),
    ).resolves.toBeDefined();

    // Override curto-circuita AMBOS os lookups (preferência E default global).
    expect(getPreferredModelId).not.toHaveBeenCalled();
    expect(getDefaultModelId).not.toHaveBeenCalled();
    const arg = anthropicCreate.mock.calls[0]?.[0];
    expect(arg.model).toBe("claude-haiku-4-5");
    expect(arg.temperature).toBe(0.3);
    expect(arg).not.toHaveProperty("thinking");

    // Auditoria reflete o modelo resolvido (override).
    const aiCallRow = insertValues.mock.calls[0]?.[0] as { model: string };
    const predictionRow = insertValues.mock.calls[1]?.[0] as {
      modelVersion: string;
    };
    expect(aiCallRow.model).toBe("claude-haiku-4-5");
    expect(predictionRow.modelVersion).toBe("claude-haiku-4-5");
  });

  it("no override + DB default Sonnet → Anthropic called with sonnet id", async () => {
    getDefaultModelId.mockResolvedValue("claude-sonnet-4-5-20250929");

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const arg = anthropicCreate.mock.calls[0]?.[0];
    expect(arg.model).toBe("claude-sonnet-4-5-20250929");
    expect(arg.temperature).toBe(0.3);
  });
});

describe("predict() — cascata completa: preferência do usuário + filtro de audiência", () => {
  it("sem override + preferência Haiku (não-admin) → usa Haiku; default global NÃO é lido", async () => {
    getPreferredModelId.mockResolvedValue("claude-haiku-4-5");
    getDefaultModelId.mockResolvedValue("claude-opus-4-8");

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const arg = anthropicCreate.mock.calls[0]?.[0];
    expect(arg.model).toBe("claude-haiku-4-5");
    // Preferência válida curto-circuita o default global.
    expect(getDefaultModelId).not.toHaveBeenCalled();

    const aiCallRow = insertValues.mock.calls[0]?.[0] as { model: string };
    expect(aiCallRow.model).toBe("claude-haiku-4-5");
  });

  it("INVARIANTE ex-admin: preferência Fable (admin-only) + isAdmin=false → preferência IGNORADA, cai no default global", async () => {
    getPreferredModelId.mockResolvedValue("claude-fable-5");
    getDefaultModelId.mockResolvedValue("claude-opus-4-8");

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const arg = anthropicCreate.mock.calls[0]?.[0];
    // Fable não é userSelectable → filtro de audiência derruba a preferência e o
    // default global (Opus) é usado. NUNCA roda Fable pra usuário comum.
    expect(arg.model).toBe("claude-opus-4-8");
    expect(getDefaultModelId).toHaveBeenCalledTimes(1);
  });

  it("sem override + preferência Fable + isAdmin=true → usa Fable (audiência admin)", async () => {
    getPreferredModelId.mockResolvedValue("claude-fable-5");
    getDefaultModelId.mockResolvedValue("claude-opus-4-8");

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: true }),
    ).resolves.toBeDefined();

    const arg = anthropicCreate.mock.calls[0]?.[0];
    expect(arg.model).toBe("claude-fable-5");
    // Preferência válida pra admin curto-circuita o default global.
    expect(getDefaultModelId).not.toHaveBeenCalled();
  });

  it("override sempre vence a preferência: override Haiku + preferência Sonnet → usa Haiku", async () => {
    getPreferredModelId.mockResolvedValue("claude-sonnet-4-5-20250929");
    getDefaultModelId.mockResolvedValue("claude-opus-4-8");

    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: false,
        modelOverride: "claude-haiku-4-5",
      }),
    ).resolves.toBeDefined();

    const arg = anthropicCreate.mock.calls[0]?.[0];
    expect(arg.model).toBe("claude-haiku-4-5");
    // Override curto-circuita preferência E default.
    expect(getPreferredModelId).not.toHaveBeenCalled();
    expect(getDefaultModelId).not.toHaveBeenCalled();
  });

  it("sem override + sem preferência (null) + default Opus → Opus (comportamento atual preservado)", async () => {
    getPreferredModelId.mockResolvedValue(null);
    getDefaultModelId.mockResolvedValue("claude-opus-4-8");

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).resolves.toBeDefined();

    const arg = anthropicCreate.mock.calls[0]?.[0];
    expect(arg.model).toBe("claude-opus-4-8");
    expect(getDefaultModelId).toHaveBeenCalledTimes(1);
  });
});

describe("predict() — Opus adaptive path: model declines to call the tool", () => {
  it("no submit_prediction tool_use (thinking/text only) → persists tool_missing ai_call, still paid, and throws", async () => {
    // Caminho Opus: tool_choice é `auto` (forced + thinking = 400), então o
    // modelo PODE não chamar submit_prediction — só devolver thinking/texto.
    // predict() deve registrar o ai_call pago (tokens cobrados) com status
    // tool_missing E lançar; nenhuma prediction é inserida.
    getDefaultModelId.mockResolvedValue("claude-opus-4-8");
    anthropicCreate.mockResolvedValue({
      id: "msg-2",
      type: "message",
      role: "assistant",
      model: "claude-opus-4-8",
      stop_reason: "end_turn",
      stop_sequence: null,
      content: [
        { type: "thinking", thinking: "ponderando o jogo...", signature: "sig" },
        { type: "text", text: "Não tenho convicção suficiente." },
      ],
      usage: { input_tokens: 1200, output_tokens: 300 },
    });

    await expect(predict({ matchId: "m-1", userId: "u-1", isAdmin: false })).rejects.toThrow(
      "LLM did not call submit_prediction tool",
    );

    // A chamada paga ao LLM aconteceu (custo real) e foi auditada como
    // tool_missing — exatamente UM insert (ai_calls), nenhuma prediction.
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledTimes(1);
    const aiCallRow = insertValues.mock.calls[0]?.[0] as {
      model: string;
      status: string;
      inputTokens: number;
      outputTokens: number;
    };
    expect(aiCallRow.status).toBe("tool_missing");
    // Modelo resolvido (Opus), não o response.model, e tokens cobrados.
    expect(aiCallRow.model).toBe("claude-opus-4-8");
    expect(aiCallRow.inputTokens).toBe(1200);
    expect(aiCallRow.outputTokens).toBe(300);
  });
});

describe("predict() — error paths: invariante 1 ai_call / 0 prediction / 0 PSO", () => {
  // Espelha o teste de tool_missing acima pras OUTRAS duas classes de erro do
  // PLAN-165 (invalid_output, provider_error): cada uma persiste EXATAMENTE um
  // ai_call (a auditoria do erro via persistAiCallError) e ZERO prediction/PSO.

  it("invalid_output: output do LLM falha o Zod do cartucho → 1 ai_call, 0 prediction, 0 PSO, throws", async () => {
    // tool_use VÁLIDO (o modelo chamou submit_prediction), mas o input falha o
    // outputSchema do cartucho — confidence_pct fora do range [0,100]. predict()
    // audita como invalid_output (1 insert em ai_calls) e lança; nenhuma
    // prediction nem candidate set é escrito.
    anthropicCreate.mockResolvedValue({
      id: "msg-3",
      type: "message",
      role: "assistant",
      model: "claude-opus-4-8",
      stop_reason: "tool_use",
      stop_sequence: null,
      content: [
        {
          type: "tool_use",
          id: "tu-2",
          name: "submit_prediction",
          input: {
            recommendation: "over",
            confidence_pct: 150, // inválido: > 100, viola z.number().max(100)
            rationale: "Defesas frágeis dos dois lados.",
            key_factors: ["xG alto", "defesas vazadas"],
            minimum_odd: 1.8,
          },
        },
      ],
      usage: { input_tokens: 1200, output_tokens: 300 },
    });

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).rejects.toThrow("LLM output failed Zod validation");

    // A chamada paga aconteceu; auditada como invalid_output — UM insert
    // (ai_calls via persistAiCallError), nenhuma prediction, nenhum PSO.
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledTimes(1);
    const aiCallRow = insertValues.mock.calls[0]?.[0] as { status: string };
    expect(aiCallRow.status).toBe("invalid_output");
  });

  it("provider_error: client.messages.create rejeita (Anthropic.APIError) → 1 ai_call, 0 prediction, 0 PSO, throws", async () => {
    // A chamada paga estoura com um erro do provider. classifyAnthropicError
    // mapeia APIError → provider_error; persistAiCallError grava UM ai_call
    // (tokens 0) e predict() relança como PredictError. Nenhuma prediction/PSO.
    anthropicCreate.mockRejectedValue(
      new Anthropic.APIError(
        500,
        undefined,
        "internal server error",
        undefined,
      ),
    );

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).rejects.toThrow("anthropic call failed");

    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledTimes(1);
    const aiCallRow = insertValues.mock.calls[0]?.[0] as { status: string };
    expect(aiCallRow.status).toBe("provider_error");
  });
});

describe("predict() — guarda de seed COMPLETO falha ANTES do gasto", () => {
  it("mercado seedado parcialmente (falta 'under') → throws ANTES de client.messages.create, 0 inserts", async () => {
    // resolveMarketCatalog (shared com #164) só hard-falha em mercado ausente ou
    // ZERO seleções. Um catálogo com SÓ 'over' passaria por ela e, sem a guarda
    // pré-paga, só quebraria nos hard-fails por-seleção DEPOIS da chamada paga —
    // queimando spend + uma row de ai_call. A guarda checa o seed COMPLETO antes
    // da chamada: predict() lança ANTES de tocar o LLM e sem nenhum insert.
    resolveMarketCatalog.mockResolvedValue({
      marketId: "mkt-ou",
      idByKey: new Map([["over", "sel-over"]]), // falta 'under'
      keyById: new Map([["sel-over", "over"]]),
    });

    await expect(
      predict({ matchId: "m-1", userId: "u-1", isAdmin: false }),
    ).rejects.toThrow("seedado incompleto");

    // Falhou ANTES do gasto: nenhuma chamada paga ao LLM e nenhum insert
    // (nem ai_call, nem prediction, nem PSO).
    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });
});
