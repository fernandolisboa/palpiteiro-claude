import { describe, expect, it } from "vitest";

import type { PalpiteResultData } from "@/db/schema";
import { settleFirstHalfScorePalpite } from "@/lib/settlement/rules/first_half_score_palpite";
import { SettlementError } from "@/lib/settlement/schemas";

// rd com split de intervalo. ht ausente (undefined) por default → testa prefer-skip.
function rd(
  homeScore: number,
  awayScore: number,
  ht?: { home: number; away: number } | null,
): PalpiteResultData {
  const base: PalpiteResultData = {
    homeScore,
    awayScore,
    totalGoals: homeScore + awayScore,
  };
  if (ht !== undefined) {
    base.halftimeHomeScore = ht === null ? null : ht.home;
    base.halftimeAwayScore = ht === null ? null : ht.away;
  }
  return base;
}

describe("settleFirstHalfScorePalpite — placar do 1º tempo", () => {
  it("HT 1-0 == palpite 1-0 → won", () => {
    expect(
      settleFirstHalfScorePalpite({ home: 1, away: 0 }, rd(2, 1, { home: 1, away: 0 })),
    ).toBe("won");
  });

  it("HT 1-0 vs palpite 0-0 → lost", () => {
    expect(
      settleFirstHalfScorePalpite({ home: 0, away: 0 }, rd(2, 1, { home: 1, away: 0 })),
    ).toBe("lost");
  });

  it("HT 0-0 == palpite 0-0 → won", () => {
    expect(
      settleFirstHalfScorePalpite({ home: 0, away: 0 }, rd(0, 0, { home: 0, away: 0 })),
    ).toBe("won");
  });
});

describe("settleFirstHalfScorePalpite — prefer skip (halftime ausente)", () => {
  it("halftime undefined (provider não entregou) → throw → PENDING", () => {
    expect(() =>
      settleFirstHalfScorePalpite({ home: 1, away: 0 }, rd(2, 1)),
    ).toThrow(SettlementError);
  });

  it("halftime null → throw → PENDING", () => {
    expect(() =>
      settleFirstHalfScorePalpite({ home: 1, away: 0 }, rd(2, 1, null)),
    ).toThrow(SettlementError);
  });

  it("params inválidos → throw", () => {
    expect(() =>
      settleFirstHalfScorePalpite({ home: 1 }, rd(2, 1, { home: 1, away: 0 })),
    ).toThrow(SettlementError);
  });
});
