import { describe, expect, it } from "vitest";

import {
  isNeutralFinalFixture,
  isNeutralVenue,
} from "@/lib/providers/sports-data/neutral-venue";

describe("isNeutralFinalFixture", () => {
  it("final das copas de jogo único (rótulos da API-Football e do football-data.org)", () => {
    expect(
      isNeutralFinalFixture({ league: "copa_libertadores", round: "Final" })
    ).toBe(true);
    expect(
      isNeutralFinalFixture({ league: "copa_sudamericana", round: "Final" })
    ).toBe(true);
    expect(
      isNeutralFinalFixture({ league: "champions_league", round: "FINAL" })
    ).toBe(true);
    expect(
      isNeutralFinalFixture({ league: "copa_libertadores", round: " final " })
    ).toBe(true);
  });

  it("outras fases não são neutras (semifinal não casa com 'final')", () => {
    for (const round of [
      "Semi-finals",
      "SEMI_FINALS",
      "Quarter-finals",
      "Round of 16",
      "Group Stage - 6",
      "3rd Place Final",
    ]) {
      expect(
        isNeutralFinalFixture({ league: "copa_libertadores", round })
      ).toBe(false);
    }
  });

  it("sem fase do provider → não neutro", () => {
    expect(isNeutralFinalFixture({ league: "copa_libertadores" })).toBe(false);
    expect(
      isNeutralFinalFixture({ league: "copa_libertadores", round: null })
    ).toBe(false);
  });

  it("ligas de pontos corridos nunca têm final neutra", () => {
    expect(
      isNeutralFinalFixture({ league: "brasileirao_a", round: "Final" })
    ).toBe(false);
    expect(
      isNeutralFinalFixture({ league: "premier_league", round: "Final" })
    ).toBe(false);
  });
});

describe("isNeutralVenue", () => {
  it("Copa do Mundo é neutra por liga, sem depender da coluna", () => {
    expect(isNeutralVenue({ league: "world_cup", neutralVenue: false })).toBe(
      true
    );
  });

  it("clube segue a coluna gravada no sync", () => {
    expect(
      isNeutralVenue({ league: "copa_libertadores", neutralVenue: true })
    ).toBe(true);
    expect(
      isNeutralVenue({ league: "copa_libertadores", neutralVenue: false })
    ).toBe(false);
    expect(
      isNeutralVenue({ league: "brasileirao_a", neutralVenue: false })
    ).toBe(false);
  });
});
