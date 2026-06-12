import { describe, expect, it } from "vitest";

import {
  applyTableFilters,
  computeBankrollSeries,
  computeDashboardKpis,
  rowStatus,
  type DashboardRow,
} from "@/lib/dashboard/kpis";

function row(overrides: Partial<DashboardRow> = {}): DashboardRow {
  const predictionId = overrides.predictionId ?? "p";
  return {
    predictionId,
    matchId: `match-${predictionId}`,
    recommendation: "over",
    market: "over_under_2_5",
    league: "world_cup",
    homeTeam: "A",
    awayTeam: "B",
    stakeUnits: "1.00",
    oddAtRecommendation: "2.00",
    edgePct: "5.00",
    confidencePct: "55.00",
    createdAt: new Date("2026-06-10T00:00:00Z"),
    result: null,
    profitUnits: null,
    settledAt: null,
    ...overrides,
  };
}

function settled(
  result: "won" | "lost" | "void",
  profit: string,
  extra: Partial<DashboardRow> = {},
): DashboardRow {
  return row({
    result,
    profitUnits: profit,
    settledAt: new Date("2026-06-12T20:00:00Z"),
    ...extra,
  });
}

describe("computeDashboardKpis", () => {
  it("returns null rates and zero counts for no predictions", () => {
    const k = computeDashboardKpis([]);
    expect(k.totalPredictions).toBe(0);
    expect(k.yield.value).toBeNull();
    expect(k.winRate.value).toBeNull();
    expect(k.passRate.value).toBeNull();
    expect(k.totalProfitUnits).toBe(0);
  });

  it("keeps rates null while nothing is settled (Copa not started)", () => {
    const k = computeDashboardKpis([row(), row({ recommendation: "under" })]);
    expect(k.settled).toBe(0);
    expect(k.pending).toBe(2);
    expect(k.yield.value).toBeNull();
    expect(k.winRate.value).toBeNull();
    // pass rate is decision-time: defined over all predictions even unsettled
    expect(k.passRate.value).toBe(0);
    expect(k.passRate.n).toBe(2);
  });

  it("computes yield from profit over staked volume, excluding pass stakes", () => {
    const rows = [
      settled("won", "0.92", { oddAtRecommendation: "1.92" }),
      settled("lost", "-1.00"),
      settled("void", "0", { recommendation: "pass", oddAtRecommendation: null }),
    ];
    const k = computeDashboardKpis(rows);
    expect(k.totalProfitUnits).toBeCloseTo(-0.08, 5);
    expect(k.stakedUnits).toBeCloseTo(2, 5); // pass stake excluded
    expect(k.yield.value).toBeCloseTo(-4, 5);
    expect(k.yield.n).toBe(2);
  });

  it("excludes a real bet that was annulled (void) from the yield denominator", () => {
    const base: DashboardRow[] = [
      settled("won", "0.92", { oddAtRecommendation: "1.92" }),
      settled("lost", "-1.00"),
    ];
    // A real over/under bet (non-pass) annulled to void via admin override:
    // keeps its stake + entry odd but profit 0.
    const withVoid: DashboardRow[] = [
      ...base,
      settled("void", "0", { recommendation: "over", oddAtRecommendation: "1.95" }),
    ];
    const k = computeDashboardKpis(withVoid);
    const baseK = computeDashboardKpis(base);
    expect(k.stakedUnits).toBeCloseTo(2, 5); // void stake NOT in denominator
    expect(k.yield.value).toBeCloseTo(-4, 5);
    expect(k.yield.n).toBe(2); // void not counted in sample size
    // void must not move the yield at all
    expect(k.yield.value).toBeCloseTo(baseK.yield.value!, 5);
    expect(k.stakedUnits).toBeCloseTo(baseK.stakedUnits, 5);
    expect(k.yield.n).toBe(baseK.yield.n);
    // void IS still a settled void in the counts (visibility unchanged)
    expect(k.void).toBe(1);
    expect(k.settled).toBe(3);
  });

  it("yields null for a wallet of only settled void real bets (zero denominator)", () => {
    // All real (non-pass) bets annulled to void: won/lost set is empty, so the
    // yield denominator is 0. Must report null/0 and never divide by zero.
    const rows = [
      settled("void", "0", { recommendation: "over", oddAtRecommendation: "1.95" }),
      settled("void", "0", { recommendation: "under", oddAtRecommendation: "2.10" }),
    ];
    const k = computeDashboardKpis(rows);
    expect(k.yield.value).toBeNull();
    expect(k.yield.n).toBe(0);
    expect(k.stakedUnits).toBe(0);
    expect(k.void).toBe(2);
    expect(k.settled).toBe(2);
  });

  it("yield numerator reflects only won/lost, even when a profitable void is present", () => {
    // Guard against the numerator silently summing over void: a void carrying a
    // nonzero profitUnits (settlement-invariant violation) must NOT move yield.
    const wonLost = [
      settled("won", "0.92", { oddAtRecommendation: "1.92" }),
      settled("lost", "-1.00"),
    ];
    const withDirtyVoid = [
      ...wonLost,
      settled("void", "5.00", { recommendation: "over", oddAtRecommendation: "1.95" }),
    ];
    const baseK = computeDashboardKpis(wonLost);
    const k = computeDashboardKpis(withDirtyVoid);
    expect(k.yield.value).toBeCloseTo(baseK.yield.value!, 5);
    expect(k.yield.n).toBe(baseK.yield.n);
  });

  it("excludes void from win rate denominator", () => {
    const rows = [
      settled("won", "1"),
      settled("lost", "-1"),
      settled("void", "0", { recommendation: "pass", oddAtRecommendation: null }),
    ];
    const k = computeDashboardKpis(rows);
    expect(k.winRate.value).toBe(50); // 1 / (1 + 1)
    expect(k.winRate.n).toBe(2);
  });

  it("flags low sample below 20 and clears it at 20", () => {
    const nineteen = computeDashboardKpis(
      Array.from({ length: 19 }, () => settled("won", "0.92")),
    );
    expect(nineteen.winRate.n).toBe(19);
    expect(nineteen.winRate.lowSample).toBe(true);

    const twenty = computeDashboardKpis(
      Array.from({ length: 20 }, () => settled("won", "0.92")),
    );
    expect(twenty.winRate.n).toBe(20);
    expect(twenty.winRate.lowSample).toBe(false);
  });
});

describe("computeBankrollSeries", () => {
  it("is empty when nothing is settled", () => {
    expect(computeBankrollSeries([row(), row()])).toEqual([]);
  });

  it("accumulates profit in settledAt order, excluding pending rows", () => {
    const rows = [
      row(), // pending, ignored
      settled("won", "1.00", { settledAt: new Date("2026-06-12T20:00:00Z") }),
      settled("lost", "-0.50", { settledAt: new Date("2026-06-13T20:00:00Z") }),
      settled("won", "2.00", { settledAt: new Date("2026-06-14T20:00:00Z") }),
    ];
    const series = computeBankrollSeries(rows);
    expect(series.map((p) => p.cumulative)).toEqual([1, 0.5, 2.5]);
  });
});

describe("applyTableFilters", () => {
  const rows = [
    row({ predictionId: "pend", result: null }),
    settled("won", "1", { predictionId: "won", league: "world_cup" }),
    settled("lost", "-1", { predictionId: "lost", league: "champions_league" }),
  ];

  it("filters by status", () => {
    const out = applyTableFilters(rows, {
      status: "won",
      league: "all",
      market: "all",
    });
    expect(out.map((r) => r.predictionId)).toEqual(["won"]);
  });

  it("filters by league key", () => {
    const out = applyTableFilters(rows, {
      status: "all",
      league: "ucl",
      market: "all",
    });
    expect(out.map((r) => r.predictionId)).toEqual(["lost"]);
  });

  it("returns everything with all-filters", () => {
    const out = applyTableFilters(rows, {
      status: "all",
      league: "all",
      market: "all",
    });
    expect(out).toHaveLength(3);
  });
});

describe("rowStatus", () => {
  it("maps a missing outcome to pending", () => {
    expect(rowStatus(row())).toBe("pending");
    expect(rowStatus(settled("won", "1"))).toBe("won");
  });
});
