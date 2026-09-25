import { describe, expect, it } from "vitest";

import { resolveModelScoreline } from "@/lib/ai/engine/model-scoreline";
import { computeMatchLambdas } from "@/lib/providers/sports-data/match-lambdas";
import type { NormalizedStanding } from "@/lib/providers/sports-data/types";
import { scorelineMatrix } from "@/lib/quant/scoreline-model";

const split = (played: number, goalsFor: number, goalsAgainst: number) => ({
  played,
  wins: 0,
  draws: 0,
  losses: 0,
  goalsFor,
  goalsAgainst,
});

const STANDING: NormalizedStanding = {
  league: "brasileirao_a",
  season: 2026,
  tables: [
    {
      teams: [
        {
          position: 1,
          team: "Casa FC",
          played: 12,
          won: 8,
          draw: 2,
          lost: 2,
          goalsFor: 24,
          goalsAgainst: 10,
          points: 26,
          homeSplit: split(6, 15, 4),
          awaySplit: split(6, 9, 6),
        },
        {
          position: 2,
          team: "Fora FC",
          played: 12,
          won: 6,
          draw: 3,
          lost: 3,
          goalsFor: 18,
          goalsAgainst: 14,
          points: 21,
          homeSplit: split(6, 10, 6),
          awaySplit: split(6, 8, 8),
        },
      ],
    },
  ],
};

const ARGS = {
  standing: STANDING,
  homeTeam: "Casa FC",
  awayTeam: "Fora FC",
  neutral: false,
};

describe("resolveModelScoreline", () => {
  it("caminho heurístico = computeMatchLambdas + scorelineMatrix", () => {
    const lambdas = computeMatchLambdas(ARGS)!;
    const model = resolveModelScoreline(ARGS)!;
    expect(model.source).toBe("heuristic");
    expect(model.degraded).toBe(lambdas.degradedData);
    expect(model.lambdaHome).toBe(lambdas.lambdaHome);
    expect(model.lambdaAway).toBe(lambdas.lambdaAway);
    expect(model.rho).toBeUndefined();
    expect(model.matrix).toEqual(
      scorelineMatrix(lambdas.lambdaHome, lambdas.lambdaAway)
    );
  });

  it("sem tabela → null (o predict cai no caminho LLM)", () => {
    expect(resolveModelScoreline({ ...ARGS, standing: undefined })).toBeNull();
  });
});
