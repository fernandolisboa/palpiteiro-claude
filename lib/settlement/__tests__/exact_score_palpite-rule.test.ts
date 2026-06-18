import { describe, expect, it } from "vitest";

import type { PalpiteResultData } from "@/db/schema";
import { settleExactScorePalpite } from "@/lib/settlement/rules/exact_score_palpite";
import { SettlementError } from "@/lib/settlement/schemas";

// rd(home, away) — fato do jogo no placar de 90'. totalGoals = soma.
function rd(homeScore: number, awayScore: number): PalpiteResultData {
  return { homeScore, awayScore, totalGoals: homeScore + awayScore };
}

describe("settleExactScorePalpite — compare direto", () => {
  it("palpite 2-1 sobre um 2-1 → won; placares errados → lost", () => {
    expect(settleExactScorePalpite({ home: 2, away: 1 }, rd(2, 1))).toBe("won");
    expect(settleExactScorePalpite({ home: 2, away: 1 }, rd(0, 0))).toBe(
      "lost"
    );
    expect(settleExactScorePalpite({ home: 2, away: 1 }, rd(1, 1))).toBe(
      "lost"
    );
    expect(settleExactScorePalpite({ home: 2, away: 1 }, rd(2, 0))).toBe(
      "lost"
    );
  });

  it("0-0 sobre um 0-0 → won", () => {
    expect(settleExactScorePalpite({ home: 0, away: 0 }, rd(0, 0))).toBe("won");
  });

  it("nunca retorna void/push (palpite de placar não tem linha)", () => {
    expect(settleExactScorePalpite({ home: 2, away: 1 }, rd(2, 1))).not.toBe(
      "push"
    );
    expect(settleExactScorePalpite({ home: 2, away: 1 }, rd(1, 0))).not.toBe(
      "void"
    );
  });
});

describe("settleExactScorePalpite — SEM grade 0-3 (diverge de correctScoreRule)", () => {
  it("palpite 4-1 sobre um 4-1 → won (fora da grade, mas liquida — NÃO pending)", () => {
    expect(settleExactScorePalpite({ home: 4, away: 1 }, rd(4, 1))).toBe("won");
  });

  it("palpite 4-1 sobre um 4-2 → lost (fora da grade que não bate liquida, não fica pending)", () => {
    expect(settleExactScorePalpite({ home: 4, away: 1 }, rd(4, 2))).toBe(
      "lost"
    );
  });

  it("placar real alto (5-2) confere normalmente", () => {
    expect(settleExactScorePalpite({ home: 5, away: 2 }, rd(5, 2))).toBe("won");
    expect(settleExactScorePalpite({ home: 5, away: 2 }, rd(5, 3))).toBe(
      "lost"
    );
  });
});

describe("settleExactScorePalpite — defense-in-depth (params/score inválidos)", () => {
  it("lança SettlementError em params malformados", () => {
    expect(() => settleExactScorePalpite(null, rd(1, 0))).toThrow(
      SettlementError
    );
    expect(() => settleExactScorePalpite({ home: 1 }, rd(1, 0))).toThrow(
      SettlementError
    );
    expect(() =>
      settleExactScorePalpite({ home: -1, away: 0 }, rd(1, 0))
    ).toThrow(SettlementError);
    expect(() =>
      settleExactScorePalpite({ home: 1.5, away: 0 }, rd(1, 0))
    ).toThrow(SettlementError);
  });

  it("lança SettlementError em split de 90' null (resultData corrompido)", () => {
    expect(() =>
      settleExactScorePalpite(
        { home: 1, away: 1 },
        { homeScore: null, awayScore: 1, totalGoals: 1 }
      )
    ).toThrow(SettlementError);
    expect(() =>
      settleExactScorePalpite(
        { home: 1, away: 1 },
        { homeScore: 1, awayScore: null, totalGoals: 1 }
      )
    ).toThrow(SettlementError);
  });
});
