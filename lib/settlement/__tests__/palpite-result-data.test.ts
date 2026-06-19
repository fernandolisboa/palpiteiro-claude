import { describe, expect, it } from "vitest";

import type { NormalizedFixtureEvents } from "@/lib/providers/sports-data/types";
import { palpiteResultDataFrom } from "@/lib/settlement/palpite-result-data";

function goal(
  over: Partial<NormalizedFixtureEvents["goals"][number]> = {},
): NormalizedFixtureEvents["goals"][number] {
  return {
    playerId: null,
    playerName: "Jogador",
    teamSide: "home",
    minute: 30,
    isPenalty: false,
    isOwnGoal: false,
    isRegulation: true,
    ...over,
  };
}

function events(
  goals: NormalizedFixtureEvents["goals"],
  eventsAvailable = true,
): NormalizedFixtureEvents {
  return { fixtureStatus: "finished", eventsAvailable, goals, assists: [] };
}

describe("palpiteResultDataFrom — halftime", () => {
  it("popula halftime quando fornecido", () => {
    const r = palpiteResultDataFrom(
      { home: 2, away: 1 },
      { halftimeScore: { home: 1, away: 0 } },
    );
    expect(r.halftimeHomeScore).toBe(1);
    expect(r.halftimeAwayScore).toBe(0);
  });

  it("halftime null/ausente → campos undefined (first_half_score PENDING)", () => {
    const r1 = palpiteResultDataFrom({ home: 2, away: 1 }, { halftimeScore: null });
    expect(r1.halftimeHomeScore).toBeUndefined();
    const r2 = palpiteResultDataFrom({ home: 2, away: 1 });
    expect(r2.halftimeHomeScore).toBeUndefined();
  });
});

describe("palpiteResultDataFrom — derivação de firstToScore", () => {
  it("home marca primeiro (minuto menor) → 'home'", () => {
    const r = palpiteResultDataFrom(
      { home: 2, away: 1 },
      {
        events: events([
          goal({ teamSide: "home", minute: 20 }),
          goal({ teamSide: "away", minute: 50 }),
          goal({ teamSide: "home", minute: 70 }),
        ]),
      },
    );
    expect(r.eventsAvailable).toBe(true);
    expect(r.firstToScore).toBe("home");
  });

  it("0 gols de regulação (0-0) → 'none'", () => {
    const r = palpiteResultDataFrom({ home: 0, away: 0 }, { events: events([]) });
    expect(r.firstToScore).toBe("none");
  });

  it("[major B] PRIMEIRO gol relevante é own goal → undefined (PENDING, wire não verificado)", () => {
    const r = palpiteResultDataFrom(
      { home: 0, away: 1 },
      {
        events: events([
          goal({ teamSide: "home", minute: 15, isOwnGoal: true }),
        ]),
      },
    );
    expect(r.firstToScore).toBeUndefined();
  });

  it("own goal MAIS TARDE (depois de um gol normal) NÃO muda o firstToScore", () => {
    const r = palpiteResultDataFrom(
      { home: 1, away: 1 },
      {
        events: events([
          goal({ teamSide: "home", minute: 20 }),
          goal({ teamSide: "home", minute: 70, isOwnGoal: true }),
        ]),
      },
    );
    expect(r.firstToScore).toBe("home");
  });

  it("empate de minuto entre lados OPOSTOS no topo → undefined (ambíguo)", () => {
    const r = palpiteResultDataFrom(
      { home: 1, away: 1 },
      {
        events: events([
          goal({ teamSide: "home", minute: 45 }),
          goal({ teamSide: "away", minute: 45 }),
        ]),
      },
    );
    expect(r.firstToScore).toBeUndefined();
  });

  it("mesmo minuto, MESMO lado → sem ambiguidade", () => {
    const r = palpiteResultDataFrom(
      { home: 2, away: 0 },
      {
        events: events([
          goal({ teamSide: "home", minute: 45 }),
          goal({ teamSide: "home", minute: 45 }),
        ]),
      },
    );
    expect(r.firstToScore).toBe("home");
  });

  it("minuto null no PRIMEIRO gol relevante → undefined", () => {
    const r = palpiteResultDataFrom(
      { home: 1, away: 0 },
      { events: events([goal({ teamSide: "home", minute: null })]) },
    );
    expect(r.firstToScore).toBeUndefined();
  });

  it("feed incompleto (placar tem gols, lista de regulação vazia) → eventsAvailable mas firstToScore undefined", () => {
    const r = palpiteResultDataFrom(
      { home: 3, away: 1 },
      {
        events: events([goal({ isRegulation: false, minute: 105 })]),
      },
    );
    expect(r.firstToScore).toBeUndefined();
  });

  it("eventsAvailable false → eventsAvailable false, firstToScore undefined", () => {
    const r = palpiteResultDataFrom(
      { home: 2, away: 1 },
      { events: events([goal()], false) },
    );
    expect(r.eventsAvailable).toBe(false);
    expect(r.firstToScore).toBeUndefined();
  });
});
