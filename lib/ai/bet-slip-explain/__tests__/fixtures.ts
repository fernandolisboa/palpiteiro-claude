import type { BetLegParams } from "@/db/schema";
import { applyJudgments } from "@/lib/ai/judgments/apply";
import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import {
  buildBetExplainInput,
  type BetExplainInput,
} from "@/lib/bets/explain-input";
import type { UserBetLegRow, UserBetSlipRow } from "@/lib/db/queries/user-bets";
import type { MatchModelSnapshot } from "@/lib/model-base/types";

// Rows congeladas do registro e a base do jogo, como a action lê do banco (#562).

export const TEAMS = { home: "Flamengo", away: "Palmeiras" };
const AT = new Date("2026-10-21T18:00:00Z");

export function leg(over: Partial<UserBetLegRow> = {}): UserBetLegRow {
  return {
    id: "leg-1",
    slipId: "slip-1",
    kind: "over_under",
    params: { selection: "over", line: 2.5 } as BetLegParams,
    userOdd: "1.950",
    modelProbPct: "56.20",
    gradeSource: "scoreline_model",
    gradeStatus: "graded",
    pinnedPredictionId: null,
    settleable: true,
    modelSource: "dixon_coles",
    referenceOdd: "1.900",
    marketImpliedPct: "50.10",
    stakeUnits: "1.00",
    suggestedStakeUnits: "1.00",
    createdAt: AT,
    outcome: null,
    ...over,
  };
}

export function slipRow(
  legs: UserBetLegRow[],
  over: Partial<Omit<UserBetSlipRow, "legs">> = {}
): UserBetSlipRow {
  return {
    id: "slip-1",
    matchId: "m-1",
    userId: "u-1",
    rawInput: null,
    parseAiCallId: null,
    comboUserOdd: null,
    jointProbPct: null,
    mode: "simples",
    stakeUnits: null,
    isLive: false,
    liveState: null,
    modelSnapshotId: "snap-1",
    createdAt: AT,
    legs,
    ...over,
  };
}

export function answers(
  over: Partial<Record<string, number>> = {}
): JudgmentAnswers {
  return Object.fromEntries(
    JUDGMENT_QUESTION_IDS.map((id) => [
      id,
      { value: over[id] ?? 0.2, confidence: null },
    ])
  ) as JudgmentAnswers;
}

export function snapshot(
  over: Partial<MatchModelSnapshot> = {},
  jev: JudgmentAnswers | null = answers({ attack_weakened_away: 0.9 })
): MatchModelSnapshot {
  const multipliers = jev
    ? applyJudgments({ lambdaHome: 1.5, lambdaAway: 1.1 }, jev).multipliers
    : null;
  return {
    id: "snap-1",
    matchId: "m-1",
    computedAt: AT,
    checkedAt: AT,
    modelVersion: "v",
    fingerprint: "f",
    lambdaSource: "dixon_coles",
    lambdaDegraded: false,
    lambdaFallbackReason: null,
    rho: -0.08,
    neutral: false,
    lambdaHomeBase: 1.5,
    lambdaAwayBase: 1.1,
    lambdaHome: 1.5,
    lambdaAway: 1.0,
    jevStatus: jev ? "applied" : "not_attempted",
    judgments: jev
      ? {
          applied: true,
          answers: jev,
          multipliers,
          versions: {
            judgments: "j",
            weights: "w",
            jevModel: "m",
            jevModelServed: "m",
          },
          failure: null,
          stateHash: "h",
          aiCallId: null,
          reusedFromPredictionId: null,
          reusedFromModelSnapshotId: null,
        }
      : null,
    probabilities: {} as MatchModelSnapshot["probabilities"],
    topScorelines: [],
    ...over,
  };
}

/** Simples com 2 pernas (over com valor; vitória do mandante sem valor), base com JEV. */
export function simplesInput(): BetExplainInput {
  return buildBetExplainInput({
    slips: [
      slipRow([leg()]),
      slipRow(
        [
          leg({
            id: "leg-2",
            slipId: "slip-2",
            kind: "match_result",
            params: { selection: "home" } as BetLegParams,
            userOdd: "1.800",
            modelProbPct: "48.00",
            referenceOdd: "1.850",
            marketImpliedPct: "52.30",
            suggestedStakeUnits: null,
            stakeUnits: "2.00",
          }),
        ],
        { id: "slip-2" }
      ),
    ],
    teams: TEAMS,
    competition: "Brasileirão",
    kickoffLabel: "qua, 22/10 às 21:30",
    snapshot: snapshot(),
  });
}

/** Combinada de 2 pernas com a conjunta e a odd da combinada. */
export function comboInput(): BetExplainInput {
  return buildBetExplainInput({
    slips: [
      slipRow(
        [
          leg({ userOdd: null, stakeUnits: null, suggestedStakeUnits: null }),
          leg({
            id: "leg-2",
            kind: "btts",
            params: { selection: "yes" } as BetLegParams,
            userOdd: null,
            modelProbPct: "52.40",
            referenceOdd: null,
            marketImpliedPct: null,
            stakeUnits: null,
            suggestedStakeUnits: null,
          }),
        ],
        {
          mode: "combinada",
          comboUserOdd: "3.400",
          jointProbPct: "31.50",
          stakeUnits: "1.00",
        }
      ),
    ],
    teams: TEAMS,
    competition: "Brasileirão",
    kickoffLabel: "qua, 22/10 às 21:30",
    snapshot: null,
  });
}
