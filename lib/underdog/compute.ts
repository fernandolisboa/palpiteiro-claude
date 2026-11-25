import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import { modelAnswersOf } from "@/lib/match-news/model-answers";
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

// O estado da base atual pro painel: "unavailable" = a base não vale agora (versão,
// idade > 24h, refit atrasado, apito) e nada se sabe do azarão; "no_underdog" = a base
// vale e a diferença entre as vitórias ficou abaixo da porta.
export type UnderdogBaseRead =
  | { status: "ok"; base: UnderdogBase }
  | { status: "no_underdog" }
  | { status: "unavailable" };

/** Lê a base atual e diz quem é o azarão. Nunca lança. */
export function readUnderdogBase(
  snapshot: MatchModelSnapshot,
  kickoffAt: Date,
  now: Date
): UnderdogBaseRead {
  const model = modelScorelineFromSnapshot(snapshot, kickoffAt, now);
  if (!model) return { status: "unavailable" };
  const pick = findUnderdog(p1X2(model.matrix));
  return pick
    ? { status: "ok", base: { snapshot, model, pick } }
    : { status: "no_underdog" };
}

/** null: base que não vale (versão, idade, apito) ou sem azarão claro. Nunca lança. */
export function underdogBaseFromSnapshot(
  snapshot: MatchModelSnapshot,
  kickoffAt: Date,
  now: Date
): UnderdogBase | null {
  const read = readUnderdogBase(snapshot, kickoffAt, now);
  return read.status === "ok" ? read.base : null;
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
  // Sinais "jev" e jevApplied: SÓ o JEV (o 0,7 da notícia não vira sinal do JEV).
  // Cenários: o que a base aplicou (JEV ∨ notícia, #672), senão o cenário C esquece a
  // notícia que já está no número.
  const answers = snapshotAnswers(snapshot);
  const modelAnswers = modelAnswersOf(snapshot.judgments);
  return {
    side: pick.side,
    chances: pick.chances,
    scorelines: underdogScorelines(model.matrix, pick.side),
    scenarios: computeScenarios({
      pre: model,
      side: pick.side,
      lambdaHomeBase: snapshot.lambdaHomeBase,
      lambdaAwayBase: snapshot.lambdaAwayBase,
      answers: modelAnswers,
    }),
    signals: [...signals, ...jevSignals(pick.side, answers)],
    model: {
      source: snapshot.lambdaSource,
      jevApplied: snapshot.jevStatus === "applied" && answers !== null,
    },
  };
}
