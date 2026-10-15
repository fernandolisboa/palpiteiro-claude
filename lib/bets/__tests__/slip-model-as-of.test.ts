import { beforeEach, describe, expect, it, vi } from "vitest";

// resolveSlipModel com o leitor REAL da base (getMatchModelScoreline): só a query é
// mockada. Prova a paridade do minuto 0 do modo ao vivo (#591, PLAN-580 §6.1/R10): com
// `asOf = kickoff`, depois do apito sai a MESMA base que a página mostrava antes dele.
const getLatest = vi.fn();
const getModelScoreline = vi.fn();
const getStandings = vi.fn();

vi.mock("@/lib/db/queries/match-model-snapshots", () => ({
  getLatestMatchModelSnapshotWithKickoff: (...args: unknown[]) => getLatest(...args),
}));
vi.mock("@/lib/ratings/model-scoreline", () => ({
  getModelScoreline: (...args: unknown[]) => getModelScoreline(...args),
}));
vi.mock("@/lib/providers/sports-data", () => ({
  getSportsDataProvider: () => ({ getStandings }),
}));

import { resolveSlipModel } from "@/lib/bets/slip-model";
import {
  getMatchModelScoreline,
  MODEL_SCORELINE_MAX_AGE_MS,
} from "@/lib/model-base/model-scoreline";
import type { MatchModelSnapshot } from "@/lib/model-base/types";
import { MATCH_MODEL_VERSION } from "@/lib/model-base/version";
import type { ModelScoreline } from "@/lib/quant/match-model";
import { scorelineMatrix } from "@/lib/quant/scoreline-model";

const KICKOFF = new Date("2026-10-15T22:00:00.000Z");
const HOUR = 60 * 60 * 1000;

const match = {
  id: "m-1",
  league: "brasileirao_a" as const,
  homeTeam: "Flamengo",
  awayTeam: "Palmeiras",
  neutralVenue: false,
};

function snapshot(checkedAt: Date): MatchModelSnapshot {
  return {
    id: "snap-1",
    matchId: "m-1",
    computedAt: checkedAt,
    checkedAt,
    modelVersion: MATCH_MODEL_VERSION,
    fingerprint: "fp",
    lambdaSource: "dixon_coles",
    lambdaDegraded: false,
    lambdaFallbackReason: null,
    rho: -0.07,
    neutral: false,
    lambdaHomeBase: 1.6,
    lambdaAwayBase: 1.1,
    lambdaHome: 1.6,
    lambdaAway: 0.98,
    jevStatus: "applied",
    judgments: null,
    probabilities: {} as MatchModelSnapshot["probabilities"],
    topScorelines: [],
  };
}

const FALLBACK: ModelScoreline = {
  source: "heuristic",
  degraded: false,
  lambdaHome: 1.3,
  lambdaAway: 1.2,
  matrix: scorelineMatrix(1.3, 1.2),
};

beforeEach(() => {
  getLatest.mockReset();
  getModelScoreline.mockReset();
  getStandings.mockReset();
  getStandings.mockResolvedValue(undefined);
  getModelScoreline.mockResolvedValue(FALLBACK);
  vi.useRealTimers();
});

describe("resolveSlipModel com asOf (base lida no apito)", () => {
  it("base de 5h antes do apito, 70' depois dele: a MESMA base que a página mostrava", async () => {
    getLatest.mockResolvedValue({
      snapshot: snapshot(new Date(KICKOFF.getTime() - 5 * HOUR)),
      kickoffAt: KICKOFF,
    });
    // O que a página mostrava 1 min antes do apito.
    const shownBefore = await getMatchModelScoreline(
      match.id,
      new Date(KICKOFF.getTime() - 60_000),
    );
    expect(shownBefore).not.toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date(KICKOFF.getTime() + 70 * 60_000));
    // Sem asOf, depois do apito a base some (jogo começou) e cai no cálculo na hora.
    await expect(resolveSlipModel(match)).resolves.toBe(FALLBACK);
    // Com asOf = kickoff, volta a base do apito.
    const atKickoff = await resolveSlipModel(match, { asOf: KICKOFF });
    expect(atKickoff).toEqual(shownBefore);
    expect(atKickoff?.source).toBe("dixon_coles");
  });

  it("a idade de 24h é medida no apito, não agora", async () => {
    // 20h antes do apito: no apito tinha 20h (usável); 5h depois do apito teria 25h.
    getLatest.mockResolvedValue({
      snapshot: snapshot(new Date(KICKOFF.getTime() - 20 * HOUR)),
      kickoffAt: KICKOFF,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(KICKOFF.getTime() + 5 * HOUR));
    const out = await resolveSlipModel(match, { asOf: KICKOFF });
    expect(out?.source).toBe("dixon_coles");
    expect(out?.lambdaAway).toBe(0.98);
  });

  it("base já velha no apito (> 24h) não volta: cai no cálculo na hora", async () => {
    getLatest.mockResolvedValue({
      snapshot: snapshot(new Date(KICKOFF.getTime() - MODEL_SCORELINE_MAX_AGE_MS - HOUR)),
      kickoffAt: KICKOFF,
    });
    await expect(resolveSlipModel(match, { asOf: KICKOFF })).resolves.toBe(FALLBACK);
  });
});
