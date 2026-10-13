import { selectionProbsFromMatrix } from "@/lib/ai/engine/code-jev";
import {
  applyJudgments,
  JUDGMENT_WEIGHTS_VERSION,
} from "@/lib/ai/judgments/apply";
import { JUDGMENTS_VERSION } from "@/lib/ai/judgments/questions";
import { canonicalHash } from "@/lib/ai/judgments/state-hash";
import type { JudgmentRun } from "@/lib/ai/predict";
import type { NewMatchModelSnapshot } from "@/lib/db/queries/match-model-snapshots";
import type {
  DixonColesFallbackReason,
  ModelScoreline,
  ModelScorelineSource,
} from "@/lib/quant/match-model";
import {
  DIXON_COLES_RHO,
  scorelineMatrix,
  topScorelines,
  type ScorelineMatrix,
} from "@/lib/quant/scoreline-model";

import type {
  MatchModelJevStatus,
  MatchModelJudgments,
  MatchModelProbabilities,
  TopScoreline,
} from "./types";
import { MATCH_MODEL_VERSION } from "./version";

// Montagem PURA de uma row da base do modelo por jogo (#555, ADR 0052): λ (DC ou
// heurístico) × julgamentos JEV → a MESMA matriz que o motor code_jev monta
// (runCodeJevEngine) → probabilidades de cada mercado, top placares e o fingerprint
// que decide se o run grava row nova ou só faz o heartbeat.

export const MODEL_BASE_OVER_UNDER_LINES = [1.5, 2.5, 3.5] as const;
export const TOP_SCORELINES_N = 5;

const round2 = (n: number) => Number(n.toFixed(2));

/** Probabilidades (pp, 2 casas) de todos os mercados da base, lidas da MESMA matriz. */
export function modelProbabilities(
  matrix: ScorelineMatrix,
): MatchModelProbabilities {
  const mr = selectionProbsFromMatrix(
    "match_result",
    ["home", "draw", "away"],
    matrix,
    null,
  );
  const dc = selectionProbsFromMatrix(
    "double_chance",
    ["home_or_draw", "away_or_draw", "home_or_away"],
    matrix,
    null,
  );
  const btts = selectionProbsFromMatrix("btts", ["yes", "no"], matrix, null);
  const ou = (line: number) => {
    const p = selectionProbsFromMatrix(
      "over_under",
      ["over", "under"],
      matrix,
      line,
    );
    return { over: p.over, under: p.under };
  };
  return {
    match_result: { home: mr.home, draw: mr.draw, away: mr.away },
    double_chance: {
      home_or_draw: dc.home_or_draw,
      away_or_draw: dc.away_or_draw,
      home_or_away: dc.home_or_away,
    },
    btts: { yes: btts.yes, no: btts.no },
    over_under: { "1.5": ou(1.5), "2.5": ou(2.5), "3.5": ou(3.5) },
  };
}

export type FingerprintInput = {
  source: ModelScorelineSource;
  degraded: boolean;
  fallbackReason: DixonColesFallbackReason | null;
  // ρ da matriz; null/undefined = DIXON_COLES_RHO pinado.
  rho: number | null | undefined;
  neutral: boolean;
  base: { home: number; away: number };
  adjusted: { home: number; away: number };
  jev:
    | null
    | {
        status: Exclude<MatchModelJevStatus, "not_attempted">;
        stateHash: string;
        jevModel: string | null;
      };
};

/**
 * Hash do que define o resultado. Fica de fora o que não muda as probabilidades nem o
 * reuso (datas, aiCallId, reusedFrom*, texto da falha). λ na 6ª casa: um refit que mexe
 * no λ gera row nova. ρ EFETIVO: ausente e DIXON_COLES_RHO dão o mesmo hash. O
 * `stateHash` entra: um state novo com as mesmas respostas precisa gravar o hash novo,
 * senão o reuso do predict erraria.
 */
export function matchModelFingerprint(input: FingerprintInput): string {
  const fixed = (n: number) => n.toFixed(6);
  return canonicalHash({
    modelVersion: MATCH_MODEL_VERSION,
    lambda: {
      source: input.source,
      degraded: input.degraded,
      fallbackReason: input.fallbackReason ?? null,
      rho: (input.rho ?? DIXON_COLES_RHO).toFixed(6),
      neutral: input.neutral,
      base: { home: fixed(input.base.home), away: fixed(input.base.away) },
      adjusted: {
        home: fixed(input.adjusted.home),
        away: fixed(input.adjusted.away),
      },
    },
    jev:
      input.jev === null
        ? null
        : {
            status: input.jev.status,
            stateHash: input.jev.stateHash,
            judgmentsVersion: JUDGMENTS_VERSION,
            weightsVersion: JUDGMENT_WEIGHTS_VERSION,
            jevModel: input.jev.jevModel,
          },
  });
}

/**
 * Row da base. `jev` null = JEV não tentado (fora da janela, flag desligado, sem chave,
 * prazo do run, dados indisponíveis); com um run, `applied` quando o JEV respondeu
 * (respostas novas ou reusadas) e `failed` quando não.
 */
export function buildMatchModelSnapshot(args: {
  matchId: string;
  scoreline: ModelScoreline;
  neutral: boolean;
  jev: JudgmentRun | null;
}): NewMatchModelSnapshot {
  const { scoreline, jev } = args;
  const applied = applyJudgments(scoreline, jev?.answers ?? null);
  // Sem JEV aplicado, a matriz do getModelScoreline já é a do λ base; com JEV, a MESMA
  // montagem de runCodeJevEngine (λ ajustado, ρ do fit).
  const matrix = applied.applied
    ? scorelineMatrix(applied.lambdaHome, applied.lambdaAway, {
        rho: scoreline.rho,
      })
    : scoreline.matrix;

  const jevStatus: MatchModelJevStatus =
    jev === null ? "not_attempted" : jev.answers ? "applied" : "failed";
  const judgments: MatchModelJudgments | null =
    jev === null
      ? null
      : {
          applied: applied.applied,
          answers: jev.answers,
          multipliers: applied.multipliers,
          versions: {
            judgments: JUDGMENTS_VERSION,
            weights: JUDGMENT_WEIGHTS_VERSION,
            jevModel: jev.jevModel,
            jevModelServed: jev.jevModelServed,
          },
          failure: jev.failure
            ? { kind: jev.failure.kind, message: jev.failure.message }
            : null,
          stateHash: jev.stateHash,
          aiCallId: jev.aiCallId,
          reusedFromPredictionId: jev.reusedFromPredictionId,
          reusedFromModelSnapshotId: jev.reusedFromModelSnapshotId,
        };

  const topScorelinesPct: TopScoreline[] = topScorelines(
    matrix,
    TOP_SCORELINES_N,
  ).map((c) => ({ home: c.home, away: c.away, pct: round2(c.p * 100) }));

  const fingerprint = matchModelFingerprint({
    source: scoreline.source,
    degraded: scoreline.degraded,
    fallbackReason: scoreline.fallbackReason ?? null,
    rho: scoreline.rho,
    neutral: args.neutral,
    base: { home: scoreline.lambdaHome, away: scoreline.lambdaAway },
    adjusted: { home: applied.lambdaHome, away: applied.lambdaAway },
    jev:
      jev === null
        ? null
        : {
            status: jevStatus === "applied" ? "applied" : "failed",
            stateHash: jev.stateHash,
            jevModel: jev.jevModel,
          },
  });

  return {
    matchId: args.matchId,
    modelVersion: MATCH_MODEL_VERSION,
    fingerprint,
    lambdaSource: scoreline.source,
    lambdaDegraded: scoreline.degraded,
    lambdaFallbackReason: scoreline.fallbackReason ?? null,
    rho: scoreline.rho ?? null,
    neutral: args.neutral,
    lambdaHomeBase: scoreline.lambdaHome,
    lambdaAwayBase: scoreline.lambdaAway,
    lambdaHome: applied.lambdaHome,
    lambdaAway: applied.lambdaAway,
    jevStatus,
    judgments,
    probabilities: modelProbabilities(matrix),
    topScorelines: topScorelinesPct,
  };
}
