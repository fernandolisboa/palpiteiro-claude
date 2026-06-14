import { describe, expect, it } from "vitest";

import {
  computeSettlement,
  type SettlementInput,
} from "@/lib/settlement/compute";
import { getSettlementRule } from "@/lib/settlement/registry";
import { doubleChanceRule } from "@/lib/settlement/rules/double_chance";
import { SettlementError, type ResultData } from "@/lib/settlement/schemas";

function rd(homeScore: number, awayScore: number): ResultData {
  return { homeScore, awayScore, totalGoals: homeScore + awayScore };
}

// As duplas SE SOBREPÕEM: em cada resultado, DUAS duplas vencem e UMA perde.
describe("doubleChanceRule — 3 outcomes × 3 duplas (cobertura sobreposta)", () => {
  // Home win (2-0): home_or_draw {home,draw} ✓, home_or_away {home,away} ✓,
  // away_or_draw {away,draw} ✗.
  it("home win: home_or_draw → won, home_or_away → won, away_or_draw → lost", () => {
    expect(doubleChanceRule("home_or_draw", null, rd(2, 0))).toBe("won");
    expect(doubleChanceRule("home_or_away", null, rd(2, 0))).toBe("won");
    expect(doubleChanceRule("away_or_draw", null, rd(2, 0))).toBe("lost");
  });

  // Draw (1-1): home_or_draw ✓, away_or_draw ✓, home_or_away {home,away} ✗.
  it("draw: home_or_draw → won, away_or_draw → won, home_or_away → lost", () => {
    expect(doubleChanceRule("home_or_draw", null, rd(1, 1))).toBe("won");
    expect(doubleChanceRule("away_or_draw", null, rd(1, 1))).toBe("won");
    expect(doubleChanceRule("home_or_away", null, rd(1, 1))).toBe("lost");
  });

  // Away win (0-3): away_or_draw ✓, home_or_away ✓, home_or_draw {home,draw} ✗.
  it("away win: away_or_draw → won, home_or_away → won, home_or_draw → lost", () => {
    expect(doubleChanceRule("away_or_draw", null, rd(0, 3))).toBe("won");
    expect(doubleChanceRule("home_or_away", null, rd(0, 3))).toBe("won");
    expect(doubleChanceRule("home_or_draw", null, rd(0, 3))).toBe("lost");
  });

  it("never returns push (dupla chance has no refund)", () => {
    for (const sel of ["home_or_draw", "away_or_draw", "home_or_away"] as const) {
      expect(doubleChanceRule(sel, null, rd(2, 0))).not.toBe("push");
      expect(doubleChanceRule(sel, null, rd(1, 1))).not.toBe("push");
      expect(doubleChanceRule(sel, null, rd(0, 2))).not.toBe("push");
    }
  });
});

describe("doubleChanceRule — degraded history stays pending (never settle wrong)", () => {
  it("throws SettlementError when homeScore is null", () => {
    expect(() =>
      doubleChanceRule("home_or_draw", null, {
        homeScore: null,
        awayScore: 1,
        totalGoals: 1,
      }),
    ).toThrow(SettlementError);
  });

  it("throws SettlementError when awayScore is null", () => {
    expect(() =>
      doubleChanceRule("home_or_away", null, {
        homeScore: 2,
        awayScore: null,
        totalGoals: 2,
      }),
    ).toThrow(SettlementError);
  });

  it("throws SettlementError when both scores are null", () => {
    expect(() =>
      doubleChanceRule("away_or_draw", null, {
        homeScore: null,
        awayScore: null,
        totalGoals: 0,
      }),
    ).toThrow(SettlementError);
  });
});

describe("doubleChanceRule — unknown selection key is a data bug, not a loss", () => {
  // DIVERGE do match_result (que retorna 'lost' p/ não-correspondência): uma key
  // fora das 3 duplas é bug de dado → SettlementError (pending), nunca 'lost'.
  it("throws SettlementError on a key outside the 3 duplas", () => {
    expect(() => doubleChanceRule("home", null, rd(2, 0))).toThrow(
      SettlementError,
    );
    expect(() => doubleChanceRule("garbage", null, rd(1, 1))).toThrow(
      SettlementError,
    );
  });
});

describe("getSettlementRule resolves double_chance", () => {
  it("resolves the double_chance rule", () => {
    expect(getSettlementRule("double_chance")).toBe(doubleChanceRule);
  });
});

describe("computeSettlement — end-to-end dupla chance via the registry", () => {
  function dc(overrides: Partial<SettlementInput>): SettlementInput {
    return {
      recommendation: "home_or_draw",
      settlementRuleKey: "double_chance",
      selectionKey: "home_or_draw",
      marketParams: null,
      oddAtRecommendation: 1.2,
      stakeUnits: 1,
      resultData: rd(2, 0),
      ...overrides,
    };
  }

  it("pass settles void/0 before the registry (selectionKey null)", () => {
    expect(
      computeSettlement(
        dc({
          recommendation: "pass",
          selectionKey: null,
          oddAtRecommendation: null,
        }),
      ),
    ).toEqual({ result: "void", profitUnits: 0 });
  });

  it("home win settles home_or_draw won (profit = stake*(odd-1))", () => {
    expect(computeSettlement(dc({ resultData: rd(2, 0) }))).toEqual({
      result: "won",
      profitUnits: 0.2,
    });
  });

  it("away win settles home_or_draw lost", () => {
    expect(computeSettlement(dc({ resultData: rd(0, 3) }))).toEqual({
      result: "lost",
      profitUnits: -1,
    });
  });
});
