import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ModelScoreline } from "@/lib/quant/match-model";
import { scorelineMatrix } from "@/lib/quant/scoreline-model";

const getMatchModelScoreline = vi.fn();
const getModelScoreline = vi.fn();
const getStandings = vi.fn();

vi.mock("@/lib/model-base/model-scoreline", () => ({
  getMatchModelScoreline: (...args: unknown[]) => getMatchModelScoreline(...args),
}));
vi.mock("@/lib/ratings/model-scoreline", () => ({
  getModelScoreline: (...args: unknown[]) => getModelScoreline(...args),
}));
vi.mock("@/lib/providers/sports-data", () => ({
  getSportsDataProvider: () => ({ getStandings }),
}));

import { resolveSlipModel } from "../slip-model";

const match = {
  id: "00000000-0000-4000-8000-000000000001",
  league: "brasileirao_a" as const,
  homeTeam: "Flamengo",
  awayTeam: "Palmeiras",
  neutralVenue: false,
};

function model(source: ModelScoreline["source"], home: number): ModelScoreline {
  return {
    source,
    degraded: false,
    lambdaHome: home,
    lambdaAway: 1.1,
    matrix: scorelineMatrix(home, 1.1),
  };
}

describe("resolveSlipModel (#560)", () => {
  beforeEach(() => {
    getMatchModelScoreline.mockReset();
    getModelScoreline.mockReset();
    getStandings.mockReset();
  });

  it("usa a base do jogo quando há snapshot fresco, sem buscar tabela nem ratings", async () => {
    const fromBase = model("dixon_coles", 1.7);
    getMatchModelScoreline.mockResolvedValue(fromBase);

    await expect(resolveSlipModel(match)).resolves.toBe(fromBase);
    expect(getMatchModelScoreline).toHaveBeenCalledWith(match.id);
    expect(getStandings).not.toHaveBeenCalled();
    expect(getModelScoreline).not.toHaveBeenCalled();
  });

  it("sem base cai no cálculo na hora (getModelScoreline com a tabela)", async () => {
    const live = model("heuristic", 1.4);
    getMatchModelScoreline.mockResolvedValue(null);
    getStandings.mockResolvedValue(undefined);
    getModelScoreline.mockResolvedValue(live);

    await expect(resolveSlipModel(match)).resolves.toBe(live);
    expect(getModelScoreline).toHaveBeenCalledWith(
      expect.objectContaining({
        league: "brasileirao_a",
        homeTeam: "Flamengo",
        awayTeam: "Palmeiras",
        neutral: false,
      }),
    );
  });
});
