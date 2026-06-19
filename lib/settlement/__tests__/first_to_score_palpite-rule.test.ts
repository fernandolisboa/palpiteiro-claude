import { describe, expect, it } from "vitest";

import type { PalpiteResultData } from "@/db/schema";
import { settleFirstToScorePalpite } from "@/lib/settlement/rules/first_to_score_palpite";
import { SettlementError } from "@/lib/settlement/schemas";

// rd já com firstToScore derivado + eventsAvailable. A regra NÃO deriva — só compara.
function rd(
  firstToScore: "home" | "away" | "none" | undefined,
  eventsAvailable = true,
): PalpiteResultData {
  const base: PalpiteResultData = {
    homeScore: 2,
    awayScore: 1,
    totalGoals: 3,
    eventsAvailable,
  };
  if (firstToScore !== undefined) base.firstToScore = firstToScore;
  return base;
}

describe("settleFirstToScorePalpite — primeiro a marcar", () => {
  it("palpite home == derivado home → won", () => {
    expect(settleFirstToScorePalpite({ firstToScore: "home" }, rd("home"))).toBe(
      "won",
    );
  });

  it("palpite home vs derivado away → lost", () => {
    expect(settleFirstToScorePalpite({ firstToScore: "home" }, rd("away"))).toBe(
      "lost",
    );
  });

  it("palpite none == derivado none (0-0) → won", () => {
    expect(settleFirstToScorePalpite({ firstToScore: "none" }, rd("none"))).toBe(
      "won",
    );
  });
});

describe("settleFirstToScorePalpite — prefer skip", () => {
  it("eventsAvailable !== true → throw → PENDING", () => {
    expect(() =>
      settleFirstToScorePalpite({ firstToScore: "home" }, rd("home", false)),
    ).toThrow(SettlementError);
  });

  it("firstToScore undefined (ambíguo: OG-primeiro / minuto null / empate) → throw → PENDING", () => {
    expect(() =>
      settleFirstToScorePalpite({ firstToScore: "home" }, rd(undefined, true)),
    ).toThrow(SettlementError);
  });

  it("params inválidos → throw", () => {
    expect(() =>
      settleFirstToScorePalpite({ firstToScore: "both" }, rd("home")),
    ).toThrow(SettlementError);
  });
});
