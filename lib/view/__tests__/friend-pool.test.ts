import { describe, expect, it } from "vitest";

import { joinNames, poolBetLabel, poolMatchLabel } from "@/lib/view/friend-pool";

const teams = { home: "Flamengo", away: "Palmeiras" };

describe("poolBetLabel", () => {
  it.each([
    ["exact_score", { home: 2, away: 1 }, "Flamengo 2 × 1 Palmeiras"],
    ["match_result", { selection: "away" }, "Vitória do Palmeiras"],
    ["match_result", { selection: "draw" }, "Empate"],
    ["double_chance", { selection: "home_draw" }, "Flamengo ou empate"],
    ["btts", { selection: "yes" }, "Os dois times marcam"],
    ["over_under", { selection: "over", line: 2.5 }, "Mais de 2,5 gols"],
  ] as const)("%s %j", (kind, params, label) => {
    expect(poolBetLabel(kind, params, teams)).toBe(label);
  });
});

describe("poolMatchLabel", () => {
  it("jogo, competição, data e hora", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    const label = poolMatchLabel(
      {
        homeTeam: "Flamengo",
        awayTeam: "Palmeiras",
        league: "brasileirao_a",
        kickoffAt: new Date("2026-10-18T19:00:00Z"),
      },
      now,
      "America/Sao_Paulo",
    );
    expect(label).toBe("Flamengo × Palmeiras · Brasileirão · dom, 18 out, 16:00");
  });
});

describe("joinNames", () => {
  it.each([
    [[], ""],
    [["Ana"], "Ana"],
    [["Ana", "Bia"], "Ana e Bia"],
    [["Ana", "Bia", "Caio"], "Ana, Bia e Caio"],
  ])("%j", (names, out) => {
    expect(joinNames(names)).toBe(out);
  });
});
