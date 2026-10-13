import { describe, expect, it, vi } from "vitest";

import { runCodeJevEngine } from "@/lib/ai/engine/code-jev";
import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import type { JudgmentRun } from "@/lib/ai/predict";
import {
  buildMatchModelSnapshot,
  matchModelFingerprint,
  modelProbabilities,
  type FingerprintInput,
} from "@/lib/model-base/build-snapshot";
import type { ModelScoreline } from "@/lib/quant/match-model";
import {
  DIXON_COLES_RHO,
  p1X2,
  pBtts,
  pOverUnder,
  scorelineMatrix,
} from "@/lib/quant/scoreline-model";

const r2 = (p: number) => Number((p * 100).toFixed(2));

function dc(rho = -0.07): ModelScoreline {
  return {
    source: "dixon_coles",
    degraded: false,
    lambdaHome: 1.62,
    lambdaAway: 1.04,
    rho,
    matrix: scorelineMatrix(1.62, 1.04, { rho }),
  };
}

function heuristic(): ModelScoreline {
  return {
    source: "heuristic",
    degraded: true,
    lambdaHome: 1.3,
    lambdaAway: 1.2,
    matrix: scorelineMatrix(1.3, 1.2),
    fallbackReason: "no_fit",
  };
}

function answers(overrides: Partial<Record<string, number>> = {}) {
  return Object.fromEntries(
    JUDGMENT_QUESTION_IDS.map((id) => [
      id,
      { value: overrides[id] ?? 0.1, confidence: null },
    ]),
  ) as JudgmentAnswers;
}

function run(over: Partial<JudgmentRun> = {}): JudgmentRun {
  return {
    answers: answers({ attack_weakened_away: 0.9 }),
    jevModel: "jev-1.13.0",
    jevModelServed: "jev-1.13.0",
    failure: null,
    stateHash: "hash-a",
    aiCallId: "call-1",
    reusedFromPredictionId: null,
    reusedFromModelSnapshotId: null,
    ...over,
  };
}

describe("modelProbabilities", () => {
  it("1X2, BTTS e gols = as funções da MESMA matriz, em pp com 2 casas; dupla chance = somas", () => {
    const m = scorelineMatrix(1.5, 1.1);
    const probs = modelProbabilities(m);
    const x = p1X2(m);
    expect(probs.match_result).toEqual({
      home: r2(x.home),
      draw: r2(x.draw),
      away: r2(x.away),
    });
    expect(probs.btts).toEqual({ yes: r2(pBtts(m)), no: r2(1 - pBtts(m)) });
    for (const line of [1.5, 2.5, 3.5] as const) {
      expect(probs.over_under[`${line}`]).toEqual({
        over: r2(pOverUnder(m, line)),
        under: r2(1 - pOverUnder(m, line)),
      });
    }
    expect(probs.double_chance.home_or_draw).toBeCloseTo(
      r2(x.home + x.draw),
      2,
    );
    const dcSum =
      probs.double_chance.home_or_draw +
      probs.double_chance.away_or_draw +
      probs.double_chance.home_or_away;
    expect(dcSum).toBeCloseTo(200, 1);
  });
});

describe("buildMatchModelSnapshot", () => {
  it("sem JEV: λ ajustado = base, matriz do scoreline (ρ do fit), not_attempted", () => {
    const s = dc();
    const row = buildMatchModelSnapshot({
      matchId: "m-1",
      scoreline: s,
      neutral: false,
      jev: null,
    });
    expect(row.jevStatus).toBe("not_attempted");
    expect(row.judgments).toBeNull();
    expect(row.lambdaHome).toBe(s.lambdaHome);
    expect(row.lambdaHomeBase).toBe(s.lambdaHome);
    expect(row.rho).toBe(-0.07);
    expect(row.probabilities).toEqual(modelProbabilities(s.matrix));
    expect(row.topScorelines).toHaveLength(5);
    expect(row.topScorelines[0].pct).toBeGreaterThanOrEqual(
      row.topScorelines[4].pct,
    );
  });

  it("heurístico: rho null, fallbackReason e degraded gravados", () => {
    const row = buildMatchModelSnapshot({
      matchId: "m-1",
      scoreline: heuristic(),
      neutral: true,
      jev: null,
    });
    expect(row.rho).toBeNull();
    expect(row.lambdaSource).toBe("heuristic");
    expect(row.lambdaFallbackReason).toBe("no_fit");
    expect(row.lambdaDegraded).toBe(true);
    expect(row.neutral).toBe(true);
  });

  it("com JEV aplicado: o 1X2 bate com runCodeJevEngine pro mesmo scoreline + respostas", () => {
    const s = dc();
    const r = run();
    const row = buildMatchModelSnapshot({
      matchId: "m-1",
      scoreline: s,
      neutral: false,
      jev: r,
    });
    const engine = runCodeJevEngine({
      dbMarketKey: "match_result",
      selectionKeys: ["home", "draw", "away"],
      scoreline: s,
      judgments: r.answers,
      candidates: [{ line: null, impliedByKey: {} }],
      minEdgePp: 5,
    });
    expect(row.jevStatus).toBe("applied");
    expect(row.probabilities?.match_result).toEqual(engine.modelProbByKey);
    expect(row.lambdaHome).toBe(engine.judgments.lambdaHome);
    expect(row.lambdaAway).toBe(engine.judgments.lambdaAway);
    expect(row.lambdaAway).toBeLessThan(s.lambdaAway);
    expect(row.judgments).toMatchObject({
      applied: true,
      stateHash: "hash-a",
      aiCallId: "call-1",
      versions: { jevModel: "jev-1.13.0" },
      reusedFromModelSnapshotId: null,
    });
  });

  it("JEV que falhou: failed, λ = base, falha gravada", () => {
    const s = dc();
    const row = buildMatchModelSnapshot({
      matchId: "m-1",
      scoreline: s,
      neutral: false,
      jev: run({
        answers: null,
        jevModel: null,
        jevModelServed: null,
        failure: {
          kind: "timeout",
          message: "boom",
          httpStatus: null,
          latencyMs: 1,
          responseBody: null,
          requestPayload: null,
          inputTokens: null,
          costUsd: null,
        },
      }),
    });
    expect(row.jevStatus).toBe("failed");
    expect(row.lambdaHome).toBe(s.lambdaHome);
    expect(row.judgments?.applied).toBe(false);
    expect(row.judgments?.failure).toEqual({ kind: "timeout", message: "boom" });
  });
});

describe("matchModelFingerprint", () => {
  const base: FingerprintInput = {
    source: "dixon_coles",
    degraded: false,
    fallbackReason: null,
    rho: -0.07,
    neutral: false,
    base: { home: 1.5, away: 1.1 },
    adjusted: { home: 1.5, away: 1.1 },
    jev: null,
  };

  it("estável (independe da ordem de chaves)", () => {
    const reordered: FingerprintInput = {
      jev: null,
      adjusted: { away: 1.1, home: 1.5 },
      base: { away: 1.1, home: 1.5 },
      neutral: false,
      rho: -0.07,
      fallbackReason: null,
      degraded: false,
      source: "dixon_coles",
    };
    expect(matchModelFingerprint(reordered)).toBe(matchModelFingerprint(base));
  });

  it("muda com λ na 6ª casa, mas não abaixo dela", () => {
    const fp = matchModelFingerprint(base);
    expect(
      matchModelFingerprint({ ...base, base: { home: 1.500001, away: 1.1 } }),
    ).not.toBe(fp);
    expect(
      matchModelFingerprint({ ...base, base: { home: 1.5000001, away: 1.1 } }),
    ).toBe(fp);
  });

  it("ρ ausente e ρ = DIXON_COLES_RHO dão o mesmo hash; ρ diferente muda", () => {
    const pinned = matchModelFingerprint({ ...base, rho: DIXON_COLES_RHO });
    expect(matchModelFingerprint({ ...base, rho: null })).toBe(pinned);
    expect(matchModelFingerprint({ ...base, rho: undefined })).toBe(pinned);
    expect(matchModelFingerprint({ ...base, rho: -0.05 })).not.toBe(pinned);
  });

  it("muda com o status do JEV e com o stateHash", () => {
    const applied = matchModelFingerprint({
      ...base,
      jev: { status: "applied", stateHash: "a", jevModel: "jev-1.13.0" },
    });
    expect(applied).not.toBe(matchModelFingerprint(base));
    expect(
      matchModelFingerprint({
        ...base,
        jev: { status: "applied", stateHash: "b", jevModel: "jev-1.13.0" },
      }),
    ).not.toBe(applied);
    expect(
      matchModelFingerprint({
        ...base,
        jev: { status: "failed", stateHash: "a", jevModel: null },
      }),
    ).not.toBe(applied);
  });

  it("muda com MATCH_MODEL_VERSION", async () => {
    const before = matchModelFingerprint(base);
    vi.resetModules();
    vi.doMock("@/lib/model-base/version", () => ({
      MATCH_MODEL_VERSION: "match_model_v999",
    }));
    const mod = await import("@/lib/model-base/build-snapshot");
    expect(mod.matchModelFingerprint(base)).not.toBe(before);
    vi.doUnmock("@/lib/model-base/version");
  });

  it("row: não muda com aiCallId nem reusedFrom*", () => {
    const s = dc();
    const a = buildMatchModelSnapshot({
      matchId: "m-1",
      scoreline: s,
      neutral: false,
      jev: run(),
    });
    const b = buildMatchModelSnapshot({
      matchId: "m-1",
      scoreline: s,
      neutral: false,
      jev: run({
        aiCallId: "call-2",
        reusedFromPredictionId: "p-9",
        reusedFromModelSnapshotId: null,
      }),
    });
    const c = buildMatchModelSnapshot({
      matchId: "m-1",
      scoreline: s,
      neutral: false,
      jev: run({ reusedFromModelSnapshotId: "snap-1" }),
    });
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(c.fingerprint).toBe(a.fingerprint);
  });
});
