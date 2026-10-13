import { beforeEach, describe, expect, it, vi } from "vitest";

const getLatest = vi.fn();
vi.mock("@/lib/db/queries/match-model-snapshots", () => ({
  getLatestMatchModelSnapshotWithKickoff: (...args: unknown[]) =>
    getLatest(...args),
}));

import {
  getMatchModelScoreline,
  MODEL_SCORELINE_MAX_AGE_MS,
} from "@/lib/model-base/model-scoreline";
import type { MatchModelSnapshot } from "@/lib/model-base/types";
import { MATCH_MODEL_VERSION } from "@/lib/model-base/version";
import { scorelineMatrix } from "@/lib/quant/scoreline-model";

const NOW = new Date("2026-05-14T12:00:00Z");
const KICKOFF = new Date("2026-05-15T19:00:00Z");

function snapshot(over: Partial<MatchModelSnapshot> = {}): MatchModelSnapshot {
  return {
    id: "snap-1",
    matchId: "m-1",
    computedAt: NOW,
    checkedAt: NOW,
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
    ...over,
  };
}

beforeEach(() => {
  getLatest.mockReset();
});

describe("getMatchModelScoreline (seam do cupom)", () => {
  it("DC: λ AJUSTADO e ρ do fit, matriz igual à de scorelineMatrix", async () => {
    getLatest.mockResolvedValue({ snapshot: snapshot(), kickoffAt: KICKOFF });
    const out = await getMatchModelScoreline("m-1", NOW);
    expect(out).toEqual({
      source: "dixon_coles",
      degraded: false,
      lambdaHome: 1.6,
      lambdaAway: 0.98,
      rho: -0.07,
      matrix: scorelineMatrix(1.6, 0.98, { rho: -0.07 }),
    });
    expect(out).not.toHaveProperty("fallbackReason");
  });

  it("heurístico: rho ausente (ρ pinado), fallbackReason e degraded mapeados", async () => {
    getLatest.mockResolvedValue({
      snapshot: snapshot({
        lambdaSource: "heuristic",
        lambdaDegraded: true,
        lambdaFallbackReason: "stale_fit",
        rho: null,
        lambdaHome: 1.3,
        lambdaAway: 1.2,
      }),
      kickoffAt: KICKOFF,
    });
    const out = await getMatchModelScoreline("m-1", NOW);
    expect(out).toEqual({
      source: "heuristic",
      degraded: true,
      lambdaHome: 1.3,
      lambdaAway: 1.2,
      matrix: scorelineMatrix(1.3, 1.2),
      fallbackReason: "stale_fit",
    });
    expect(out).not.toHaveProperty("rho");
  });

  it("null sem base, com checked_at > 24h, com o jogo começado e com outra versão", async () => {
    getLatest.mockResolvedValue(null);
    expect(await getMatchModelScoreline("m-1", NOW)).toBeNull();

    getLatest.mockResolvedValue({
      snapshot: snapshot({
        checkedAt: new Date(NOW.getTime() - MODEL_SCORELINE_MAX_AGE_MS - 1),
      }),
      kickoffAt: KICKOFF,
    });
    expect(await getMatchModelScoreline("m-1", NOW)).toBeNull();

    getLatest.mockResolvedValue({ snapshot: snapshot(), kickoffAt: NOW });
    expect(await getMatchModelScoreline("m-1", NOW)).toBeNull();

    getLatest.mockResolvedValue({
      snapshot: snapshot({ modelVersion: "match_model_v0" }),
      kickoffAt: KICKOFF,
    });
    expect(await getMatchModelScoreline("m-1", NOW)).toBeNull();
  });

  it("erro de query → null (com log), nunca lança", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    getLatest.mockRejectedValue(new Error("db down"));
    await expect(getMatchModelScoreline("m-1", NOW)).resolves.toBeNull();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
