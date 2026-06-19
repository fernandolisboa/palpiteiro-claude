import { describe, expect, it } from "vitest";

import type { PalpiteResultData } from "@/db/schema";
import { settleMarginPalpite } from "@/lib/settlement/rules/margin_palpite";
import { SettlementError } from "@/lib/settlement/schemas";

function rd(homeScore: number, awayScore: number): PalpiteResultData {
  return { homeScore, awayScore, totalGoals: homeScore + awayScore };
}

describe("settleMarginPalpite — margem de vitória", () => {
  it("home ganha por >= minMargin → won", () => {
    expect(settleMarginPalpite({ side: "home", minMargin: 2 }, rd(2, 0))).toBe(
      "won",
    );
    expect(settleMarginPalpite({ side: "home", minMargin: 2 }, rd(3, 0))).toBe(
      "won",
    );
    expect(settleMarginPalpite({ side: "home", minMargin: 2 }, rd(3, 1))).toBe(
      "won",
    );
  });

  it("home ganha por menos que minMargin → lost", () => {
    expect(settleMarginPalpite({ side: "home", minMargin: 2 }, rd(1, 0))).toBe(
      "lost",
    );
    expect(settleMarginPalpite({ side: "home", minMargin: 2 }, rd(2, 1))).toBe(
      "lost",
    );
  });

  it("lado errado (away venceu, palpite home) → lost", () => {
    expect(settleMarginPalpite({ side: "home", minMargin: 2 }, rd(0, 3))).toBe(
      "lost",
    );
  });

  it("away por >= minMargin → won", () => {
    expect(settleMarginPalpite({ side: "away", minMargin: 2 }, rd(0, 2))).toBe(
      "won",
    );
    expect(settleMarginPalpite({ side: "away", minMargin: 1 }, rd(1, 2))).toBe(
      "won",
    );
  });
});

describe("settleMarginPalpite — prefer skip / defense-in-depth", () => {
  it("split de 90' null → throw → PENDING", () => {
    expect(() =>
      settleMarginPalpite(
        { side: "home", minMargin: 2 },
        { homeScore: null, awayScore: 0, totalGoals: 0 },
      ),
    ).toThrow(SettlementError);
  });

  it("params inválidos → throw", () => {
    expect(() => settleMarginPalpite(null, rd(2, 0))).toThrow(SettlementError);
    expect(() =>
      settleMarginPalpite({ side: "home", minMargin: 0 }, rd(2, 0)),
    ).toThrow(SettlementError);
    expect(() =>
      settleMarginPalpite({ side: "draw", minMargin: 2 }, rd(2, 0)),
    ).toThrow(SettlementError);
  });
});
