import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import { modelScorelineFromSnapshot } from "@/lib/model-base/model-scoreline";
import type { MatchModelSnapshot } from "@/lib/model-base/types";
import type { ModelScoreline } from "@/lib/quant/match-model";
import { p1X2 } from "@/lib/quant/scoreline-model";

import { findUnderdog, type UnderdogPick } from "./gate";
import { computeScenarios } from "./scenarios";
import { underdogScorelines } from "./scorelines";
import { jevSignals } from "./signals";
import type { UnderdogFacts, UnderdogSignal } from "./types";

// A base do painel do azarão (#671): a row atual da base passa pelos portões
// (modelScorelineFromSnapshot), a matriz refeita diz quem é o azarão (findUnderdog), e
// daí sai tudo o que é número, sem chamada externa. Puro sobre a row.

export type UnderdogBase = {
  snapshot: MatchModelSnapshot;
  model: ModelScoreline;
  pick: UnderdogPick;
};

/** null: base que não vale (versão, idade, apito) ou sem azarão claro. Nunca lança. */
export function underdogBaseFromSnapshot(
  snapshot: MatchModelSnapshot,
  kickoffAt: Date,
  now: Date
): UnderdogBase | null {
  const model = modelScorelineFromSnapshot(snapshot, kickoffAt, now);
  if (!model) return null;
  const pick = findUnderdog(p1X2(model.matrix));
  return pick ? { snapshot, model, pick } : null;
}

export function snapshotAnswers(
  snapshot: MatchModelSnapshot
): JudgmentAnswers | null {
  return snapshot.judgments?.answers ?? null;
}

/**
 * Chances, placares de zebra, cenários e os sinais do JEV da base. Os sinais de dado
 * (forma, confronto, desfalques) entram depois, pela action (`signals`).
 */
export function computeUnderdogFacts(
  base: UnderdogBase,
  signals: UnderdogSignal[] = []
): UnderdogFacts {
  const { snapshot, model, pick } = base;
  const answers = snapshotAnswers(snapshot);
  return {
    side: pick.side,
    chances: pick.chances,
    scorelines: underdogScorelines(model.matrix, pick.side),
    scenarios: computeScenarios({
      pre: model,
      side: pick.side,
      lambdaHomeBase: snapshot.lambdaHomeBase,
      lambdaAwayBase: snapshot.lambdaAwayBase,
      answers,
    }),
    signals: [...signals, ...jevSignals(pick.side, answers)],
    model: {
      source: snapshot.lambdaSource,
      jevApplied: snapshot.jevStatus === "applied" && answers !== null,
    },
  };
}
