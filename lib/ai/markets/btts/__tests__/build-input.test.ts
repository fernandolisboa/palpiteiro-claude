import { describe, expect, it } from "vitest";

import {
  buildPredictionInput,
  BuildInputError,
  type BuildPredictionInputArgs,
} from "@/lib/ai/markets/btts/build-input";
import type { NormalizedStanding } from "@/lib/providers/sports-data/types";

// Standings com os dois times (findStandingTeamByName casa por nome exato).
const STANDINGS: NormalizedStanding = {
  league: "world_cup",
  season: 2026,
  tables: [
    {
      teams: [
        {
          position: 1,
          team: "Mexico",
          played: 10,
          won: 6,
          draw: 2,
          lost: 2,
          goalsFor: 18,
          goalsAgainst: 9,
          points: 20,
        },
        {
          position: 2,
          team: "South Africa",
          played: 10,
          won: 5,
          draw: 3,
          lost: 2,
          goalsFor: 15,
          goalsAgainst: 10,
          points: 18,
        },
      ],
    },
  ],
};

function baseArgs(
  over: Partial<BuildPredictionInputArgs> = {},
): BuildPredictionInputArgs {
  return {
    match: {
      externalId: "ext-1",
      league: "world_cup",
      homeTeam: "Mexico",
      awayTeam: "South Africa",
      kickoffAt: new Date("2026-06-11T19:00:00.000Z"),
    },
    standings: STANDINGS,
    home: { form: [], injuries: [], absencesAvailable: true },
    away: { form: [], injuries: [], absencesAvailable: false },
    lineups: undefined,
    h2h: [],
    odds: {
      bookmaker: "Pinnacle",
      captured_at: "2026-06-11T12:00:00.000Z",
      selections: [
        { key: "yes", odd: 2.06 },
        { key: "no", odd: 1.81 },
      ],
    },
    implied: { pct: { yes: 46.8, no: 53.2 } },
    ...over,
  };
}

describe("btts buildPredictionInput — down-map genérico → binário yes/no", () => {
  it("coloca a odd 'yes' em yes_decimal, 'no' em no_decimal, e os pct nos campos certos", () => {
    const input = buildPredictionInput(baseArgs());
    // O teste que PEGA um swap yes/no ou um pct mis-keyed:
    expect(input.odds.yes_decimal).toBe(2.06);
    expect(input.odds.no_decimal).toBe(1.81);
    expect(input.implied.yes_pct).toBe(46.8);
    expect(input.implied.no_pct).toBe(53.2);
    expect(input.odds.bookmaker).toBe("Pinnacle");
    expect(input.odds.captured_at).toBe("2026-06-11T12:00:00.000Z");
    // metadados do match passam adiante.
    expect(input.match.home_team.name).toBe("Mexico");
    expect(input.match.away_team.name).toBe("South Africa");
  });

  it("a ordem das selections no array genérico não importa (casa por key)", () => {
    const input = buildPredictionInput(
      baseArgs({
        odds: {
          bookmaker: "Pinnacle",
          captured_at: "2026-06-11T12:00:00.000Z",
          // invertido de propósito: no antes de yes.
          selections: [
            { key: "no", odd: 1.81 },
            { key: "yes", odd: 2.06 },
          ],
        },
      }),
    );
    expect(input.odds.yes_decimal).toBe(2.06);
    expect(input.odds.no_decimal).toBe(1.81);
  });
});

describe("btts buildPredictionInput — guards (BuildInputError antes do uso)", () => {
  it("lança quando o standings não tem o time da casa", () => {
    expect(() => buildPredictionInput(baseArgs({ standings: undefined }))).toThrow(
      BuildInputError,
    );
  });

  it("lança quando a seleção 'no' falta nas odds genéricas", () => {
    expect(() =>
      buildPredictionInput(
        baseArgs({
          odds: {
            bookmaker: "Pinnacle",
            captured_at: "2026-06-11T12:00:00.000Z",
            selections: [{ key: "yes", odd: 2.06 }],
          },
        }),
      ),
    ).toThrow(BuildInputError);
  });

  it("lança quando implied.pct.no está ausente", () => {
    expect(() =>
      buildPredictionInput(baseArgs({ implied: { pct: { yes: 46.8 } } })),
    ).toThrow(BuildInputError);
  });
});
