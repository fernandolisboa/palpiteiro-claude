import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/queries/predictions", () => ({
  getPendingSettlementPredictions: vi.fn(),
}));
vi.mock("@/lib/db/queries/prediction-outcomes", () => ({
  insertOutcomeIfAbsent: vi.fn(),
}));

import { getPendingSettlementPredictions } from "@/lib/db/queries/predictions";
import { insertOutcomeIfAbsent } from "@/lib/db/queries/prediction-outcomes";
import {
  __setSportsDataProviderForTesting,
  getSportsDataProvider,
} from "@/lib/providers/sports-data";
import type {
  FixtureRef,
  NormalizedFixtureResult,
  SportsDataProvider,
} from "@/lib/providers/sports-data/types";
import { settlePendingPredictions } from "@/lib/settlement/settle";

const getPending = vi.mocked(getPendingSettlementPredictions);
const insertOutcome = vi.mocked(insertOutcomeIfAbsent);

type PendingRow = Awaited<
  ReturnType<typeof getPendingSettlementPredictions>
>[number];

function pending(overrides: Partial<PendingRow>): PendingRow {
  return {
    predictionId: "p1",
    recommendation: "over",
    settlementRuleKey: "over_under",
    selectionKey: "over",
    marketParams: { line: 2.5 },
    oddAtRecommendation: "1.900",
    stakeUnits: "1",
    matchId: "m1",
    league: "world_cup",
    kickoffAt: new Date("2026-06-20T18:00:00.000Z"),
    homeTeam: "Brazil",
    awayTeam: "Argentina",
    ...overrides,
  };
}

function installProvider(
  resultFor: (ref: FixtureRef) => NormalizedFixtureResult | undefined,
  spy?: ReturnType<typeof vi.fn>,
): void {
  const getFixtureResult = spy ?? vi.fn();
  getFixtureResult.mockImplementation(async (ref: FixtureRef) =>
    resultFor(ref),
  );
  __setSportsDataProviderForTesting({
    getFixtureResult,
  } as unknown as SportsDataProvider);
}

beforeEach(() => {
  getPending.mockReset();
  insertOutcome.mockReset();
  insertOutcome.mockResolvedValue(true);
});

afterEach(() => {
  __setSportsDataProviderForTesting(undefined);
  vi.restoreAllMocks();
});

const finished = (home: number, away: number): NormalizedFixtureResult => ({
  status: "finished",
  regulationScore: { home, away },
});

describe("settlePendingPredictions", () => {
  it("returns a no-op summary when nothing is pending", async () => {
    getPending.mockResolvedValue([]);
    installProvider(() => undefined);
    const s = await settlePendingPredictions();
    expect(s).toMatchObject({ considered: 0, settled: 0 });
  });

  it("settles over/under on the 90' total and fetches the match once", async () => {
    getPending.mockResolvedValue([
      pending({
        predictionId: "over1",
        recommendation: "over",
        selectionKey: "over",
      }),
      pending({
        predictionId: "under1",
        recommendation: "under",
        selectionKey: "under",
        oddAtRecommendation: "2.100",
      }),
    ]);
    const spy = vi.fn();
    installProvider(() => finished(2, 1), spy); // 3 goals → over wins, under loses

    const s = await settlePendingPredictions();

    expect(spy).toHaveBeenCalledTimes(1); // deduped by match
    expect(s.settled).toBe(2);
    expect(s.byResult).toEqual({ won: 1, lost: 1, void: 0, push: 0 });
    expect(insertOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        predictionId: "over1",
        resultData: { homeScore: 2, awayScore: 1, totalGoals: 3 },
        result: "won",
        profitUnits: 0.9,
      }),
    );
    expect(insertOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        predictionId: "under1",
        result: "lost",
        resultData: { homeScore: 2, awayScore: 1, totalGoals: 3 },
      }),
    );
  });

  it("leaves non-finished matches pending", async () => {
    getPending.mockResolvedValue([pending({})]);
    installProvider(() => ({ status: "postponed", regulationScore: null }));
    const s = await settlePendingPredictions();
    expect(s.skipped).toBe(1);
    expect(s.settled).toBe(0);
    expect(insertOutcome).not.toHaveBeenCalled();
  });

  it("settles pass as void with zero profit", async () => {
    getPending.mockResolvedValue([
      pending({
        predictionId: "pass1",
        recommendation: "pass",
        selectionKey: null,
        oddAtRecommendation: null,
      }),
    ]);
    installProvider(() => finished(0, 0));
    const s = await settlePendingPredictions();
    expect(s.byResult.void).toBe(1);
    expect(insertOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        result: "void",
        profitUnits: 0,
        resultData: { homeScore: 0, awayScore: 0, totalGoals: 0 },
      }),
    );
  });

  it("skips a non-pass bet that has no recorded entry odd", async () => {
    getPending.mockResolvedValue([
      pending({ recommendation: "over", oddAtRecommendation: null }),
    ]);
    installProvider(() => finished(3, 0));
    const s = await settlePendingPredictions();
    expect(s.skipped).toBe(1);
    expect(insertOutcome).not.toHaveBeenCalled();
  });

  it("counts provider lookup failures as errors", async () => {
    getPending.mockResolvedValue([pending({})]);
    const provider = {
      getFixtureResult: vi.fn().mockRejectedValue(new Error("boom")),
    } as unknown as SportsDataProvider;
    __setSportsDataProviderForTesting(provider);
    const s = await settlePendingPredictions();
    expect(s.errors).toBe(1);
    expect(insertOutcome).not.toHaveBeenCalled();
  });

  it("counts idempotent re-runs as alreadySettled", async () => {
    getPending.mockResolvedValue([pending({})]);
    installProvider(() => finished(3, 0));
    insertOutcome.mockResolvedValue(false); // conflict → no-op
    const s = await settlePendingPredictions();
    expect(s.alreadySettled).toBe(1);
    expect(s.settled).toBe(0);
  });

  it("settles a whole-line push (line 2.0 + finished 1-1) as push/0", async () => {
    getPending.mockResolvedValue([
      pending({ predictionId: "push1", marketParams: { line: 2.0 } }),
    ]);
    installProvider(() => finished(1, 1)); // 2 goals == line 2.0 → push
    const s = await settlePendingPredictions();
    expect(s.byResult.push).toBe(1);
    expect(insertOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        predictionId: "push1",
        result: "push",
        profitUnits: 0,
        resultData: { homeScore: 1, awayScore: 1, totalGoals: 2 },
      }),
    );
  });

  it("buckets a bad row to errors WITHOUT aborting the batch (I4)", async () => {
    getPending.mockResolvedValue([
      // marketParams null → the rule throws SettlementError.
      pending({ predictionId: "bad1", marketParams: null }),
      // well-formed sibling in the SAME batch must still settle.
      pending({ predictionId: "good1" }),
    ]);
    installProvider(() => finished(2, 1)); // 3 goals → over wins
    const s = await settlePendingPredictions();
    expect(s.errors).toBe(1);
    expect(s.settled).toBe(1);
    expect(s.byResult.won).toBe(1);
    expect(insertOutcome).toHaveBeenCalledTimes(1);
    expect(insertOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ predictionId: "good1", result: "won" }),
    );
  });

  it("buckets a malformed (non-integer) 90' score to errors WITHOUT aborting the batch", async () => {
    getPending.mockResolvedValue([
      pending({ predictionId: "badscore1", matchId: "mBad", homeTeam: "BadTeam" }),
      pending({ predictionId: "good2", matchId: "mGood" }),
    ]);
    // mBad: provider returns a non-integer 90' score → resultDataFromRegulationScore
    // (ResultDataSchema int check) throws INSIDE the I4 try. mGood: a clean score.
    installProvider((ref) =>
      ref.homeTeam === "BadTeam"
        ? { status: "finished", regulationScore: { home: 1.5, away: 1 } }
        : finished(2, 1),
    );
    const s = await settlePendingPredictions();
    expect(s.errors).toBe(1);
    expect(s.settled).toBe(1);
    expect(insertOutcome).toHaveBeenCalledTimes(1);
    expect(insertOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ predictionId: "good2", result: "won" }),
    );
  });
});

// Sanity: the testing override is wired the same way the real factory is read.
describe("provider test seam", () => {
  it("getSportsDataProvider returns the injected provider", () => {
    const provider = {
      getFixtureResult: vi.fn(),
    } as unknown as SportsDataProvider;
    __setSportsDataProviderForTesting(provider);
    expect(getSportsDataProvider()).toBe(provider);
    __setSportsDataProviderForTesting(undefined);
  });
});
