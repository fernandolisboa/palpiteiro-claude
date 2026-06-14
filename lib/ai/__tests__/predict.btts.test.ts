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

// ─── Module mocks (mirrors predict.match-result.test.ts; no real DB/HTTP) ────
// BTTS é binário (yes/no, N=2) e *additional*. Este teste prova que predict.ts
// roda o caminho genérico SEM edição: legacy cols NULL, marketParams NULL (sem
// linha), marketId/selectionId setados. A snapshot fresca evita o fallback de
// odds (que, p/ additional, é guardado no commit do fetch — aqui nunca é tocado).

const matchRow = {
  id: "m-1",
  externalId: "ext-1",
  league: "world_cup" as SupportedLeague,
  homeTeam: "Mexico",
  awayTeam: "South Africa",
  kickoffAt: new Date("2026-06-11T19:00:00.000Z"),
  status: "scheduled" as const,
  homeScore: null,
  awayScore: null,
  updatedAt: new Date("2026-06-01T00:00:00.000Z"),
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
      supportedLeagues: new Set<SupportedLeague>(["world_cup"]),
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

import { bttsCartridge } from "@/lib/ai/markets/btts";
import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";
import { predict } from "@/lib/ai/predict";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const REF: FixtureRef = {
  league: "world_cup",
  kickoffAt: matchRow.kickoffAt.toISOString(),
  homeTeam: matchRow.homeTeam,
  awayTeam: matchRow.awayTeam,
};

const FIXTURE: NormalizedFixture = {
  id: `world_cup:${REF.kickoffAt}:${REF.homeTeam}:${REF.awayTeam}`,
  league: "world_cup",
  kickoffAt: REF.kickoffAt,
  kickoffTimestampMs: matchRow.kickoffAt.getTime(),
  homeTeam: matchRow.homeTeam,
  awayTeam: matchRow.awayTeam,
  status: "scheduled",
  score: { home: null, away: null },
  venue: "Estadio Azteca",
};

const STANDINGS: NormalizedStanding = {
  league: "world_cup",
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

// Fresh N=2 (yes/no) capture; odds are STRINGS (numeric → string in Drizzle).
function freshSnapshotBtts(yesOdd = "2.060", noOdd = "1.810") {
  return {
    bookmaker: "Pinnacle",
    capturedAt: new Date(),
    overroundPct: "4.00",
    selections: [
      { key: "yes", odd: yesOdd },
      { key: "no", odd: noOdd },
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

// btts output: binário, SEM prob_* (selectionProbs deriva por complemento).
const YES_OUTPUT = {
  recommendation: "yes",
  confidence_pct: 58,
  rationale: "Dois ataques produtivos e defesas vazadas: ambos tendem a marcar.",
  key_factors: ["ambos marcam no H2H", "defesas frágeis"],
  minimum_odd: 1.6,
};

// catalog 2-vias (yes/no).
function catalogBtts() {
  return {
    marketId: "mkt-btts",
    idByKey: new Map([
      ["yes", "sel-yes"],
      ["no", "sel-no"],
    ]),
    keyById: new Map([
      ["sel-yes", "yes"],
      ["sel-no", "no"],
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
  // additional market: a snapshot SEMPRE fresca evita o fallback de odds.
  getOddsForSport.mockResolvedValue([]);
  getLatestFreshSelectionOddsSnapshots.mockResolvedValue(freshSnapshotBtts());
  resolveMarketCatalog.mockResolvedValue(catalogBtts());
  getDefaultModelId.mockResolvedValue("claude-opus-4-8");
  getGenerationParams.mockResolvedValue({
    maxTokens: 16000,
    effort: "high",
    temperature: 0.3,
  });
  getPreferredModelId.mockResolvedValue(null);
  anthropicCreate.mockResolvedValue(anthropicMessage(YES_OUTPUT));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  setHappyPath();
});

// implied normalizada de uma seleção binária, na MESMA ordem do predict.
function impliedPctOf(yes: number, no: number, side: "yes" | "no") {
  const { probs } = computeMarketImpliedProbabilities([yes, no]);
  return probs[side === "yes" ? 0 : 1] * 100;
}

describe("predict(btts) — N=2 binary happy path through the generic path", () => {
  it("returns the carrier (2 selections yes/no) with model probs + odds", async () => {
    const spy = vi.spyOn(bttsCartridge, "buildPredictionInput");
    const result = await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "btts",
    });

    expect(result.prediction).toEqual({ id: "row-1", aiCallId: "row-1" });
    expect(result.marketKey).toBe("btts");
    // selectionProbs derives {yes:58, no:42} by complement.
    expect(result.selections).toEqual([
      { key: "yes", modelProbPct: 58, odd: 2.06 },
      { key: "no", modelProbPct: 42, odd: 1.81 },
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    // additional market: NUNCA bate no batch getOddsForSport (snapshot fresca).
    expect(getOddsForSport).not.toHaveBeenCalled();
  });

  it("legacy-write skipped: market NULL + over/under odds NULL + marketParams NULL", async () => {
    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: true,
        marketKey: "btts",
      }),
    ).resolves.toBeDefined();

    // insertValues[0] = ai_calls; [1] = predictions; [2] = PSO rows.
    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(predictionRow.market).toBeNull();
    expect(predictionRow.overOddAtPrediction).toBeNull();
    expect(predictionRow.underOddAtPrediction).toBeNull();
    // btts carries no line.
    expect(predictionRow.marketParams).toBeNull();
    // Source-of-truth columns are set (generic).
    expect(predictionRow.marketId).toBe("mkt-btts");
    expect(predictionRow.selectionId).toBe("sel-yes");
    expect(predictionRow.recommendation).toBe("yes");
  });

  it("edge computed per recommended selection (yes) via selectionProbs, never 100−x", async () => {
    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: true,
        marketKey: "btts",
      }),
    ).resolves.toBeDefined();

    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    const impliedYes = impliedPctOf(2.06, 1.81, "yes");
    expect(predictionRow.impliedProbPct).toBe(impliedYes.toFixed(2));
    expect(predictionRow.edgePct).toBe((58 - impliedYes).toFixed(2));
    expect(predictionRow.oddAtRecommendation).toBe("2.060");
  });

  it("PSO carries model_prob_pct per selection for both yes/no", async () => {
    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: true,
        marketKey: "btts",
      }),
    ).resolves.toBeDefined();

    const psoRows = insertValues.mock.calls[2]?.[0] as Array<{
      selectionId: string;
      odd: string;
      modelProbPct: string | null;
    }>;
    expect(psoRows).toHaveLength(2);
    const byId = Object.fromEntries(
      psoRows.map((r) => [r.selectionId, r.modelProbPct]),
    );
    expect(byId["sel-yes"]).toBe("58.00");
    expect(byId["sel-no"]).toBe("42.00");
  });

  it("rec 'no': selectionProbs complemento {yes:42,no:58}, edge por prob_no (ramo assimétrico)", async () => {
    anthropicCreate.mockResolvedValue(
      anthropicMessage({
        recommendation: "no",
        confidence_pct: 58, // P(no)
        rationale: "Defesa sólida segura ao menos um lado sem marcar.",
        key_factors: ["defesa forte", "pouco volume ofensivo visitante"],
        minimum_odd: 1.5,
      }),
    );

    const result = await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "btts",
    });

    // complemento: rec 'no' conf 58 → {yes:100-58, no:58}.
    expect(result.selections).toEqual([
      { key: "yes", modelProbPct: 42, odd: 2.06 },
      { key: "no", modelProbPct: 58, odd: 1.81 },
    ]);
    const predictionRow = insertValues.mock.calls[1]?.[0] as Record<
      string,
      unknown
    >;
    expect(predictionRow.recommendation).toBe("no");
    expect(predictionRow.selectionId).toBe("sel-no");
    expect(predictionRow.oddAtRecommendation).toBe("1.810");
    const impliedNo = impliedPctOf(2.06, 1.81, "no");
    expect(predictionRow.impliedProbPct).toBe(impliedNo.toFixed(2));
    // edge da prob_no (58), não 100−x.
    expect(predictionRow.edgePct).toBe((58 - impliedNo).toFixed(2));
  });
});

describe("predict(btts) — pass case", () => {
  it("pass: selectionId null, no edge, PSO still writes both model probs", async () => {
    anthropicCreate.mockResolvedValue(
      anthropicMessage({
        recommendation: "pass",
        confidence_pct: 45, // P(yes) on pass
        rationale: "Mercado eficiente; nenhum lado com edge claro.",
        key_factors: ["mercado equilibrado", "odds justas"],
      }),
    );

    const result = await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "btts",
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
    // carrier exposes the binary distribution {yes:45, no:55}.
    expect(result.selections.map((s) => s.modelProbPct)).toEqual([45, 55]);

    const psoRows = insertValues.mock.calls[2]?.[0] as Array<{
      modelProbPct: string | null;
    }>;
    expect(psoRows).toHaveLength(2);
    expect(psoRows.map((r) => r.modelProbPct)).toEqual(["45.00", "55.00"]);
  });
});

describe("predict(btts) — complete-seed guard fails before the paid call", () => {
  it("catalog missing the 'no' selection → throws before client.messages.create, 0 inserts", async () => {
    resolveMarketCatalog.mockResolvedValue({
      marketId: "mkt-btts",
      idByKey: new Map([["yes", "sel-yes"]]), // missing 'no'
      keyById: new Map([["sel-yes", "yes"]]),
    });

    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: true,
        marketKey: "btts",
      }),
    ).rejects.toThrow("seedado incompleto");

    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });
});

describe("predict(btts) — additional market never batch-fetches odds (quota)", () => {
  it("sem snapshot fresco → LANÇA, NUNCA chama getOddsForSport (batch)", async () => {
    // additional (btts): o fallback batch é estruturalmente proibido. Sem o snapshot
    // fresco (que o pre-warm por evento garante na action), predict falha explícito.
    getLatestFreshSelectionOddsSnapshots.mockResolvedValue(null);

    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: true,
        marketKey: "btts",
      }),
    ).rejects.toThrow(/additional-market 'btts' sem snapshot fresco/);

    expect(getOddsForSport).not.toHaveBeenCalled();
    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });
});
