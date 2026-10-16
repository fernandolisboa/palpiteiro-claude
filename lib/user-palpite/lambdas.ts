import { applyJudgments, type AppliedJudgments } from "@/lib/ai/judgments/apply";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import type { ScorelineMatrix } from "@/lib/quant/scoreline-model";

import { readingMatrix, type InPlayReading } from "./reading";

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

/** A matriz da leitura; com `inPlay`, a do placar final a partir do atual (#594). */
export function matrixFor(
  base: { rho: number | null },
  l: { lambdaHome: number; lambdaAway: number },
  inPlay: InPlayReading | null = null,
): ScorelineMatrix {
  return readingMatrix({ ...l, rho: base.rho, inPlay });
}
