import { describe, expect, it } from "vitest";

import {
  anytimeScorerCartridge,
  buildPredictionInput,
  BuildInputError,
  ScorerOutputSchema,
  SYSTEM_PROMPT,
  buildUserMessage,
  type BuildPredictionInputArgs,
} from "@/lib/ai/markets/anytime_scorer";
import type {
  NormalizedFixture,
  NormalizedStanding,
} from "@/lib/providers/sports-data/types";

const STANDING = (team: string): NormalizedStanding["tables"][number]["teams"][number] => ({
  position: 1,
  team,
  played: 10,
  won: 6,
  draw: 2,
  lost: 2,
  goalsFor: 20,
  goalsAgainst: 10,
  points: 20,
});

const standings: NormalizedStanding = {
  league: "brasileirao_a",
  season: 2026,
  tables: [{ teams: [STANDING("Flamengo"), STANDING("Palmeiras")] }],
};

const fixtures: NormalizedFixture[] = [];

function args(): BuildPredictionInputArgs {
  return {
    match: {
      externalId: "ext-1",
      league: "brasileirao_a",
      homeTeam: "Flamengo",
      awayTeam: "Palmeiras",
      kickoffAt: new Date("2026-07-22T23:00:00Z"),
      venue: "Maracanã",
    },
    standings,
    home: { form: fixtures, injuries: [], absencesAvailable: true },
    away: { form: fixtures, injuries: [], absencesAvailable: true },
    lineups: undefined,
    h2h: [],
    odds: {
      bookmaker: "Bet365",
      captured_at: "2026-07-22T20:00:00.000Z",
      selections: [
        { key: "scorer_pedro", odd: 2.5 },
        { key: "scorer_arrascaeta", odd: 4.0 },
      ],
      playerLabels: { scorer_pedro: "Pedro", scorer_arrascaeta: "Arrascaeta" },
    },
    implied: { pct: { scorer_pedro: 40, scorer_arrascaeta: 25 } },
  };
}

describe("anytime_scorer prompt", () => {
  it("hardcoda o piso de edge de 8 pontos percentuais (sincronia UI↔prompt)", () => {
    expect(SYSTEM_PROMPT).toContain("8 pontos percentuais");
    expect(SYSTEM_PROMPT).toContain("edge >= 8%");
  });

  it("tool exige recommendation/confidence/player_probs", () => {
    expect(anytimeScorerCartridge.toolName).toBe("submit_prediction");
  });
});

describe("anytime_scorer buildPredictionInput", () => {
  it("down-mapeia selections+labels+implied → players[] com nome e teto", () => {
    const input = buildPredictionInput(args());
    expect(input.players).toEqual([
      { key: "scorer_pedro", name: "Pedro", odd: 2.5, implied_ceiling_pct: 40 },
      {
        key: "scorer_arrascaeta",
        name: "Arrascaeta",
        odd: 4.0,
        implied_ceiling_pct: 25,
      },
    ]);
    expect(input.bookmaker).toBe("Bet365");
  });

  it("BuildInputError quando falta o label de um jogador (prefer-skip)", () => {
    const a = args();
    a.odds.playerLabels = { scorer_pedro: "Pedro" }; // falta arrascaeta
    expect(() => buildPredictionInput(a)).toThrow(BuildInputError);
  });

  it("BuildInputError quando falta a implícita de um jogador", () => {
    const a = args();
    a.implied.pct = { scorer_pedro: 40 };
    expect(() => buildPredictionInput(a)).toThrow(BuildInputError);
  });
});

describe("anytime_scorer buildUserMessage", () => {
  it("renderiza cada jogador com nome, key, odd e implícita-teto", () => {
    const msg = buildUserMessage(buildPredictionInput(args()), {
      daysToKickoff: 1,
    });
    expect(msg).toContain("Pedro [scorer_pedro]: odd 2.50 → implícita (teto) 40.00%");
    expect(msg).toContain("Arrascaeta [scorer_arrascaeta]");
  });
});

describe("anytime_scorer selectionProbs", () => {
  it("retorna player_probs direto (probs independentes, não somam 100)", () => {
    const output = ScorerOutputSchema.parse({
      recommendation: "scorer_pedro",
      confidence_pct: 52,
      player_probs: { scorer_pedro: 52, scorer_arrascaeta: 28 },
      rationale: "Pedro é o melhor palpite.",
      key_factors: ["forma recente", "papel de centroavante"],
      minimum_odd: 2.1,
    });
    expect(anytimeScorerCartridge.selectionProbs(output)).toEqual({
      scorer_pedro: 52,
      scorer_arrascaeta: 28,
    });
  });

  it("rejeita minimum_odd em pass; exige em recomendação", () => {
    expect(
      ScorerOutputSchema.safeParse({
        recommendation: "pass",
        confidence_pct: 30,
        player_probs: {},
        rationale: "Melhor não apostar.",
        key_factors: ["incerteza", "sem lineup"],
        minimum_odd: 2.0,
      }).success,
    ).toBe(false);
    expect(
      ScorerOutputSchema.safeParse({
        recommendation: "scorer_pedro",
        confidence_pct: 52,
        player_probs: { scorer_pedro: 52 },
        rationale: "Pedro.",
        key_factors: ["a", "b"],
      }).success,
    ).toBe(false);
  });
});
