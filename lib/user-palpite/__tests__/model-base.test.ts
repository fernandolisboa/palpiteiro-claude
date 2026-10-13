import { beforeEach, describe, expect, it, vi } from "vitest";

const getLatest = vi.fn();
vi.mock("@/lib/db/queries/match-model-snapshots", () => ({
  getLatestMatchModelSnapshotWithKickoff: (...args: unknown[]) => getLatest(...args),
}));
const resolveSlipModel = vi.fn();
vi.mock("@/lib/bets/slip-model", () => ({
  resolveSlipModel: (...args: unknown[]) => resolveSlipModel(...args),
}));

import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import { buildMatchModelSnapshot } from "@/lib/model-base/build-snapshot";
import {
  getMatchModelScoreline,
  MODEL_SCORELINE_MAX_AGE_MS,
} from "@/lib/model-base/model-scoreline";
import {
  matchModelSnapshotSchema,
  type MatchModelSnapshot,
} from "@/lib/model-base/types";
import type { ModelScoreline } from "@/lib/quant/match-model";
import { scorelineMatrix } from "@/lib/quant/scoreline-model";
import {
  isSnapshotUsable,
  lambdasFor,
  resolvePalpiteModelBase,
} from "@/lib/user-palpite/model-base";

const NOW = new Date("2026-05-14T12:00:00Z");
const KICKOFF = new Date("2026-05-15T19:00:00Z");
const MATCH = {
  id: "m-1",
  league: "brasileirao_a" as const,
  homeTeam: "Flamengo",
  awayTeam: "Palmeiras",
  neutralVenue: false,
};

const ANSWERS = Object.fromEntries(
  JUDGMENT_QUESTION_IDS.map((id) => [
    id,
    { value: id === "attack_weakened_away" ? 0.9 : 0.1, confidence: null },
  ]),
) as JudgmentAnswers;

// A row que o cron gravaria (buildMatchModelSnapshot, o MESMO fixture do build-snapshot.test).
function snapshot(
  withJev: boolean,
  over: Partial<MatchModelSnapshot> = {},
): MatchModelSnapshot {
  const row = buildMatchModelSnapshot({
    matchId: MATCH.id,
    scoreline: {
      source: "dixon_coles",
      degraded: false,
      lambdaHome: 1.62,
      lambdaAway: 1.04,
      rho: -0.07,
      matrix: scorelineMatrix(1.62, 1.04, { rho: -0.07 }),
    },
    neutral: false,
    jev: withJev
      ? {
          answers: ANSWERS,
          jevModel: "jev-1.13.0",
          jevModelServed: "jev-1.13.0",
          failure: null,
          stateHash: "hash-a",
          aiCallId: "call-1",
          reusedFromPredictionId: null,
          reusedFromModelSnapshotId: null,
        }
      : null,
  });
  return matchModelSnapshotSchema.parse({
    id: "snap-1",
    computedAt: NOW,
    checkedAt: NOW,
    ...row,
    ...over,
  });
}

const LIVE: ModelScoreline = {
  source: "heuristic",
  degraded: true,
  lambdaHome: 1.3,
  lambdaAway: 1.2,
  matrix: scorelineMatrix(1.3, 1.2),
  fallbackReason: "no_fit",
};

beforeEach(() => {
  getLatest.mockReset();
  resolveSlipModel.mockReset();
  resolveSlipModel.mockResolvedValue(LIVE);
});

describe("resolvePalpiteModelBase", () => {
  it("base fresca com JEV: λ base + respostas, sem fallback; base × respostas = λ ajustado da base", async () => {
    const s = snapshot(true);
    getLatest.mockResolvedValue({ snapshot: s, kickoffAt: KICKOFF });
    const base = await resolvePalpiteModelBase(MATCH, { now: NOW });
    expect(resolveSlipModel).not.toHaveBeenCalled();
    expect(base).toMatchObject({
      origin: "snapshot",
      snapshotId: "snap-1",
      lambdaHomeBase: s.lambdaHomeBase,
      lambdaAwayBase: s.lambdaAwayBase,
      rho: -0.07,
      staleBase: false,
      snapshotWeightsVersion: "judgment_weights_v1",
    });
    expect(base?.jevAnswers).toEqual(ANSWERS);
    const l = lambdasFor(base!, base!.jevAnswers);
    expect(l.lambdaHome).toBeCloseTo(s.lambdaHome, 9);
    expect(l.lambdaAway).toBeCloseTo(s.lambdaAway, 9);
    expect(s.lambdaAway).not.toBeCloseTo(s.lambdaAwayBase, 3);
  });

  it("base fresca sem JEV (not_attempted / failed): respostas null", async () => {
    getLatest.mockResolvedValue({ snapshot: snapshot(false), kickoffAt: KICKOFF });
    expect((await resolvePalpiteModelBase(MATCH, { now: NOW }))?.jevAnswers).toBeNull();
    getLatest.mockResolvedValue({
      snapshot: snapshot(true, { jevStatus: "failed" }),
      kickoffAt: KICKOFF,
    });
    expect((await resolvePalpiteModelBase(MATCH, { now: NOW }))?.jevAnswers).toBeNull();
  });

  it("respostas de outro conjunto de perguntas não são usadas", async () => {
    const s = snapshot(true);
    s.judgments!.versions.judgments = "jev_judgments_v0";
    getLatest.mockResolvedValue({ snapshot: s, kickoffAt: KICKOFF });
    const base = await resolvePalpiteModelBase(MATCH, { now: NOW });
    expect(base?.origin).toBe("snapshot");
    expect(base?.jevAnswers).toBeNull();
  });

  it.each([
    ["velha (>24h)", { checkedAt: new Date(NOW.getTime() - MODEL_SCORELINE_MAX_AGE_MS - 1) }, KICKOFF],
    ["de outra versão", { modelVersion: "match_model_v0" }, KICKOFF],
    ["com o jogo já começado", {}, new Date(NOW.getTime() - 1)],
  ])("base %s: cai no ao vivo, sem JEV, marcada como desatualizada", async (_l, over, kickoffAt) => {
    getLatest.mockResolvedValue({ snapshot: snapshot(true, over), kickoffAt });
    const base = await resolvePalpiteModelBase(MATCH, { now: NOW });
    expect(resolveSlipModel).toHaveBeenCalledWith(MATCH);
    expect(base).toMatchObject({
      origin: "live",
      jevAnswers: null,
      lambdaHomeBase: 1.3,
      lambdaAwayBase: 1.2,
      rho: null,
      staleBase: true,
      fallbackReason: "no_fit",
    });
  });

  it("sem base: ao vivo, não marcada como desatualizada; usa o liveModel compartilhado", async () => {
    getLatest.mockResolvedValue(null);
    const liveModel = vi.fn(async () => LIVE);
    const base = await resolvePalpiteModelBase(MATCH, { now: NOW, liveModel });
    expect(liveModel).toHaveBeenCalledTimes(1);
    expect(resolveSlipModel).not.toHaveBeenCalled();
    expect(base?.staleBase).toBe(false);
  });

  it("fallback null → null", async () => {
    getLatest.mockResolvedValue(null);
    resolveSlipModel.mockResolvedValue(null);
    expect(await resolvePalpiteModelBase(MATCH, { now: NOW })).toBeNull();
  });

  it("query lança → null, sem lançar", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    getLatest.mockRejectedValue(new Error("db down"));
    expect(await resolvePalpiteModelBase(MATCH, { now: NOW })).toBeNull();
    expect(JSON.parse(consoleError.mock.calls[0][0] as string)).toMatchObject({
      scope: "user_palpite",
      error: "model_base_failed",
    });
    consoleError.mockRestore();
  });
});

describe("isSnapshotUsable ⇔ getMatchModelScoreline (mesmas regras)", () => {
  const cases: [string, Partial<MatchModelSnapshot>, Date][] = [
    ["fresca", {}, KICKOFF],
    ["no limite de 24h", { checkedAt: new Date(NOW.getTime() - MODEL_SCORELINE_MAX_AGE_MS) }, KICKOFF],
    ["velha", { checkedAt: new Date(NOW.getTime() - MODEL_SCORELINE_MAX_AGE_MS - 1) }, KICKOFF],
    ["versão antiga", { modelVersion: "match_model_v0" }, KICKOFF],
    ["kickoff agora", {}, NOW],
    ["kickoff passado", {}, new Date(NOW.getTime() - 60_000)],
  ];
  it.each(cases)("%s", async (_l, over, kickoffAt) => {
    const s = snapshot(true, over);
    getLatest.mockResolvedValue({ snapshot: s, kickoffAt });
    const real = await getMatchModelScoreline(MATCH.id, NOW);
    expect(isSnapshotUsable(s, kickoffAt, NOW)).toBe(real !== null);
  });
});
