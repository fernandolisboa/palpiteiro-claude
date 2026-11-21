// O palpite decidido em código (#668, ADR 0072). PURO: recebe as análises do run (já
// resumidas) e devolve o resultado, o placar, o 1º tempo e quem marca primeiro, todos da
// MESMA matriz. O LLM só escreve o texto em volta.
//
// Regra `most_likely_v1`: o resultado de maior chance no 1X2 da matriz e, dentro dele, o
// placar de maior chance. A base da matriz é plugável:
//   - market: o 1X2 congelado na análise `match_result` do run, sem margem, com λ
//     ajustados pra a matriz reproduzir o mercado (lib/quant/market-fit.ts), e por cima
//     os multiplicadores JEV + contexto do MESMO run (adjusted/base de cada lado);
//   - dc_jev: o λ ajustado do motor code_jev do run (`judgments.lambda.adjusted`).
// Sem nenhuma das duas, o chamador roda o cartucho v12 (o LLM escolhe, como antes).
//
// As odds são as congeladas na análise (já passaram pelo portão de frescor quando ela
// rodou): "Gerar só o palpite" sobre as mesmas análises dá o mesmo palpite.

import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";
import { fitLambdasToMarket, type MarketFit } from "@/lib/quant/market-fit";
import {
  DIXON_COLES_RHO,
  argmaxScoreline,
  firstHalfScorelineMatrix,
  firstToScoreProbs,
  mostLikelyOutcome,
  p1X2,
  scoreOutcome,
  scorelineMatrix,
  type MatchOutcome,
} from "@/lib/quant/scoreline-model";

import type { MarketAnalysisSummary } from "./synthesis-input";

export const PALPITE_PICK_RULE = "most_likely_v1" as const;

// Escolha do dono (2026-11-21): mercado + nossos ajustes; o modelo só sem preço. É uma
// constante, não flag: trocar em execução misturaria eras na calibração.
export type PalpiteBaseStrategy = "market_first" | "model_only";
export const PALPITE_BASE_STRATEGY: PalpiteBaseStrategy = "market_first";

export type PalpitePickSource = "market" | "dc_jev";

type Pair = { home: number; away: number };

// Duas análises são do mesmo run quando nasceram a poucos minutos uma da outra (e, com
// JEV nas duas, do mesmo estado). O fan-out grava todas no mesmo minuto.
export const SAME_RUN_WINDOW_MS = 5 * 60 * 1000;

export type PalpiteBase = {
  source: PalpitePickSource;
  // λ antes dos fatores do jogo: o do mercado (fit) ou o do modelo (judgments.lambda.base).
  base: Pair;
  // adjusted/base de cada lado (JEV + contexto extra do run); null = sem ajuste.
  multipliers: Pair | null;
  // O λ da matriz final.
  lambda: Pair;
  rho: number;
  // Predição de onde vieram as odds/λ (a análise match_result na base de mercado).
  basePredictionId: string;
  predictionCreatedAt: string | null;
  fit: PalpiteFit | null;
};

export type PalpiteFit = {
  version: MarketFit["version"];
  anchor: MarketFit["anchor"];
  residuals: MarketFit["residuals"];
  // A análise over/under do mesmo run que ancorou o total; null = o empate ancorou.
  overUnderPredictionId: string | null;
};

export type PalpitePick = {
  rule: typeof PALPITE_PICK_RULE;
  source: PalpitePickSource;
  outcome: MatchOutcome;
  score: Pair;
  // P do placar escolhido, pp com 2 casas.
  scorePct: number;
  // P(1X2) da matriz, pp com 2 casas.
  probs: Record<MatchOutcome, number>;
  // |P(mandante) − P(visitante)| em pp: o quão apertada foi a escolha.
  marginPp: number;
  firstHalfScore: Pair;
  firstToScore: "home" | "away" | "none";
  lambda: Pair;
  base: Pair;
  multipliers: Pair | null;
  rho: number;
  basePredictionId: string;
  predictionCreatedAt: string | null;
  fit: PalpiteFit | null;
};

const pp2 = (p: number) => Number((p * 100).toFixed(2));

function validLambda(l: number): boolean {
  return Number.isFinite(l) && l > 0;
}

// 1º gol coerente com o placar: o vencedor; ninguém num 0–0; num empate com gols, o lado
// com mais chance de marcar primeiro (mandante no empate exato).
function firstToScoreFor(score: Pair, lambda: Pair): PalpitePick["firstToScore"] {
  if (score.home > score.away) return "home";
  if (score.away > score.home) return "away";
  if (score.home === 0) return "none";
  const p = firstToScoreProbs(lambda.home, lambda.away);
  return p.away > p.home ? "away" : "home";
}

export function pickFromBase(base: PalpiteBase): PalpitePick | null {
  const { lambda, rho } = base;
  if (!validLambda(lambda.home) || !validLambda(lambda.away) || !Number.isFinite(rho)) {
    return null;
  }
  const matrix = scorelineMatrix(lambda.home, lambda.away, { rho });
  const raw = p1X2(matrix);
  const outcome = mostLikelyOutcome(raw);
  const score = argmaxScoreline(matrix, (h, a) => scoreOutcome({ home: h, away: a }) === outcome);
  if (!score) return null;
  const firstHalf = argmaxScoreline(
    firstHalfScorelineMatrix(lambda.home, lambda.away, { rho }),
    (h, a) => h <= score.home && a <= score.away,
  );
  if (!firstHalf) return null;
  const finalScore = { home: score.home, away: score.away };
  return {
    rule: PALPITE_PICK_RULE,
    source: base.source,
    outcome,
    score: finalScore,
    scorePct: pp2(score.p),
    probs: { home: pp2(raw.home), draw: pp2(raw.draw), away: pp2(raw.away) },
    marginPp: pp2(Math.abs(raw.home - raw.away)),
    firstHalfScore: { home: firstHalf.home, away: firstHalf.away },
    firstToScore: firstToScoreFor(finalScore, lambda),
    lambda: { ...lambda },
    base: { ...base.base },
    multipliers: base.multipliers ? { ...base.multipliers } : null,
    rho,
    basePredictionId: base.basePredictionId,
    predictionCreatedAt: base.predictionCreatedAt,
    fit: base.fit,
  };
}

// ─── Bases ───────────────────────────────────────────────────────────────────

type Summary = Pick<
  MarketAnalysisSummary,
  | "marketKey"
  | "predictionId"
  | "odds"
  | "line"
  | "predictionCreatedAt"
  | "judgmentsModel"
>;

// Ordem de onde ler o λ do run: as análises code_jev compartilham o mesmo λ, mas o 1X2
// é a referência; depois as outras, em ordem fixa (nunca a ordem de chegada).
const JUDGMENTS_PRIORITY = ["match_result", "double_chance", "over_under", "btts"];

function priorityOf(marketKey: string): number {
  const i = JUDGMENTS_PRIORITY.indexOf(marketKey);
  return i === -1 ? JUDGMENTS_PRIORITY.length : i;
}

// A análise code_jev de onde sai o λ do run (prioridade fixa, desempate pela key).
export function runJudgmentsFromAnalyses<T extends Summary>(
  analyses: readonly T[],
): (T & { judgmentsModel: NonNullable<T["judgmentsModel"]> }) | null {
  const withJudgments = analyses
    .filter((a): a is T & { judgmentsModel: NonNullable<T["judgmentsModel"]> } =>
      Boolean(a.judgmentsModel),
    )
    .sort(
      (a, b) =>
        priorityOf(a.marketKey) - priorityOf(b.marketKey) ||
        a.marketKey.localeCompare(b.marketKey) ||
        a.predictionId.localeCompare(b.predictionId),
    );
  return withJudgments[0] ?? null;
}

function ratio(adjusted: number, base: number): number | null {
  const r = adjusted / base;
  return Number.isFinite(r) && r > 0 ? r : null;
}

function multipliersOf(j: NonNullable<Summary["judgmentsModel"]>): Pair | null {
  const home = ratio(j.adjusted.home, j.base.home);
  const away = ratio(j.adjusted.away, j.base.away);
  return home === null || away === null ? null : { home, away };
}

function sameRun(a: Summary, b: Summary): boolean {
  if (!a.predictionCreatedAt || !b.predictionCreatedAt) return false;
  const dt = Math.abs(Date.parse(a.predictionCreatedAt) - Date.parse(b.predictionCreatedAt));
  if (!(dt <= SAME_RUN_WINDOW_MS)) return false;
  if (a.judgmentsModel && b.judgmentsModel) {
    return a.judgmentsModel.stateHash === b.judgmentsModel.stateHash;
  }
  return true;
}

function validOdd(odd: number | undefined): odd is number {
  return typeof odd === "number" && Number.isFinite(odd) && odd > 1;
}

// P(over) sem margem da análise over/under do MESMO run da `anchor`; senão null (uma
// leitura de outro momento ignorada).
function sameRunOverUnder(
  anchor: Summary,
  analyses: readonly Summary[],
): { line: number; over: number; predictionId: string } | null {
  const ou = analyses.find((a) => a.marketKey === "over_under");
  if (!ou || !sameRun(anchor, ou)) return null;
  const line = ou.line;
  const over = ou.odds?.over;
  const under = ou.odds?.under;
  if (typeof line !== "number" || !Number.isFinite(line) || !validOdd(over) || !validOdd(under)) {
    return null;
  }
  const { probs } = computeMarketImpliedProbabilities([over, under]);
  return { line, over: probs[0], predictionId: ou.predictionId };
}

/**
 * Base de mercado: odds, ρ e multiplicadores da MESMA predição `match_result`; o
 * over/under só se for do mesmo run. null sem o 1X2 completo.
 */
export function marketBaseFromAnalyses(analyses: readonly Summary[]): PalpiteBase | null {
  const mr = analyses.find((a) => a.marketKey === "match_result");
  if (!mr) return null;
  const home = mr.odds?.home;
  const draw = mr.odds?.draw;
  const away = mr.odds?.away;
  if (!validOdd(home) || !validOdd(draw) || !validOdd(away)) return null;
  const { probs } = computeMarketImpliedProbabilities([home, draw, away]);
  const j = mr.judgmentsModel ?? null;
  const rho = j?.rho ?? DIXON_COLES_RHO;
  const ou = sameRunOverUnder(mr, analyses);
  const fit = fitLambdasToMarket(
    {
      oneXTwo: { home: probs[0], draw: probs[1], away: probs[2] },
      overUnder: ou ? { line: ou.line, over: ou.over } : null,
    },
    { rho },
  );
  if (!fit) return null;
  const multipliers = j ? multipliersOf(j) : null;
  const base = { home: fit.lambdaHome, away: fit.lambdaAway };
  return {
    source: "market",
    base,
    multipliers,
    lambda: multipliers
      ? { home: base.home * multipliers.home, away: base.away * multipliers.away }
      : { ...base },
    rho: fit.rho,
    basePredictionId: mr.predictionId,
    predictionCreatedAt: mr.predictionCreatedAt ?? null,
    fit: {
      version: fit.version,
      anchor: fit.anchor,
      residuals: fit.residuals,
      overUnderPredictionId: ou?.predictionId ?? null,
    },
  };
}

/** Base do modelo: o λ ajustado gravado pelo code_jev do run, direto. */
export function dcJevBaseFromAnalyses(analyses: readonly Summary[]): PalpiteBase | null {
  const run = runJudgmentsFromAnalyses(analyses);
  if (!run) return null;
  const j = run.judgmentsModel;
  return {
    source: "dc_jev",
    base: { ...j.base },
    multipliers: multipliersOf(j),
    lambda: { ...j.adjusted },
    rho: j.rho ?? DIXON_COLES_RHO,
    basePredictionId: run.predictionId,
    predictionCreatedAt: run.predictionCreatedAt ?? null,
    fit: null,
  };
}

/**
 * O palpite de pré-jogo: `market_first` tenta mercado → modelo; `model_only`, só o
 * modelo. null = sem fonte (o chamador roda o v12).
 */
export function resolvePregamePick(
  analyses: readonly Summary[],
  strategy: PalpiteBaseStrategy = PALPITE_BASE_STRATEGY,
): PalpitePick | null {
  if (strategy === "market_first") {
    const market = marketBaseFromAnalyses(analyses);
    const pick = market ? pickFromBase(market) : null;
    if (pick) return pick;
  }
  const model = dcJevBaseFromAnalyses(analyses);
  return model ? pickFromBase(model) : null;
}
