import { applyJudgments, type AppliedJudgments } from "@/lib/ai/judgments/apply";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import type { ScorelineMatrix } from "@/lib/quant/scoreline-model";

import { readingMatrix } from "./reading";

// λ e matriz de leitura do "Seu palpite" (#564). PURO (sem banco): usado pelo seam
// (model-base.ts), pela evidência e pelos mappers de view.

/** λ de leitura = base × respostas (null → base). Puro. */
export function lambdasFor(
  base: { lambdaHomeBase: number; lambdaAwayBase: number },
  answers: JudgmentAnswers | null,
): AppliedJudgments {
  return applyJudgments(
    { lambdaHome: base.lambdaHomeBase, lambdaAway: base.lambdaAwayBase },
    answers,
  );
}

export function matrixFor(
  base: { rho: number | null },
  l: { lambdaHome: number; lambdaAway: number },
): ScorelineMatrix {
  return readingMatrix({ ...l, rho: base.rho });
}
