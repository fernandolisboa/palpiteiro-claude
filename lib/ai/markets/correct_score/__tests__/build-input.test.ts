import { describe, expect, it } from "vitest";

import {
  buildPredictionInput,
  BuildInputError,
  buildUserMessage,
  correctScoreCartridge,
} from "@/lib/ai/markets/correct_score";
import { CORRECT_SCORE_KEYS } from "@/lib/ai/markets/correct_score/schemas";
import { MIN_EDGE_PP } from "@/lib/odds/scenario";
import type { NormalizedStanding } from "@/lib/providers/sports-data/types";

const STANDINGS: NormalizedStanding = {
  league: "brasileirao_a",
  season: 2026,
  tables: [
    {
      teams: [
        {
          position: 1,
          team: "CR Flamengo",
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
          team: "Fluminense FC",
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

// 16 seleções com odds plausíveis e a implícita normalizada uniforme (6.25%).
function allCellSelections(): { key: string; odd: number }[] {
  return CORRECT_SCORE_KEYS.map((key, i) => ({ key, odd: 8 + i }));
}
function allCellImplied(): Record<string, number> {
  const pct: Record<string, number> = {};
  for (const k of CORRECT_SCORE_KEYS) pct[k] = 6.25;
  return pct;
}

function baseArgs() {
  return {
    match: {
      externalId: "ext-1",
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: new Date("2026-05-15T19:00:00.000Z"),
      venue: "Maracanã",
    },
    standings: STANDINGS,
    home: { form: [], injuries: [], absencesAvailable: true },
    away: { form: [], injuries: [], absencesAvailable: true },
    lineups: undefined,
    h2h: [],
    odds: {
      bookmaker: "Bet365",
      captured_at: "2026-05-15T12:00:00.000Z",
      selections: allCellSelections(),
    },
    implied: { pct: allCellImplied() },
  };
}

describe("correct_score buildPredictionInput — 16-cell loop", () => {
  it("maps all 16 generic selections into the cells record + per-cell implied", () => {
    const input = buildPredictionInput(baseArgs());
    expect(Object.keys(input.odds.cells)).toHaveLength(16);
    expect(Object.keys(input.implied)).toHaveLength(16);
    expect(input.odds.cells.cs_0_0).toBe(8);
    expect(input.odds.cells.cs_3_3).toBe(8 + 15);
    expect(input.implied.cs_2_1).toBe(6.25);
    expect(input.odds.bookmaker).toBe("Bet365");
  });

  it("throws BuildInputError when ANY of the 16 cells is missing in odds", () => {
    const args = baseArgs();
    args.odds.selections = args.odds.selections.filter(
      (s) => s.key !== "cs_3_3",
    );
    expect(() => buildPredictionInput(args)).toThrow(BuildInputError);
  });

  it("throws BuildInputError when ANY of the 16 cells is missing in implied", () => {
    const args = baseArgs();
    delete args.implied.pct.cs_0_0;
    expect(() => buildPredictionInput(args)).toThrow(BuildInputError);
  });

  it("throws BuildInputError when a standings row is missing", () => {
    const args = baseArgs();
    args.match.homeTeam = "Unknown FC";
    expect(() => buildPredictionInput(args)).toThrow(BuildInputError);
  });
});

describe("correct_score buildUserMessage — grid framing snapshot", () => {
  it("renders the 4×4 grid of odd → implied per cell", () => {
    const input = buildPredictionInput(baseArgs());
    const message = buildUserMessage(input, { daysToKickoff: 3 });
    // Cabeçalho + as 16 linhas do grid presentes.
    expect(message).toContain("# Odds e probabilidades implícitas (placar exato)");
    expect(message).toContain("- 0-0: odd 8.00 → implícita normalizada 6.25%");
    expect(message).toContain("- 3-3: odd 23.00 → implícita normalizada 6.25%");
    // 16 linhas de célula no total.
    const cellLines = message
      .split("\n")
      .filter((l) => /^- \d-\d: odd /.test(l));
    expect(cellLines).toHaveLength(16);
  });
});

describe("correct_score cartridge — selectionProbs + MIN_EDGE_PP sync", () => {
  it("selectionProbs returns the 16-cell record directly (OPTION B)", () => {
    const probs: Record<string, number> = {};
    for (const k of CORRECT_SCORE_KEYS) probs[k] = 6;
    const out = correctScoreCartridge.selectionProbs({
      recommendation: "cs_1_1",
      confidence_pct: 6,
      cell_probs: probs,
      rationale: "x",
      key_factors: ["a", "b"],
      minimum_odd: 9,
    });
    expect(Object.keys(out)).toHaveLength(16);
    expect(out.cs_1_1).toBe(6);
  });

  it("the UI threshold constant matches the prompt's edge rule", () => {
    expect(correctScoreCartridge.systemPrompt).toContain(
      `${MIN_EDGE_PP} pontos percentuais`,
    );
  });
});
