import { describe, expect, it } from "vitest";

import type { DashboardRow } from "@/lib/dashboard/kpis";
import {
  deriveDashboardView,
  parseDashboardFilters,
} from "@/lib/dashboard/derive-view";

function row(overrides: Partial<DashboardRow> = {}): DashboardRow {
  return {
    predictionId: "p",
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

describe("parseDashboardFilters", () => {
  it("passes through each valid status", () => {
    for (const s of ["pending", "won", "lost", "void"] as const) {
      expect(parseDashboardFilters({ status: s }).status).toBe(s);
    }
  });

  it("defaults garbage / undefined status to 'all'", () => {
    expect(parseDashboardFilters({ status: "bogus" }).status).toBe("all");
    expect(parseDashboardFilters({}).status).toBe("all");
  });

  it("passes through the only valid market and defaults the rest", () => {
    expect(parseDashboardFilters({ market: "over_under_2_5" }).market).toBe(
      "over_under_2_5",
    );
    expect(parseDashboardFilters({ market: "btts" }).market).toBe("all");
    expect(parseDashboardFilters({}).market).toBe("all");
  });

  it("delegates league to parseLeagueFilter", () => {
    expect(parseDashboardFilters({ league: "ucl" }).league).toBe("ucl");
    expect(parseDashboardFilters({ league: "nope" }).league).toBe("all");
  });
});

describe("deriveDashboardView", () => {
  const rows: DashboardRow[] = [
    row({ predictionId: "pend", result: null, league: "world_cup" }),
    settled("won", "1", { predictionId: "won", league: "world_cup" }),
    settled("lost", "-1", { predictionId: "lost", league: "champions_league" }),
  ];

  it("dedupes + maps availableLeagues via leagueToKey", () => {
    const { availableLeagues } = deriveDashboardView(
      rows,
      parseDashboardFilters({}),
    );
    // world_cup -> wc (deduped from two rows), champions_league -> ucl
    expect(availableLeagues).toEqual(["wc", "ucl"]);
  });

  it("narrows table rows by a non-'all' status filter, then maps to row views", () => {
    const filters = parseDashboardFilters({ status: "won" });
    const { tableRows } = deriveDashboardView(rows, filters);
    expect(tableRows).toHaveLength(1);
    expect(tableRows[0].id).toBe("won"); // PredictionRowView.id === predictionId
    expect(tableRows[0].status).toBe("won");
  });

  it("narrows table rows by a league filter through the composition", () => {
    // only the champions_league row (-> ucl) survives the league filter.
    const filters = parseDashboardFilters({ league: "ucl" });
    const { tableRows } = deriveDashboardView(rows, filters);
    expect(tableRows.map((r) => r.id)).toEqual(["lost"]);
  });

  it("maps every row when filters are 'all'", () => {
    const { tableRows } = deriveDashboardView(rows, parseDashboardFilters({}));
    expect(tableRows.map((r) => r.id)).toEqual(["pend", "won", "lost"]);
  });

  it("produces a well-shaped kpis view and a settled-only series", () => {
    const { kpis, series } = deriveDashboardView(rows, parseDashboardFilters({}));
    // composition shape only — math is covered by kpis.test.ts
    expect(kpis.counts.total).toBe(3);
    expect(typeof kpis.yieldPct.value).toBe("string");
    expect(series).toHaveLength(2); // only the two settled rows
    expect(series.every((p) => typeof p.cumulative === "number")).toBe(true);
  });
});
