import { describe, expect, it } from "vitest";

import { toMatchRowResultOdds } from "@/lib/view/odds";

describe("rótulos 1X2 com o nome dos times (#574)", () => {
  const snap = {
    bookmaker: "x",
    capturedAt: new Date("2026-05-15T10:00:00Z"),
    selections: [
      { key: "home", odd: "2.670" },
      { key: "draw", odd: "2.870" },
      { key: "away", odd: "3.060" },
    ],
  };

  it("toMatchRowResultOdds com a sigla; sem teams fica igual a antes", () => {
    expect(
      toMatchRowResultOdds(snap, "match_result", { home: "PAL", away: "FLA" }).outcomes,
    ).toEqual([
      { label: "PAL", odd: "2,67" },
      { label: "Empate", odd: "2,87" },
      { label: "FLA", odd: "3,06" },
    ]);
    expect(toMatchRowResultOdds(snap, "match_result").outcomes.map((o) => o.label)).toEqual([
      "Casa",
      "Empate",
      "Fora",
    ]);
  });
});
