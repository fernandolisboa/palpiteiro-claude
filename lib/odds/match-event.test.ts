import { describe, expect, it } from "vitest";

import { findEventInList, KICKOFF_PAIRING_WINDOW_MS } from "@/lib/odds/match-event";

const KICKOFF = new Date("2026-06-11T19:00:00.000Z");
const match = {
  kickoffAt: KICKOFF,
  homeTeam: "CR Flamengo",
  awayTeam: "Fluminense FC",
};

// Lista GRATUITA de eventos (sem bookmakers) — o shape estrutural mínimo.
function listItem(over: Partial<{ id: string; home_team: string; away_team: string; commence_time: string }> = {}) {
  return {
    id: "evt-1",
    sport_key: "soccer_fifa_world_cup",
    commence_time: KICKOFF.toISOString(),
    home_team: "CR Flamengo",
    away_team: "Fluminense FC",
    ...over,
  };
}

describe("findEventInList", () => {
  it("pareia pela dupla de times dentro da janela de kickoff (lista sem bookmakers)", () => {
    const found = findEventInList([listItem()], match);
    expect(found?.id).toBe("evt-1");
  });

  it("tolera grafia divergente do provider (teamsMatch: inclusão bidirecional)", () => {
    const found = findEventInList(
      [listItem({ home_team: "Flamengo", away_team: "Fluminense" })],
      match,
    );
    expect(found?.id).toBe("evt-1");
  });

  it("rejeita evento fora da janela de ±6h (mesma dupla, jogo errado)", () => {
    const outside = new Date(KICKOFF.getTime() + KICKOFF_PAIRING_WINDOW_MS + 60_000);
    const found = findEventInList(
      [listItem({ commence_time: outside.toISOString() })],
      match,
    );
    expect(found).toBeUndefined();
  });

  it("rejeita dupla de times diferente dentro da janela", () => {
    const found = findEventInList(
      [listItem({ home_team: "Palmeiras", away_team: "Corinthians" })],
      match,
    );
    expect(found).toBeUndefined();
  });

  it("também aceita um payload COM bookmakers (mesmo matcher pro caminho featured)", () => {
    const withOdds = { ...listItem(), bookmakers: [] };
    const found = findEventInList([withOdds], match);
    expect(found?.id).toBe("evt-1");
  });
});
