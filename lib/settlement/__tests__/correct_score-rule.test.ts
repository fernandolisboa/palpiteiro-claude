import { describe, expect, it } from "vitest";

import {
  computeSettlement,
  type SettlementInput,
} from "@/lib/settlement/compute";
import { getSettlementRule } from "@/lib/settlement/registry";
import { correctScoreRule } from "@/lib/settlement/rules/correct_score";
import { SettlementError, type ResultData } from "@/lib/settlement/schemas";

// rd(home, away) — fato do jogo no placar de 90'. totalGoals = soma.
function rd(homeScore: number, awayScore: number): ResultData {
  return { homeScore, awayScore, totalGoals: homeScore + awayScore };
}

describe("correctScoreRule (placar exato) — exact match", () => {
  it("cs_2_1 on a 2-1 → won; the wrong cells → lost", () => {
    expect(correctScoreRule("cs_2_1", null, rd(2, 1))).toBe("won");
    expect(correctScoreRule("cs_1_1", null, rd(2, 1))).toBe("lost");
    expect(correctScoreRule("cs_2_0", null, rd(2, 1))).toBe("lost");
    expect(correctScoreRule("cs_1_2", null, rd(2, 1))).toBe("lost");
  });

  it("cs_0_0 on a 0-0 → won", () => {
    expect(correctScoreRule("cs_0_0", null, rd(0, 0))).toBe("won");
  });

  it("cs_3_3 on a 3-3 → won", () => {
    expect(correctScoreRule("cs_3_3", null, rd(3, 3))).toBe("won");
  });

  it("never returns push (correct score has no refund)", () => {
    expect(correctScoreRule("cs_2_1", null, rd(2, 1))).not.toBe("push");
    expect(correctScoreRule("cs_2_1", null, rd(1, 0))).not.toBe("push");
  });
});

describe("correctScoreRule — off-grid real score is a loss, not pending", () => {
  it("any in-grid cell on a real 4-0 (off-grid) → lost (NOT throw)", () => {
    // O placar real 4-0 está fora do grid 0..3; a célula in-grid prevista não
    // ocorreu objetivamente → lost (senão ficaria pending pra sempre).
    expect(correctScoreRule("cs_3_0", null, rd(4, 0))).toBe("lost");
    expect(correctScoreRule("cs_0_0", null, rd(4, 0))).toBe("lost");
    expect(correctScoreRule("cs_2_1", null, rd(0, 5))).toBe("lost");
    expect(() => correctScoreRule("cs_3_0", null, rd(4, 0))).not.toThrow();
  });
});

describe("correctScoreRule — degraded history stays pending (never settle wrong)", () => {
  it("throws SettlementError when homeScore is null", () => {
    expect(() =>
      correctScoreRule("cs_1_1", null, {
        homeScore: null,
        awayScore: 1,
        totalGoals: 1,
      }),
    ).toThrow(SettlementError);
  });

  it("throws SettlementError when awayScore is null", () => {
    expect(() =>
      correctScoreRule("cs_1_1", null, {
        homeScore: 2,
        awayScore: null,
        totalGoals: 2,
      }),
    ).toThrow(SettlementError);
  });

  it("throws SettlementError when both scores are null", () => {
    expect(() =>
      correctScoreRule("cs_0_0", null, {
        homeScore: null,
        awayScore: null,
        totalGoals: 0,
      }),
    ).toThrow(SettlementError);
  });
});

describe("getSettlementRule resolves correct_score", () => {
  it("resolves the correct_score rule", () => {
    expect(getSettlementRule("correct_score")).toBe(correctScoreRule);
  });
});

describe("computeSettlement — market-agnostic pass → void for correct_score", () => {
  function cs(overrides: Partial<SettlementInput>): SettlementInput {
    return {
      recommendation: "cs_2_1",
      settlementRuleKey: "correct_score",
      selectionKey: "cs_2_1",
      marketParams: null,
      oddAtRecommendation: 9.5,
      stakeUnits: 1,
      resultData: rd(2, 1),
      ...overrides,
    };
  }

  it("pass settles void/0 before the registry (selectionKey null)", () => {
    expect(
      computeSettlement(
        cs({
          recommendation: "pass",
          selectionKey: null,
          oddAtRecommendation: null,
        }),
      ),
    ).toEqual({ result: "void", profitUnits: 0 });
  });

  it("exact-hit settles won via the registry (profit = stake*(odd-1))", () => {
    expect(computeSettlement(cs({ resultData: rd(2, 1) }))).toEqual({
      result: "won",
      profitUnits: 8.5,
    });
  });

  it("a miss settles lost", () => {
    expect(computeSettlement(cs({ resultData: rd(1, 1) }))).toEqual({
      result: "lost",
      profitUnits: -1,
    });
  });
});
