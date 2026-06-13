import { describe, expect, it } from "vitest";

import {
  computeSettlement,
  type SettlementInput,
} from "@/lib/settlement/compute";
import type { ResultData } from "@/lib/settlement/schemas";

// rd(total[, home, away]) — fato do jogo. O split default casa o total (home=total,
// away=0); a I2-row usa split degradado (null) provando que a regra tolera.
function rd(
  totalGoals: number,
  homeScore: number | null = totalGoals,
  awayScore: number | null = 0,
): ResultData {
  return { homeScore, awayScore, totalGoals };
}

// Input over/under bem-formado com defaults; sobrescritos por teste. line=2.5.
function ou(overrides: Partial<SettlementInput>): SettlementInput {
  return {
    recommendation: "over",
    settlementRuleKey: "over_under",
    selectionKey: "over",
    marketParams: { line: 2.5 },
    oddAtRecommendation: 1.9,
    stakeUnits: 1,
    resultData: rd(3),
    ...overrides,
  };
}

describe("computeSettlement", () => {
  // Os esperados são LITERAIS calculados à mão pela fórmula binária antiga (NÃO
  // via o round2/profitForOutcome de produção): um oráculo de paridade real.

  it("over wins at 3 goals, profit = stake*(odd-1)", () => {
    expect(
      computeSettlement(ou({ selectionKey: "over", resultData: rd(3) })),
    ).toEqual({ result: "won", profitUnits: 0.9 });
  });

  it("over loses at 2 goals, profit = -stake", () => {
    expect(
      computeSettlement(ou({ selectionKey: "over", resultData: rd(2) })),
    ).toEqual({ result: "lost", profitUnits: -1 });
  });

  it("under wins at 2 goals", () => {
    expect(
      computeSettlement(
        ou({
          recommendation: "under",
          selectionKey: "under",
          oddAtRecommendation: 2.05,
          resultData: rd(2),
        }),
      ),
    ).toEqual({ result: "won", profitUnits: 1.05 });
  });

  it("under loses at 3 goals", () => {
    expect(
      computeSettlement(
        ou({
          recommendation: "under",
          selectionKey: "under",
          oddAtRecommendation: 2.05,
          resultData: rd(3),
        }),
      ),
    ).toEqual({ result: "lost", profitUnits: -1 });
  });

  it("0 goals: over loses, under wins (boundary low)", () => {
    expect(
      computeSettlement(
        ou({ selectionKey: "over", oddAtRecommendation: 1.8, resultData: rd(0) }),
      ),
    ).toMatchObject({ result: "lost" });
    expect(
      computeSettlement(
        ou({
          recommendation: "under",
          selectionKey: "under",
          oddAtRecommendation: 1.8,
          resultData: rd(0),
        }),
      ),
    ).toMatchObject({ result: "won" });
  });

  it("pass settles as void with zero profit (before the registry)", () => {
    expect(
      computeSettlement(
        ou({
          recommendation: "pass",
          selectionKey: null,
          oddAtRecommendation: null,
          resultData: rd(5),
        }),
      ),
    ).toEqual({ result: "void", profitUnits: 0 });
  });

  it("non-pass bet with null entry odd is skipped (left pending)", () => {
    expect(
      computeSettlement(
        ou({ selectionKey: "over", oddAtRecommendation: null, resultData: rd(4) }),
      ),
    ).toBeNull();
  });

  it("null ruleKey is skipped (cannot dispatch)", () => {
    expect(
      computeSettlement(ou({ settlementRuleKey: null, resultData: rd(3) })),
    ).toBeNull();
  });

  it("null selectionKey is skipped (cannot dispatch)", () => {
    expect(
      computeSettlement(ou({ selectionKey: null, resultData: rd(3) })),
    ).toBeNull();
  });

  it("rounds profit to 2 decimals and respects stake", () => {
    expect(
      computeSettlement(
        ou({
          selectionKey: "over",
          oddAtRecommendation: 2.333,
          stakeUnits: 2,
          resultData: rd(4),
        }),
      ),
    ).toEqual({ result: "won", profitUnits: 2.67 });
  });

  it("whole line 2.0 + integer total 2 pushes (profit 0, persisted push)", () => {
    expect(
      computeSettlement(
        ou({
          selectionKey: "over",
          marketParams: { line: 2.0 },
          resultData: rd(2),
        }),
      ),
    ).toEqual({ result: "push", profitUnits: 0 });
  });

  it("tolerates a degraded null split (I2: rule reads totalGoals only)", () => {
    expect(
      computeSettlement(
        ou({
          selectionKey: "over",
          resultData: { homeScore: null, awayScore: null, totalGoals: 3 },
        }),
      ),
    ).toEqual({ result: "won", profitUnits: 0.9 });
  });
});
