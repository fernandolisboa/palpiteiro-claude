import { describe, expect, it } from "vitest";

import { isPreMatchForOdds } from "@/lib/odds/pre-match-gate";

const NOW = new Date("2026-10-15T18:00:00Z");
const at = (deltaMs: number) => new Date(NOW.getTime() + deltaMs);

describe("isPreMatchForOdds", () => {
  it("scheduled com kickoff no futuro → permite (inclui KO−1ms, fim da janela do CLV)", () => {
    expect(isPreMatchForOdds({ status: "scheduled", kickoffAt: at(90 * 60_000) }, NOW)).toBe(true);
    expect(isPreMatchForOdds({ status: "scheduled", kickoffAt: at(1) }, NOW)).toBe(true);
  });

  it("kickoff no instante ou no passado → bloqueia, mesmo com status stale scheduled", () => {
    expect(isPreMatchForOdds({ status: "scheduled", kickoffAt: NOW }, NOW)).toBe(false);
    expect(isPreMatchForOdds({ status: "scheduled", kickoffAt: at(-60_000) }, NOW)).toBe(false);
  });

  it.each(["live", "finished", "postponed", "cancelled"] as const)(
    "status %s → bloqueia mesmo com kickoff no futuro",
    (status) => {
      expect(isPreMatchForOdds({ status, kickoffAt: at(60 * 60_000) }, NOW)).toBe(false);
    },
  );
});
