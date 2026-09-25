import {
  applyJudgments,
  type AppliedJudgments,
} from "@/lib/ai/judgments/apply";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import { isBelowEdgeFloor } from "@/lib/ai/staking";
import type { MarketDescriptor } from "@/lib/odds/market-descriptor";
import {
  p1X2,
  pBtts,
  pOverUnder,
  scorelineMatrix,
  type ScorelineMatrix,
} from "@/lib/quant/scoreline-model";

import type { ModelScoreline } from "./model-scoreline";

// Motor `code_jev` (ADR 0041 §1): λ_base × ajustes JEV → matriz de placar → P(seleção)
// em todos os mercados partition → a seleção de MAIOR edge contra a implícita
// de-vigada, ou pass abaixo do piso. Puro e determinístico: mesma entrada, mesma
// decisão. O gate de edge do predict continua sendo a autoridade final (ADR 0038).

type Pricer = (
  matrix: ScorelineMatrix,
  line: number | null
) => Record<string, number>;

// Probabilidade (0..1) por selectionKey, lida da MESMA matriz. Keyed por dbMarketKey;
// mercado fora daqui (placar exato, scorer, assist, cartões) segue no caminho LLM.
const PRICERS: Record<string, Pricer> = {
  match_result: (m) => p1X2(m),
  over_under: (m, line) => {
    if (line === null) {
      throw new Error("over_under sem linha no motor code_jev");
    }
    const over = pOverUnder(m, line);
    return { over, under: 1 - over };
  },
  btts: (m) => {
    const yes = pBtts(m);
    return { yes, no: 1 - yes };
  },
  // Coberturas sobrepostas (Σ ≈ 2), na mesma escala da implícita de dupla chance
  // (descriptor.impliedSumTarget = 2).
  double_chance: (m) => {
    const p = p1X2(m);
    return {
      home_or_draw: p.home + p.draw,
      away_or_draw: p.away + p.draw,
      home_or_away: p.home + p.away,
    };
  },
};

export function isCodeJevMarket(descriptor: MarketDescriptor): boolean {
  return (
    (descriptor.marketKind ?? "partition") === "partition" &&
    Object.hasOwn(PRICERS, descriptor.dbMarketKey)
  );
}

const round2 = (n: number) => Number(n.toFixed(2));

// P(seleção) em pontos percentuais (0..100, 2 casas), na ordem de `selectionKeys`.
export function selectionProbsFromMatrix(
  dbMarketKey: string,
  selectionKeys: readonly string[],
  matrix: ScorelineMatrix,
  line: number | null
): Record<string, number> {
  const pricer = PRICERS[dbMarketKey];
  if (!pricer) {
    throw new Error(`mercado '${dbMarketKey}' não precificável no code_jev`);
  }
  const raw = pricer(matrix, line);
  const out: Record<string, number> = {};
  for (const key of selectionKeys) {
    const p = raw[key];
    if (p === undefined || !Number.isFinite(p)) {
      throw new Error(`seleção '${key}' sem probabilidade em '${dbMarketKey}'`);
    }
    out[key] = round2(p * 100);
  }
  return out;
}

// Uma linha candidata: a implícita de-vigada (a mesma `impliedByKey` do predict).
// `line` = null nos mercados sem linha; no over/under, a linha do bundle.
export type CodeJevCandidate = {
  line: number | null;
  impliedByKey: Record<string, number>;
};

export type CodeJevSelection = {
  key: string;
  line: number | null;
  modelProbPct: number;
  impliedPct: number | null;
  // modelProb − implied, 2 casas (mesmo arredondamento do gate). null sem implícita.
  edgePct: number | null;
};

export type CodeJevDecision = {
  // selectionKey recomendada ou "pass".
  recommendation: string;
  // Linha da decisão (a da recomendação; num pass, a da melhor candidata).
  line: number | null;
  // P(seleção) da linha decidida — vira modelProbByKey no predict.
  modelProbByKey: Record<string, number>;
  // Seleção de maior edge (a recomendada, ou a melhor candidata num pass). null
  // quando nenhuma seleção tem edge mensurável.
  best: CodeJevSelection | null;
  evaluations: CodeJevSelection[];
  lambdaBase: { home: number; away: number };
  judgments: AppliedJudgments;
};

export function runCodeJevEngine(args: {
  dbMarketKey: string;
  selectionKeys: readonly string[];
  scoreline: ModelScoreline;
  judgments: JudgmentAnswers | null;
  candidates: readonly CodeJevCandidate[];
  minEdgePp: number;
}): CodeJevDecision {
  const { scoreline, candidates } = args;
  if (candidates.length === 0) {
    throw new Error("code_jev sem linha candidata");
  }
  const applied = applyJudgments(scoreline, args.judgments);
  const matrix = scorelineMatrix(applied.lambdaHome, applied.lambdaAway, {
    rho: scoreline.rho,
  });

  const probsByLine = new Map<number | null, Record<string, number>>();
  const evaluations: CodeJevSelection[] = [];
  for (const candidate of candidates) {
    const probs = selectionProbsFromMatrix(
      args.dbMarketKey,
      args.selectionKeys,
      matrix,
      candidate.line
    );
    probsByLine.set(candidate.line, probs);
    for (const key of args.selectionKeys) {
      const implied = candidate.impliedByKey[key];
      const impliedPct =
        implied !== undefined && Number.isFinite(implied) ? implied : null;
      evaluations.push({
        key,
        line: candidate.line,
        modelProbPct: probs[key],
        impliedPct,
        edgePct: impliedPct === null ? null : round2(probs[key] - impliedPct),
      });
    }
  }

  // Maior edge vence; empate fica com a primeira (ordem das linhas, depois das
  // seleções) — determinístico.
  let best: CodeJevSelection | null = null;
  for (const e of evaluations) {
    if (e.edgePct === null) continue;
    if (best === null || e.edgePct > (best.edgePct ?? -Infinity)) best = e;
  }

  const recommendation =
    best && !isBelowEdgeFloor(best.key, best.edgePct, args.minEdgePp)
      ? best.key
      : "pass";
  const line = best ? best.line : candidates[0].line;

  return {
    recommendation,
    line,
    modelProbByKey: probsByLine.get(line) ?? {},
    best,
    evaluations,
    lambdaBase: { home: scoreline.lambdaHome, away: scoreline.lambdaAway },
    judgments: applied,
  };
}
