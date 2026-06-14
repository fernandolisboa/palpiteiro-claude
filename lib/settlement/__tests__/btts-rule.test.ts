import { describe, expect, it } from "vitest";

import {
  computeSettlement,
  type SettlementInput,
} from "@/lib/settlement/compute";
import { getSettlementRule } from "@/lib/settlement/registry";
import { bttsRule } from "@/lib/settlement/rules/btts";
import { SettlementError, type ResultData } from "@/lib/settlement/schemas";

// rd(home, away) — fato do jogo no placar de 90'. totalGoals = soma.
function rd(homeScore: number, awayScore: number): ResultData {
  return { homeScore, awayScore, totalGoals: homeScore + awayScore };
}

describe("bttsRule (ambos marcam) — 2 selections × score outcomes", () => {
  // Ambos marcaram (1-1): yes vence, no perde.
  it("both scored (1-1): yes → won, no → lost", () => {
    expect(bttsRule("yes", null, rd(1, 1))).toBe("won");
    expect(bttsRule("no", null, rd(1, 1))).toBe("lost");
  });

  // Goleada mas ambos marcaram (3-2): yes vence.
  it("both scored (3-2): yes → won, no → lost", () => {
    expect(bttsRule("yes", null, rd(3, 2))).toBe("won");
    expect(bttsRule("no", null, rd(3, 2))).toBe("lost");
  });

  // 0-0: NINGUÉM marcou → no vence, yes perde.
  it("0-0: yes → lost, no → won", () => {
    expect(bttsRule("yes", null, rd(0, 0))).toBe("lost");
    expect(bttsRule("no", null, rd(0, 0))).toBe("won");
  });

  // Só um lado marcou (2-0): no vence, yes perde.
  it("one-sided (2-0): yes → lost, no → won", () => {
    expect(bttsRule("yes", null, rd(2, 0))).toBe("lost");
    expect(bttsRule("no", null, rd(2, 0))).toBe("won");
  });

  // Só o visitante marcou (0-3): no vence, yes perde.
  it("one-sided (0-3): yes → lost, no → won", () => {
    expect(bttsRule("yes", null, rd(0, 3))).toBe("lost");
    expect(bttsRule("no", null, rd(0, 3))).toBe("won");
  });

  it("never returns push (btts has no refund)", () => {
    for (const sel of ["yes", "no"] as const) {
      expect(bttsRule(sel, null, rd(1, 1))).not.toBe("push");
      expect(bttsRule(sel, null, rd(0, 0))).not.toBe("push");
      expect(bttsRule(sel, null, rd(2, 0))).not.toBe("push");
    }
  });
});

describe("bttsRule — degraded history stays pending (never settle wrong)", () => {
  it("throws SettlementError when homeScore is null", () => {
    expect(() =>
      bttsRule("yes", null, { homeScore: null, awayScore: 1, totalGoals: 1 }),
    ).toThrow(SettlementError);
  });

  it("throws SettlementError when awayScore is null", () => {
    expect(() =>
      bttsRule("no", null, { homeScore: 2, awayScore: null, totalGoals: 2 }),
    ).toThrow(SettlementError);
  });

  it("throws SettlementError when both scores are null", () => {
    expect(() =>
      bttsRule("yes", null, {
        homeScore: null,
        awayScore: null,
        totalGoals: 0,
      }),
    ).toThrow(SettlementError);
  });
});

describe("getSettlementRule resolves btts", () => {
  it("resolves the btts rule", () => {
    expect(getSettlementRule("btts")).toBe(bttsRule);
  });
});

describe("computeSettlement — btts end-to-end via the registry", () => {
  function btts(overrides: Partial<SettlementInput>): SettlementInput {
    return {
      recommendation: "yes",
      settlementRuleKey: "btts",
      selectionKey: "yes",
      marketParams: null,
      oddAtRecommendation: 2.06,
      stakeUnits: 1,
      resultData: rd(1, 1),
      ...overrides,
    };
  }

  it("pass settles void/0 before the registry (selectionKey null)", () => {
    expect(
      computeSettlement(
        btts({
          recommendation: "pass",
          selectionKey: null,
          oddAtRecommendation: null,
        }),
      ),
    ).toEqual({ result: "void", profitUnits: 0 });
  });

  it("yes on both-scored settles won (profit = stake*(odd-1))", () => {
    expect(
      computeSettlement(btts({ selectionKey: "yes", resultData: rd(1, 1) })),
    ).toEqual({ result: "won", profitUnits: 1.06 });
  });

  it("yes on 0-0 settles lost", () => {
    expect(
      computeSettlement(btts({ selectionKey: "yes", resultData: rd(0, 0) })),
    ).toEqual({ result: "lost", profitUnits: -1 });
  });

  it("no on 0-0 settles won", () => {
    expect(
      computeSettlement(
        btts({
          selectionKey: "no",
          oddAtRecommendation: 1.81,
          resultData: rd(0, 0),
        }),
      ),
    ).toEqual({ result: "won", profitUnits: 0.81 });
  });
});
