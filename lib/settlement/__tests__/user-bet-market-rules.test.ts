import { describe, expect, it } from "vitest";

import type { PalpiteResultData } from "@/db/schema";
import { SettlementError } from "@/lib/settlement/schemas";
import {
  HalfLineSchema,
  settleBttsLeg,
  settleDoubleChanceLeg,
  settleFirstHalfOverUnderLeg,
  settleMatchResultLeg,
  settleOverUnderLeg,
} from "@/lib/settlement/rules/user-bet-market";

function rd(
  home: number,
  away: number,
  ht?: { home: number; away: number },
): PalpiteResultData {
  return {
    homeScore: home,
    awayScore: away,
    totalGoals: home + away,
    ...(ht
      ? { halftimeHomeScore: ht.home, halftimeAwayScore: ht.away }
      : {}),
  };
}

describe("HalfLineSchema (k+0.5)", () => {
  it("aceita 0.5/1.5/2.5/3.5; rejeita inteiro e quarto", () => {
    for (const ok of [0.5, 1.5, 2.5, 3.5]) {
      expect(HalfLineSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of [2, 3, 2.25, 2.75, 0]) {
      expect(HalfLineSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("settleOverUnderLeg (binário, sem push)", () => {
  it("over 2.5 sobre 3-0 → won; under 2.5 sobre 3-0 → lost", () => {
    expect(settleOverUnderLeg({ selection: "over", line: 2.5 }, rd(3, 0))).toBe(
      "won",
    );
    expect(settleOverUnderLeg({ selection: "under", line: 2.5 }, rd(3, 0))).toBe(
      "lost",
    );
  });
  it("under 2.5 sobre 1-1 → won", () => {
    expect(settleOverUnderLeg({ selection: "under", line: 2.5 }, rd(1, 1))).toBe(
      "won",
    );
  });
  it("params com linha inteira → SettlementError (nunca push)", () => {
    expect(() =>
      settleOverUnderLeg({ selection: "over", line: 2 }, rd(2, 0)),
    ).toThrow(SettlementError);
  });
});

describe("settleMatchResultLeg", () => {
  it("home sobre 2-1 won; draw/away lost", () => {
    expect(settleMatchResultLeg({ selection: "home" }, rd(2, 1))).toBe("won");
    expect(settleMatchResultLeg({ selection: "draw" }, rd(2, 1))).toBe("lost");
    expect(settleMatchResultLeg({ selection: "away" }, rd(2, 1))).toBe("lost");
  });
  it("draw sobre 1-1 won", () => {
    expect(settleMatchResultLeg({ selection: "draw" }, rd(1, 1))).toBe("won");
  });
});

describe("settleBttsLeg", () => {
  it("yes sobre 1-1 won; no sobre 1-1 lost", () => {
    expect(settleBttsLeg({ selection: "yes" }, rd(1, 1))).toBe("won");
    expect(settleBttsLeg({ selection: "no" }, rd(1, 1))).toBe("lost");
  });
  it("yes sobre 2-0 lost; no sobre 2-0 won", () => {
    expect(settleBttsLeg({ selection: "yes" }, rd(2, 0))).toBe("lost");
    expect(settleBttsLeg({ selection: "no" }, rd(2, 0))).toBe("won");
  });
});

describe("settleDoubleChanceLeg", () => {
  it("home_draw cobre home e draw, não away", () => {
    expect(settleDoubleChanceLeg({ selection: "home_draw" }, rd(2, 0))).toBe(
      "won",
    );
    expect(settleDoubleChanceLeg({ selection: "home_draw" }, rd(1, 1))).toBe(
      "won",
    );
    expect(settleDoubleChanceLeg({ selection: "home_draw" }, rd(0, 2))).toBe(
      "lost",
    );
  });
  it("draw_away cobre draw e away", () => {
    expect(settleDoubleChanceLeg({ selection: "draw_away" }, rd(0, 1))).toBe(
      "won",
    );
    expect(settleDoubleChanceLeg({ selection: "draw_away" }, rd(2, 0))).toBe(
      "lost",
    );
  });
});

describe("settleFirstHalfOverUnderLeg", () => {
  it("over 0.5 com HT 1-0 → won; under 0.5 com HT 0-0 → won", () => {
    expect(
      settleFirstHalfOverUnderLeg(
        { selection: "over", line: 0.5 },
        rd(2, 0, { home: 1, away: 0 }),
      ),
    ).toBe("won");
    expect(
      settleFirstHalfOverUnderLeg(
        { selection: "under", line: 0.5 },
        rd(2, 0, { home: 0, away: 0 }),
      ),
    ).toBe("won");
  });
  it("halftime AUSENTE → SettlementError → PENDING (prefer-skip)", () => {
    expect(() =>
      settleFirstHalfOverUnderLeg({ selection: "over", line: 0.5 }, rd(2, 0)),
    ).toThrow(SettlementError);
  });
});
