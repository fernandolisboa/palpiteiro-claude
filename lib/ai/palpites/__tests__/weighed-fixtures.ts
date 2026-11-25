// Fixtures do "o que pesou" (#683): julgamentos code_jev montados pela mesma conta do
// predict.ts (JEV ∨ notícia ∨ usuário por MÁXIMO, applyJudgments sobre o λ base).
import type { PredictionJudgments } from "@/lib/ai/engine/types";
import { applyJudgments } from "@/lib/ai/judgments/apply";
import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type {
  JudgmentAnswers,
  JudgmentQuestionId,
} from "@/lib/ai/judgments/types";
import type { MarketAnalysisSummary } from "@/lib/ai/palpites/synthesis-input";
import { weighedFactorInputs } from "@/lib/ai/palpites/weighed";
import { combineAnswers } from "@/lib/user-palpite/evidence";

export type Nouls = Partial<Record<JudgmentQuestionId, number>>;

export function answersOf(over: Nouls, rest = 0.2): JudgmentAnswers {
  const out = {} as JudgmentAnswers;
  for (const id of JUDGMENT_QUESTION_IDS)
    out[id] = { value: over[id] ?? rest, confidence: null };
  return out;
}

export function codeJev(opts: {
  base?: { home: number; away: number };
  jev?: Nouls | null;
  news?: Nouls;
  user?: Nouls;
  rho?: number | null;
}): PredictionJudgments {
  const base = opts.base ?? { home: 1.3, away: 1.1 };
  const jev = opts.jev === null ? null : answersOf(opts.jev ?? {});
  const news = opts.news ?? {};
  const user = opts.user ?? {};
  const model = Object.keys(news).length > 0 ? combineAnswers(jev, news) : jev;
  const combined =
    Object.keys(user).length > 0 ? combineAnswers(model, user) : model;
  const applied = applyJudgments(
    { lambdaHome: base.home, lambdaAway: base.away },
    combined
  );
  return {
    engine: "code_jev",
    applied: jev !== null,
    answers: jev,
    multipliers: applied.multipliers,
    lambda: {
      source: "dixon_coles",
      degraded: false,
      rho: opts.rho === undefined ? -0.1 : opts.rho,
      base,
      adjusted: { home: applied.lambdaHome, away: applied.lambdaAway },
    },
    versions: { judgments: "v", weights: "w", narrator: "n", jevModel: null },
    failure: null,
    stateHash: "state-1",
    aiCallId: null,
    reusedFromPredictionId: null,
    ...(Object.keys(user).length > 0
      ? {
          userContext: {
            claims: [],
            evidence: user,
            extractionAiCallId: null,
            warnings: [],
            versions: { userEvidence: "user_evidence_v1", extract: "x" },
          },
        }
      : {}),
    ...(Object.keys(news).length > 0 ? { news: { evidence: news } } : {}),
  };
}

export function judgmentsModelOf(
  j: PredictionJudgments
): NonNullable<MarketAnalysisSummary["judgmentsModel"]> {
  return {
    base: { ...j.lambda.base },
    adjusted: { ...j.lambda.adjusted },
    rho: j.lambda.rho,
    stateHash: j.stateHash,
    jevAiCallId: j.aiCallId,
    factors: weighedFactorInputs(j),
  };
}

export const T0 = "2026-11-21T18:00:00.000Z";

export function mr(
  odds: [number, number, number],
  j: PredictionJudgments | null
): MarketAnalysisSummary {
  return {
    marketKey: "match_result",
    marketLabel: "Resultado (1X2)",
    recommendation: "home",
    recommendedLabel: "Casa",
    isPass: false,
    modelProbPct: null,
    edgePct: null,
    confidencePct: null,
    oddAtRecommendation: null,
    rationale: "",
    predictionId: "pred-mr",
    selections: [],
    engine: "code_jev",
    odds: { home: odds[0], draw: odds[1], away: odds[2] },
    line: null,
    predictionCreatedAt: T0,
    judgmentsModel: j ? judgmentsModelOf(j) : null,
    factorPhrases: [],
  };
}

export function ou(
  line: number,
  over: number,
  under: number
): MarketAnalysisSummary {
  return {
    ...mr([2, 3, 4], null),
    marketKey: "over_under",
    marketLabel: "Mais/Menos gols",
    predictionId: "pred-ou",
    odds: { over, under },
    line,
  };
}

// Os dois cenários do mock v6 (scratchpad fx/calc.ts), com o motor real.
// Os números do mock eram ilustrativos; o "vira" usa as odds do cenário "FLIP close" do
// calc.ts, que dão a mesma base do print (37/30/33) e viram pro Boca.
export type Scenario = {
  odds: [number, number, number];
  ou: readonly [number, number, number];
  jev: Nouls;
  user: Nouls;
};

export const VIRA: Scenario = {
  odds: [2.6, 3.15, 2.85],
  ou: [2.5, 2.15, 1.72],
  jev: { attack_weakened_home: 0.9, defense_weakened_home: 0.8 },
  user: { rotation_risk_home: 0.7 },
};
export const NAO_VIRA: Scenario = {
  odds: [1.85, 3.5, 4.6],
  ou: [2.5, 2.05, 1.78],
  jev: {
    attack_weakened_home: 0.9,
    high_stakes_away: 0.85,
    defense_weakened_away: 0.8,
  } as Nouls,
  user: {},
};
