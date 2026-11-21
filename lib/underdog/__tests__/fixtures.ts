import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import { buildMatchModelSnapshot } from "@/lib/model-base/build-snapshot";
import type { MatchModelSnapshot } from "@/lib/model-base/types";
import { MATCH_MODEL_VERSION } from "@/lib/model-base/version";
import { scorelineMatrix } from "@/lib/quant/scoreline-model";

// Fixtures do painel do azarão (#671): uma base com Palmeiras 1,4 × Flamengo 1,0 (o
// exemplo da proposta), o Flamengo é o azarão.

export const NOW = new Date("2026-11-21T12:00:00Z");
export const KICKOFF = new Date("2026-11-21T19:30:00Z");

export function answers(
  over: Partial<Record<keyof JudgmentAnswers, number>> = {}
): JudgmentAnswers {
  return Object.fromEntries(
    JUDGMENT_QUESTION_IDS.map((id) => [
      id,
      { value: over[id] ?? 0.2, confidence: null },
    ])
  ) as JudgmentAnswers;
}

export function snapshot(
  over: Partial<MatchModelSnapshot> & {
    lambdaHome?: number;
    lambdaAway?: number;
  } = {}
): MatchModelSnapshot {
  const lh = over.lambdaHome ?? 1.4;
  const la = over.lambdaAway ?? 1.0;
  const rho = over.rho === undefined ? -0.1 : over.rho;
  const built = buildMatchModelSnapshot({
    matchId: "m-1",
    scoreline: {
      source: "dixon_coles",
      degraded: false,
      lambdaHome: lh,
      lambdaAway: la,
      ...(rho === null ? {} : { rho }),
      matrix: scorelineMatrix(lh, la, rho === null ? undefined : { rho }),
    },
    neutral: false,
    jev: null,
  });
  return {
    id: "snap-1",
    matchId: "m-1",
    computedAt: NOW,
    checkedAt: NOW,
    modelVersion: MATCH_MODEL_VERSION,
    fingerprint: built.fingerprint,
    lambdaSource: "dixon_coles",
    lambdaDegraded: false,
    lambdaFallbackReason: null,
    rho,
    neutral: false,
    lambdaHomeBase: lh,
    lambdaAwayBase: la,
    lambdaHome: lh,
    lambdaAway: la,
    jevStatus: "not_attempted",
    judgments: null,
    probabilities: built.probabilities,
    topScorelines: built.topScorelines,
    ...over,
  } as MatchModelSnapshot;
}
