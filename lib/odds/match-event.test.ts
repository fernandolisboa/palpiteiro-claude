import { describe, expect, it } from "vitest";

import { findEventInList, KICKOFF_PAIRING_WINDOW_MS } from "@/lib/odds/match-event";

const KICKOFF = new Date("2026-06-11T19:00:00.000Z");
const match = {
  kickoffAt: KICKOFF,
  homeTeam: "CR Flamengo",
  awayTeam: "Fluminense FC",
};

// Lista GRATUITA de eventos (sem bookmakers) — o shape estrutural mínimo.
function listItem(over: Partial<{ id: string; homeTeam: string; awayTeam: string; commenceTime: string }> = {}) {
  return {
    id: "evt-1",
    commenceTime: KICKOFF.toISOString(),
    homeTeam: "CR Flamengo",
    awayTeam: "Fluminense FC",
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
      [listItem({ homeTeam: "Flamengo", awayTeam: "Fluminense" })],
      match,
    );
    expect(found?.id).toBe("evt-1");
  });

  it("rejeita evento fora da janela de ±6h (mesma dupla, jogo errado)", () => {
    const outside = new Date(KICKOFF.getTime() + KICKOFF_PAIRING_WINDOW_MS + 60_000);
    const found = findEventInList(
      [listItem({ commenceTime: outside.toISOString() })],
      match,
    );
    expect(found).toBeUndefined();
  });

  it("rejeita dupla de times diferente dentro da janela", () => {
    const found = findEventInList(
      [listItem({ homeTeam: "Palmeiras", awayTeam: "Corinthians" })],
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
