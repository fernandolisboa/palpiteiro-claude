import { describe, expect, it } from "vitest";

import { computeSettlement } from "@/lib/settlement/compute";

describe("computeSettlement", () => {
  it("over wins at 3 goals, profit = stake*(odd-1)", () => {
    expect(
      computeSettlement({
        recommendation: "over",
        oddAtRecommendation: 1.9,
        stakeUnits: 1,
        totalGoals: 3,
      }),
    ).toEqual({ result: "won", profitUnits: 0.9 });
  });

  it("over loses at 2 goals, profit = -stake", () => {
    expect(
      computeSettlement({
        recommendation: "over",
        oddAtRecommendation: 1.9,
        stakeUnits: 1,
        totalGoals: 2,
      }),
    ).toEqual({ result: "lost", profitUnits: -1 });
  });

  it("under wins at 2 goals", () => {
    expect(
      computeSettlement({
        recommendation: "under",
        oddAtRecommendation: 2.05,
        stakeUnits: 1,
        totalGoals: 2,
      }),
    ).toEqual({ result: "won", profitUnits: 1.05 });
  });

  it("under loses at 3 goals", () => {
    expect(
      computeSettlement({
        recommendation: "under",
        oddAtRecommendation: 2.05,
        stakeUnits: 1,
        totalGoals: 3,
      }),
    ).toEqual({ result: "lost", profitUnits: -1 });
  });

  it("0 goals: over loses, under wins (boundary low)", () => {
    expect(
      computeSettlement({
        recommendation: "over",
        oddAtRecommendation: 1.8,
        stakeUnits: 1,
        totalGoals: 0,
      }),
    ).toMatchObject({ result: "lost" });
    expect(
      computeSettlement({
        recommendation: "under",
        oddAtRecommendation: 1.8,
        stakeUnits: 1,
        totalGoals: 0,
      }),
    ).toMatchObject({ result: "won" });
  });

  it("pass settles as void with zero profit", () => {
    expect(
      computeSettlement({
        recommendation: "pass",
        oddAtRecommendation: null,
        stakeUnits: 1,
        totalGoals: 5,
      }),
    ).toEqual({ result: "void", profitUnits: 0 });
  });

  it("non-pass bet with null entry odd is skipped (left pending)", () => {
    expect(
      computeSettlement({
        recommendation: "over",
        oddAtRecommendation: null,
        stakeUnits: 1,
        totalGoals: 4,
      }),
    ).toBeNull();
  });

  it("rounds profit to 2 decimals and respects stake", () => {
    expect(
      computeSettlement({
        recommendation: "over",
        oddAtRecommendation: 2.333,
        stakeUnits: 2,
        totalGoals: 4,
      }),
    ).toEqual({ result: "won", profitUnits: 2.67 });
  });
});
