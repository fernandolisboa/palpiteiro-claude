import { describe, expect, it } from "vitest";

import {
  buildResultData,
  frozenPairToSelectionOdds,
  recommendationToSelectionKey,
  snapshotToSelectionRows,
} from "./backfill-mappings";

describe("recommendationToSelectionKey", () => {
  it("maps over/under to the homonymous selection", () => {
    expect(recommendationToSelectionKey("over")).toBe("over");
    expect(recommendationToSelectionKey("under")).toBe("under");
  });

  it("maps pass to null (no selection — ADR 0015 D5)", () => {
    expect(recommendationToSelectionKey("pass")).toBeNull();
  });
});

describe("frozenPairToSelectionOdds", () => {
  it("expands a present pair into one row per selection, odds verbatim", () => {
    expect(frozenPairToSelectionOdds("1.920", "1.950")).toEqual([
      { selectionKey: "over", odd: "1.920" },
      { selectionKey: "under", odd: "1.950" },
    ]);
  });

  it("degrades to NO rows when either side is null (no invented odd)", () => {
    expect(frozenPairToSelectionOdds(null, "1.950")).toEqual([]);
    expect(frozenPairToSelectionOdds("1.920", null)).toEqual([]);
    expect(frozenPairToSelectionOdds(null, null)).toEqual([]);
  });

  it("is recommendation-agnostic (a pass with a frozen pair still gets both rows)", () => {
    // The pair is the candidate set, not the chosen side — pass keeps both.
    expect(frozenPairToSelectionOdds("2.000", "1.800")).toHaveLength(2);
  });
});

describe("buildResultData", () => {
  it("copies the settled total verbatim and keeps the split when it matches", () => {
    expect(buildResultData(2, 1, 3)).toEqual({
      homeScore: 2,
      awayScore: 1,
      totalGoals: 3,
    });
    expect(buildResultData(1, 1, 2)).toEqual({
      homeScore: 1,
      awayScore: 1,
      totalGoals: 2,
    });
  });

  it("degrades the split to null when home+away disagrees with the settled total", () => {
    // matches.home/away stale or full-time-incl-ET vs the 90' total the row settled on:
    // never fabricate a side split that contradicts the settled fact.
    expect(buildResultData(3, 1, 3)).toEqual({
      homeScore: null,
      awayScore: null,
      totalGoals: 3,
    });
  });

  it("degrades the split to null when either side is missing, total still verbatim", () => {
    expect(buildResultData(null, null, 2)).toEqual({
      homeScore: null,
      awayScore: null,
      totalGoals: 2,
    });
    expect(buildResultData(2, null, 2)).toEqual({
      homeScore: null,
      awayScore: null,
      totalGoals: 2,
    });
  });

  it("keeps a legitimate 0-0 split (sum equals 0)", () => {
    expect(buildResultData(0, 0, 0)).toEqual({
      homeScore: 0,
      awayScore: 0,
      totalGoals: 0,
    });
  });
});

describe("snapshotToSelectionRows", () => {
  it("splits a binary snapshot into over/under rows with numeric line", () => {
    expect(
      snapshotToSelectionRows({ overOdd: "1.920", underOdd: "1.950", line: "2.50" }),
    ).toEqual([
      { selectionKey: "over", odd: "1.920", line: 2.5 },
      { selectionKey: "under", odd: "1.950", line: 2.5 },
    ]);
  });

  it("always produces exactly two rows (the 2x invariant of #162)", () => {
    expect(
      snapshotToSelectionRows({ overOdd: "2.1", underOdd: "1.7", line: "3.50" }),
    ).toHaveLength(2);
  });
});
