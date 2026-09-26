// Escolha do λ do jogo (ADR 0051): Dixon-Coles refitado todo dia quando há ajuste
// fresco e histórico suficiente dos dois times; senão o heurístico da tabela (ADR 0037).
// Módulo PURO como o resto de `lib/quant` — o caller (lib/ratings/model-scoreline.ts)
// lê o flag, os ratings e a tabela e entrega tudo pronto aqui.

import {
  LAMBDA_MAX,
  LAMBDA_MIN,
  scorelineMatrix,
  type ScorelineMatrix,
} from "./scoreline-model";

export type ModelScorelineSource = "dixon_coles" | "heuristic";

// Por que o DC não foi usado (ausente quando foi). Vai pro log e pro jsonb da predição
// do code_jev, pra dar pra auditar quanto do tráfego cai no heurístico e por quê.
export type DixonColesFallbackReason =
  | "flag_off"
  | "no_fit"
  | "stale_fit"
  | "team_missing"
  | "few_matches"
  | "error";

export type ModelScoreline = {
  source: ModelScorelineSource;
  // Dados limitados no heurístico (λ do prior da liga, ADR 0036). O DC nunca é
  // degradado: time com pouco histórico cai no heurístico em vez de sair do prior.
  degraded: boolean;
  lambdaHome: number;
  lambdaAway: number;
  // ρ usado na matriz. Ausente = DIXON_COLES_RHO pinado de scorelineMatrix.
  rho?: number;
  matrix: ScorelineMatrix;
  fallbackReason?: DixonColesFallbackReason;
};

export type DcFitSnapshot = {
  homeAdvantage: number;
  rho: number;
  fittedAt: Date;
};

export type DcTeamRating = {
  attack: number;
  defence: number;
  matches: number;
};

export type HeuristicLambdas = {
  lambdaHome: number;
  lambdaAway: number;
  degradedData: boolean;
};

// Refit é diário; 72h tolera duas falhas seguidas do cron antes de largar o DC.
export const DC_MAX_FIT_AGE_MS = 72 * 60 * 60 * 1000;
// Jogos do time na janela do fit. Abaixo disso o α/β é quase só o prior (promovido,
// time de Champions com pouca campanha) e o heurístico da tabela da temporada é melhor.
export const DC_MIN_TEAM_MATCHES = 10;

export type PickModelScorelineInput = {
  now: Date;
  neutral: boolean;
  // null = flag desligado (o caller nem lê os ratings).
  dc:
    | {
        fit: DcFitSnapshot | null;
        home: DcTeamRating | null;
        away: DcTeamRating | null;
      }
    | { error: true }
    | null;
  heuristic: HeuristicLambdas | null;
};

function clampLambda(l: number): number {
  return Math.min(LAMBDA_MAX, Math.max(LAMBDA_MIN, l));
}

type UsableDc = { fit: DcFitSnapshot; home: DcTeamRating; away: DcTeamRating };

function resolveDc(
  dc: PickModelScorelineInput["dc"],
  now: Date
): { usable: UsableDc } | { reason: DixonColesFallbackReason } {
  if (dc === null) return { reason: "flag_off" };
  if ("error" in dc) return { reason: "error" };
  const { fit, home, away } = dc;
  if (!fit) return { reason: "no_fit" };
  if (now.getTime() - fit.fittedAt.getTime() > DC_MAX_FIT_AGE_MS) {
    return { reason: "stale_fit" };
  }
  if (!home || !away) return { reason: "team_missing" };
  if (
    home.matches < DC_MIN_TEAM_MATCHES ||
    away.matches < DC_MIN_TEAM_MATCHES
  ) {
    return { reason: "few_matches" };
  }
  return { usable: { fit, home, away } };
}

/**
 * λ + matriz do jogo. DC quando utilizável; senão o heurístico, carregando o motivo.
 * null = nem DC nem tabela (o motor não precifica; o over/under roda sem âncora).
 *
 * Mando neutro: sem γ (λ = α·β dos dois lados), como o heurístico faz com o pool
 * casa+fora.
 */
export function pickModelScoreline(
  input: PickModelScorelineInput
): ModelScoreline | null {
  const dc = resolveDc(input.dc, input.now);
  if ("usable" in dc) {
    const { fit, home, away } = dc.usable;
    const gamma = input.neutral ? 1 : fit.homeAdvantage;
    const lambdaHome = clampLambda(gamma * home.attack * away.defence);
    const lambdaAway = clampLambda(away.attack * home.defence);
    return {
      source: "dixon_coles",
      degraded: false,
      lambdaHome,
      lambdaAway,
      rho: fit.rho,
      matrix: scorelineMatrix(lambdaHome, lambdaAway, { rho: fit.rho }),
    };
  }
  const h = input.heuristic;
  if (!h) return null;
  return {
    source: "heuristic",
    degraded: h.degradedData,
    lambdaHome: h.lambdaHome,
    lambdaAway: h.lambdaAway,
    matrix: scorelineMatrix(h.lambdaHome, h.lambdaAway),
    fallbackReason: dc.reason,
  };
}
