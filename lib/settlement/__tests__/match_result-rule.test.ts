import { describe, expect, it } from "vitest";

import {
  computeSettlement,
  type SettlementInput,
} from "@/lib/settlement/compute";
import { getSettlementRule } from "@/lib/settlement/registry";
import { matchResultRule } from "@/lib/settlement/rules/match_result";
import { SettlementError, type ResultData } from "@/lib/settlement/schemas";

// rd(home, away) — fato do jogo no placar de 90'. totalGoals = soma.
function rd(homeScore: number, awayScore: number): ResultData {
  return { homeScore, awayScore, totalGoals: homeScore + awayScore };
}

describe("matchResultRule (1X2) — 3 outcomes × 3 selections", () => {
  // Home win (2-0): home wins, draw + away lose.
  it("home win: home → won, draw → lost, away → lost", () => {
    expect(matchResultRule("home", null, rd(2, 0))).toBe("won");
    expect(matchResultRule("draw", null, rd(2, 0))).toBe("lost");
    expect(matchResultRule("away", null, rd(2, 0))).toBe("lost");
  });

  // Draw (1-1): draw wins, home + away lose.
  it("draw: draw → won, home → lost, away → lost", () => {
    expect(matchResultRule("draw", null, rd(1, 1))).toBe("won");
    expect(matchResultRule("home", null, rd(1, 1))).toBe("lost");
    expect(matchResultRule("away", null, rd(1, 1))).toBe("lost");
  });

  // Away win (0-3): away wins, home + draw lose.
  it("away win: away → won, home → lost, draw → lost", () => {
    expect(matchResultRule("away", null, rd(0, 3))).toBe("won");
    expect(matchResultRule("home", null, rd(0, 3))).toBe("lost");
    expect(matchResultRule("draw", null, rd(0, 3))).toBe("lost");
  });

  it("never returns push (1X2 has no refund)", () => {
    for (const sel of ["home", "draw", "away"] as const) {
      expect(matchResultRule(sel, null, rd(2, 0))).not.toBe("push");
      expect(matchResultRule(sel, null, rd(1, 1))).not.toBe("push");
      expect(matchResultRule(sel, null, rd(0, 2))).not.toBe("push");
    }
  });
});

describe("matchResultRule — degraded history stays pending (never settle wrong)", () => {
  it("throws SettlementError when homeScore is null", () => {
    expect(() =>
      matchResultRule("home", null, {
        homeScore: null,
        awayScore: 1,
        totalGoals: 1,
      }),
    ).toThrow(SettlementError);
  });

  it("throws SettlementError when awayScore is null", () => {
    expect(() =>
      matchResultRule("away", null, {
        homeScore: 2,
        awayScore: null,
        totalGoals: 2,
      }),
    ).toThrow(SettlementError);
  });

  it("throws SettlementError when both scores are null", () => {
    expect(() =>
      matchResultRule("draw", null, {
        homeScore: null,
        awayScore: null,
        totalGoals: 0,
      }),
    ).toThrow(SettlementError);
  });
});

describe("getSettlementRule resolves match_result", () => {
  it("resolves the match_result rule", () => {
    expect(getSettlementRule("match_result")).toBe(matchResultRule);
  });
});

describe("computeSettlement — market-agnostic pass → void for 1X2", () => {
  // The pass → void short-circuit lives in the market-agnostic compute path
  // (before the registry), so a 1X2 pass settles void/0 the same as over_under.
  function mr(overrides: Partial<SettlementInput>): SettlementInput {
    return {
      recommendation: "home",
      settlementRuleKey: "match_result",
      selectionKey: "home",
      marketParams: null,
      oddAtRecommendation: 1.85,
      stakeUnits: 1,
      resultData: rd(2, 0),
      ...overrides,
    };
  }

  it("pass settles void/0 before the registry (selectionKey null)", () => {
    expect(
      computeSettlement(
        mr({
          recommendation: "pass",
          selectionKey: null,
          oddAtRecommendation: null,
        }),
      ),
    ).toEqual({ result: "void", profitUnits: 0 });
  });

  it("home win settles won via the registry (profit = stake*(odd-1))", () => {
    expect(computeSettlement(mr({ resultData: rd(2, 0) }))).toEqual({
      result: "won",
      profitUnits: 0.85,
    });
  });

  it("away selection on a home win settles lost", () => {
    expect(
      computeSettlement(
        mr({ selectionKey: "away", resultData: rd(2, 0) }),
      ),
    ).toEqual({ result: "lost", profitUnits: -1 });
  });
});
