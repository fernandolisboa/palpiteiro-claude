import { describe, expect, it } from "vitest";

import type { PalpiteResultData } from "@/db/schema";
import { settleCleanSheetPalpite } from "@/lib/settlement/rules/clean_sheet_palpite";
import { SettlementError } from "@/lib/settlement/schemas";

function rd(homeScore: number, awayScore: number): PalpiteResultData {
  return { homeScore, awayScore, totalGoals: homeScore + awayScore };
}

describe("settleCleanSheetPalpite — clean sheet (adversário marca 0)", () => {
  it("home clean sheet: 2-0 → won (visitante marcou 0)", () => {
    expect(settleCleanSheetPalpite({ side: "home" }, rd(2, 0))).toBe("won");
    expect(settleCleanSheetPalpite({ side: "home" }, rd(0, 0))).toBe("won");
  });

  it("home clean sheet: 2-1 → lost (visitante marcou)", () => {
    expect(settleCleanSheetPalpite({ side: "home" }, rd(2, 1))).toBe("lost");
  });

  it("away clean sheet = mandante marcou 0: 0-1 → won; 2-1 → lost", () => {
    expect(settleCleanSheetPalpite({ side: "away" }, rd(0, 1))).toBe("won");
    expect(settleCleanSheetPalpite({ side: "away" }, rd(2, 1))).toBe("lost");
  });
});

describe("settleCleanSheetPalpite — prefer skip / defense-in-depth", () => {
  it("split de 90' null → throw → PENDING", () => {
    expect(() =>
      settleCleanSheetPalpite(
        { side: "home" },
        { homeScore: 2, awayScore: null, totalGoals: 2 },
      ),
    ).toThrow(SettlementError);
  });

  it("params inválidos → throw", () => {
    expect(() => settleCleanSheetPalpite(null, rd(2, 0))).toThrow(
      SettlementError,
    );
    expect(() => settleCleanSheetPalpite({ side: "draw" }, rd(2, 0))).toThrow(
      SettlementError,
    );
  });
});
