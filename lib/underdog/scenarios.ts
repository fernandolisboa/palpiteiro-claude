import { applyJudgments } from "@/lib/ai/judgments/apply";
import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import {
  inPlayScoreline,
  RED_OPP,
  RED_OWN,
  remainingFraction,
} from "@/lib/quant/in-play";
import type { ModelScoreline } from "@/lib/quant/match-model";
import {
  DIXON_COLES_RHO,
  p1X2,
  scorelineMatrix,
  type ScorelineMatrix,
} from "@/lib/quant/scoreline-model";

import {
  SCENARIO_LEAD_MINUTE,
  SCENARIO_MIN_DELTA_PP,
  SCENARIO_RED_MINUTE,
} from "./constants";
import type {
  UnderdogScenario,
  UnderdogScenarioId,
  UnderdogSide,
} from "./types";

// Cenários "se acontecer…" do painel do azarão (#671, ADR 0073 §3), todos em código
// sobre o modelo da base. Puros e determinísticos. Cenário que falha (null) ou muda a
// chance do azarão menos que SCENARIO_MIN_DELTA_PP sai da lista.

const round1 = (n: number) => Math.round(n * 10) / 10;
const other = (s: UnderdogSide): UnderdogSide =>
  s === "home" ? "away" : "home";

function sidePct(matrix: ScorelineMatrix, side: UnderdogSide): number {
  return p1X2(matrix)[side] * 100;
}

/** A. O azarão vencendo por 1 × 0 aos 30' (modelo em jogo, sem expulsão). */
export function leadAt30(
  pre: ModelScoreline,
  side: UnderdogSide
): number | null {
  const live = inPlayScoreline(pre, {
    statusShort: "1H",
    elapsed: SCENARIO_LEAD_MINUTE,
    extra: null,
    score: side === "home" ? { home: 1, away: 0 } : { home: 0, away: 1 },
    red: null,
  });
  return live ? sidePct(live.matrix, side) : null;
}

/**
 * B. O favorito com um a menos desde os 60', em forma fechada: os gols até os 60' e os
 * depois somam um Poisson só, com o λ restante multiplicado por RED_OWN (favorito) e
 * RED_OPP (azarão), como o modelo em jogo faz. Um teste confere contra a mistura sobre
 * o placar aos 60' pelo inPlayScoreline.
 */
export function favoriteRedFrom60(
  pre: ModelScoreline,
  side: UnderdogSide
): number | null {
  const f = remainingFraction({
    statusShort: "2H",
    elapsed: SCENARIO_RED_MINUTE,
    extra: null,
  });
  if (!f.ok) return null;
  const r = f.r;
  const fav = other(side);
  const lambdaOf = (s: UnderdogSide) =>
    s === "home" ? pre.lambdaHome : pre.lambdaAway;
  const mult = (s: UnderdogSide) => 1 - r + r * (s === fav ? RED_OWN : RED_OPP);
  const lh = lambdaOf("home") * mult("home");
  const la = lambdaOf("away") * mult("away");
  if (!Number.isFinite(lh) || !Number.isFinite(la)) return null;
  return sidePct(
    scorelineMatrix(lh, la, { rho: pre.rho ?? DIXON_COLES_RHO }),
    side
  );
}

// Respostas sem efeito (o JEV só move λ acima de 0,5).
function neutralAnswers(): JudgmentAnswers {
  return Object.fromEntries(
    JUDGMENT_QUESTION_IDS.map((id) => [id, { value: 0, confidence: null }])
  ) as JudgmentAnswers;
}

/**
 * C. O favorito desfalcado e com rodízio no máximo que o modelo aplica: o código real do
 * JEV (applyJudgments) sobre o λ BASE, com attack_weakened, defense_weakened e
 * rotation_risk do favorito em 1 e o resto como guardado (neutro sem respostas).
 */
export function favoriteWeakenedMax(args: {
  lambdaHomeBase: number;
  lambdaAwayBase: number;
  rho: number | undefined;
  answers: JudgmentAnswers | null;
  side: UnderdogSide;
}): number | null {
  const fav = other(args.side);
  const answers: JudgmentAnswers = { ...(args.answers ?? neutralAnswers()) };
  for (const factor of [
    "attack_weakened",
    "defense_weakened",
    "rotation_risk",
  ] as const) {
    answers[`${factor}_${fav}`] = { value: 1, confidence: null };
  }
  const adjusted = applyJudgments(
    { lambdaHome: args.lambdaHomeBase, lambdaAway: args.lambdaAwayBase },
    answers
  );
  if (
    !Number.isFinite(adjusted.lambdaHome) ||
    !Number.isFinite(adjusted.lambdaAway)
  ) {
    return null;
  }
  return sidePct(
    scorelineMatrix(adjusted.lambdaHome, adjusted.lambdaAway, {
      rho: args.rho ?? DIXON_COLES_RHO,
    }),
    args.side
  );
}

export function computeScenarios(args: {
  pre: ModelScoreline;
  side: UnderdogSide;
  lambdaHomeBase: number;
  lambdaAwayBase: number;
  answers: JudgmentAnswers | null;
}): UnderdogScenario[] {
  const { pre, side } = args;
  const before = sidePct(pre.matrix, side);
  const raw: [UnderdogScenarioId, number | null][] = [
    ["lead_30", leadAt30(pre, side)],
    ["red_60", favoriteRedFrom60(pre, side)],
    [
      "absences_max",
      favoriteWeakenedMax({
        lambdaHomeBase: args.lambdaHomeBase,
        lambdaAwayBase: args.lambdaAwayBase,
        rho: pre.rho,
        answers: args.answers,
        side,
      }),
    ],
  ];
  return raw.flatMap(([id, after]) =>
    after === null ||
    !Number.isFinite(after) ||
    Math.abs(after - before) < SCENARIO_MIN_DELTA_PP
      ? []
      : [{ id, beforePct: round1(before), afterPct: round1(after) }]
  );
}
