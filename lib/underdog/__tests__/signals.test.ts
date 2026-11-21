import { describe, expect, it } from "vitest";

import type { NormalizedFixture } from "@/lib/providers/sports-data/types";
import {
  dataSignals,
  formResults,
  h2hTally,
  jevSignals,
} from "@/lib/underdog/signals";

import { answers } from "./fixtures";

const HOME = "SE Palmeiras";
const AWAY = "CR Flamengo";

function fx(
  home: string,
  away: string,
  hs: number | null,
  as: number | null,
  day: number
): NormalizedFixture {
  return {
    id: `fx-${home}-${away}-${day}`,
    kickoffTimestampMs: Date.UTC(2026, 9, day, 19),
    league: "brasileirao_a",
    kickoffAt: new Date(Date.UTC(2026, 9, day, 19)).toISOString(),
    homeTeam: home,
    awayTeam: away,
    status: "finished",
    score: { home: hs, away: as },
  } as NormalizedFixture;
}

const BASE = {
  side: "away" as const,
  teams: { home: HOME, away: AWAY },
  form: null,
  h2h: null,
  absences: null,
};

describe("h2h", () => {
  const h2h = [
    fx(HOME, AWAY, 0, 1, 1),
    fx(AWAY, HOME, 2, 0, 5),
    fx(HOME, AWAY, 1, 1, 9),
    fx(HOME, AWAY, 2, 1, 12),
    fx(AWAY, HOME, 3, 1, 15),
    fx(HOME, AWAY, null, null, 20),
  ];

  it("conta só confrontos com placar, do ponto de vista do time", () => {
    expect(h2hTally(AWAY, HOME, h2h)).toEqual({ games: 5, wins: 3, losses: 1 });
  });

  it("≥ 2 vitórias do azarão e ≥ as do favorito → sinal", () => {
    expect(dataSignals({ ...BASE, h2h })).toEqual([
      { kind: "h2h", games: 5, underdogWins: 3, favoriteWins: 1 },
    ]);
  });

  it("1 vitória só → sem sinal", () => {
    expect(
      dataSignals({
        ...BASE,
        h2h: [fx(HOME, AWAY, 0, 1, 1), fx(HOME, AWAY, 1, 0, 2)],
      })
    ).toEqual([]);
  });
});

describe("forma", () => {
  const dogForm = [1, 2, 3, 4, 5].map((d) =>
    fx(AWAY, "X", 2, d === 5 ? 2 : 0, d)
  );
  const favForm = [1, 2, 3, 4, 5].map((d) =>
    fx(HOME, "Y", d > 3 ? 1 : 0, d > 3 ? 0 : 1, d)
  );

  it("V/E/D do mais recente ao mais antigo", () => {
    expect(formResults(AWAY, dogForm)).toEqual(["D", "W", "W", "W", "W"]);
  });

  it("pontos do azarão ≥ do favorito → sinal", () => {
    const out = dataSignals({
      ...BASE,
      form: { home: favForm, away: dogForm },
    });
    expect(out).toEqual([
      {
        kind: "form",
        underdog: ["D", "W", "W", "W", "W"],
        favorite: ["W", "W", "L", "L", "L"],
      },
    ]);
  });

  it("azarão pior → sem sinal", () => {
    const favWins = [1, 2, 3].map((d) => fx(HOME, "Y", 1, 0, d));
    const dogLosses = [1, 2, 3].map((d) => fx(AWAY, "X", 0, 1, d));
    expect(
      dataSignals({ ...BASE, form: { home: favWins, away: dogLosses } })
    ).toEqual([]);
  });
});

describe("desfalques", () => {
  it("favorito com ≥ 3 e mais que o azarão → sinal", () => {
    expect(dataSignals({ ...BASE, absences: { home: 5, away: 1 } })).toEqual([
      { kind: "absences", favorite: 5, underdog: 1 },
    ]);
  });
  it.each([[{ home: 2, away: 0 }], [{ home: 3, away: 3 }]])(
    "%j → sem sinal",
    (absences) => {
      expect(dataSignals({ ...BASE, absences })).toEqual([]);
    }
  );
});

describe("JEV da base", () => {
  it("≥ 0,7 nos fatores do favorito e no peso do jogo do azarão", () => {
    expect(
      jevSignals(
        "away",
        answers({
          rotation_risk_home: 0.8,
          high_stakes_away: 0.7,
          attack_weakened_away: 0.9,
        })
      )
    ).toEqual([
      { kind: "jev", factor: "rotation_risk" },
      { kind: "jev", factor: "high_stakes" },
    ]);
  });
  it("0,69 não vira sinal; sem respostas → nada", () => {
    expect(jevSignals("away", answers({ rotation_risk_home: 0.69 }))).toEqual(
      []
    );
    expect(jevSignals("away", null)).toEqual([]);
  });
});

it("provider que falhou (null) omite o sinal; nada → lista vazia", () => {
  expect(dataSignals(BASE)).toEqual([]);
});
