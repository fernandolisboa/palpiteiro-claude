import { describe, expect, it } from "vitest";

import type { BetLegParams } from "@/db/schema";

import {
  isLiveSlipKind,
  LIVE_DECIDED_COPY,
  LIVE_KIND_COPY,
  liveSlipRefusal,
} from "@/lib/bets/live-slip";

describe("isLiveSlipKind (#580, PLAN-580 §9.2)", () => {
  it("só os tipos da tabela ao vivo", () => {
    expect(isLiveSlipKind("match_result", { selection: "home" })).toBe(true);
    expect(isLiveSlipKind("double_chance", { selection: "home_draw" })).toBe(true);
    expect(isLiveSlipKind("btts", { selection: "yes" })).toBe(true);
    expect(isLiveSlipKind("exact_score", { home: 2, away: 1 })).toBe(true);
    for (const line of [1.5, 2.5, 3.5]) {
      expect(isLiveSlipKind("over_under", { selection: "over", line })).toBe(true);
    }
  });

  it("fora: 1º tempo, quem marca primeiro, linhas fora da tabela e o resto", () => {
    expect(
      isLiveSlipKind("first_half_over_under", { selection: "over", line: 0.5 })
    ).toBe(false);
    expect(isLiveSlipKind("first_half_score", { home: 1, away: 0 })).toBe(false);
    expect(isLiveSlipKind("first_to_score", { firstToScore: "home" })).toBe(
      false
    );
    expect(isLiveSlipKind("over_under", { selection: "over", line: 4.5 })).toBe(
      false
    );
    expect(isLiveSlipKind("margin", { side: "home", minMargin: 2 })).toBe(false);
    expect(isLiveSlipKind("clean_sheet", { side: "home" })).toBe(false);
    expect(isLiveSlipKind("cards", { selection: "over", line: 4.5 })).toBe(false);
  });
});

describe("liveSlipRefusal", () => {
  const score = { home: 1, away: 1 };

  it("tudo em aberto → null", () => {
    expect(
      liveSlipRefusal(
        [
          { kind: "match_result", params: { selection: "home" } },
          { kind: "over_under", params: { selection: "over", line: 2.5 } },
          { kind: "exact_score", params: { home: 2, away: 1 } },
        ],
        score
      )
    ).toBeNull();
  });

  it("perna decidida (BTTS com 1–1, over 1,5 com 1–1, placar abaixo) → decidido", () => {
    const legs: { kind: string; params: BetLegParams }[] = [
      { kind: "btts", params: { selection: "no" } },
      { kind: "over_under", params: { selection: "under", line: 1.5 } },
      { kind: "exact_score", params: { home: 0, away: 1 } },
    ];
    for (const leg of legs) {
      expect(liveSlipRefusal([leg], score)).toBe(LIVE_DECIDED_COPY);
    }
  });

  it("tipo fora da tabela vence (mesmo com outra perna decidida)", () => {
    expect(
      liveSlipRefusal(
        [
          { kind: "btts", params: { selection: "yes" } },
          { kind: "first_to_score", params: { firstToScore: "home" } },
        ],
        score
      )
    ).toBe(LIVE_KIND_COPY);
  });
});
