// Ajuste de λ ao mercado (#668, ADR 0072). Módulo PURO, síncrono, determinístico.
//
// Dado o 1X2 sem margem (e, quando houver, o over/under sem margem da mesma leitura),
// acha (λ mandante, λ visitante) tal que a matriz Dixon-Coles com o MESMO ρ reproduza o
// mercado. Duas bisseções aninhadas, nunca um otimizador genérico:
//   - interna: com o total T = λh + λa fixo, a divisão s = λh / T tal que
//     P(mandante) − P(visitante) bata com o mercado (cresce com s);
//   - externa: o total T tal que P(over linha) bata com o over/under (cresce com T) ou,
//     sem over/under, tal que P(empate) bata com o 1X2 (cai com T). No 2º caso a solução
//     reproduz o 1X2 inteiro (2 equações, 2 incógnitas).
// λ fica preso a [LAMBDA_MIN, LAMBDA_MAX] pelo intervalo de busca; quando o alvo cai fora
// do alcance, fica a ponta mais perto e os resíduos dizem quanto sobrou (vão pro log).

import { bisect } from "@/lib/odds/implied-probability";

import {
  DIXON_COLES_RHO,
  LAMBDA_MAX,
  LAMBDA_MIN,
  p1X2,
  pOverUnder,
  scorelineMatrix,
} from "./scoreline-model";

export const MARKET_FIT_VERSION = "market_fit_v1" as const;

// 50 passos num intervalo de largura < 9 dão erro < 1e-14: bem abaixo de qualquer odd.
const ITERATIONS = 50;

export type MarketFitTargets = {
  // Probabilidades sem margem do 1X2 (qualquer escala; normalizadas aqui).
  oneXTwo: { home: number; draw: number; away: number };
  // P(over linha) sem margem, da mesma leitura. Ausente → o empate ancora o total.
  overUnder?: { line: number; over: number } | null;
};

export type MarketFit = {
  version: typeof MARKET_FIT_VERSION;
  lambdaHome: number;
  lambdaAway: number;
  rho: number;
  anchor: "over_under" | "draw";
  // Modelo − alvo, em pontos percentuais. Perto de zero quando o mercado cabe no modelo.
  residuals: { homeMinusAwayPp: number; drawPp: number; overPp: number | null };
};

function validProb(p: number): boolean {
  return Number.isFinite(p) && p > 0 && p < 1;
}

function normalized1X2(
  raw: MarketFitTargets["oneXTwo"],
): { home: number; draw: number; away: number } | null {
  const values = [raw.home, raw.draw, raw.away];
  if (values.some((v) => !Number.isFinite(v) || v <= 0)) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return { home: raw.home / sum, draw: raw.draw / sum, away: raw.away / sum };
}

// Raiz por bisseção; sem troca de sinal no intervalo, a ponta de menor |f|.
function solve(f: (x: number) => number, lo: number, hi: number): number {
  const root = bisect(f, lo, hi, ITERATIONS);
  if (root !== null) return root;
  return Math.abs(f(lo)) <= Math.abs(f(hi)) ? lo : hi;
}

// Pontos da grade que cerca a raiz do total antes da bisseção externa. Perto das pontas
// do intervalo a divisão fica presa (os dois λ batem no limite), e a função do total deixa
// de ser monótona lá; a grade acha o primeiro trecho com troca de sinal.
const TOTAL_GRID = 40;

function solveTotal(f: (total: number) => number, lo: number, hi: number): number {
  const step = (hi - lo) / TOTAL_GRID;
  let best = lo;
  let bestAbs = Infinity;
  let prevX = lo;
  let prevF = f(lo);
  for (let i = 1; i <= TOTAL_GRID; i++) {
    const x = i === TOTAL_GRID ? hi : lo + i * step;
    const fx = f(x);
    if (prevF === 0) return prevX;
    if (Math.sign(fx) !== Math.sign(prevF)) return solve(f, prevX, x);
    if (Math.abs(prevF) < bestAbs) {
      bestAbs = Math.abs(prevF);
      best = prevX;
    }
    prevX = x;
    prevF = fx;
  }
  return Math.abs(prevF) < bestAbs ? prevX : best;
}

export function fitLambdasToMarket(
  targets: MarketFitTargets,
  opts?: { rho?: number | null },
): MarketFit | null {
  const target = normalized1X2(targets.oneXTwo);
  if (!target) return null;
  const over = targets.overUnder ?? null;
  if (over && (!validProb(over.over) || !Number.isFinite(over.line) || over.line <= 0)) {
    return null;
  }
  const rho = opts?.rho ?? DIXON_COLES_RHO;
  if (!Number.isFinite(rho)) return null;

  const matrixAt = (total: number, share: number) =>
    scorelineMatrix(share * total, (1 - share) * total, { rho });
  const diffTarget = target.home - target.away;

  // Divisão s que bate P(H) − P(A) com o total fixo. s limitado pra os dois λ ficarem
  // em [LAMBDA_MIN, LAMBDA_MAX].
  const shareFor = (total: number): number => {
    const lo = Math.max(LAMBDA_MIN / total, 1 - LAMBDA_MAX / total);
    const hi = Math.min(LAMBDA_MAX / total, 1 - LAMBDA_MIN / total);
    return solve(
      (s) => {
        const p = p1X2(matrixAt(total, s));
        return p.home - p.away - diffTarget;
      },
      lo,
      hi,
    );
  };

  const outer = over
    ? (total: number) => pOverUnder(matrixAt(total, shareFor(total)), over.line) - over.over
    : (total: number) => p1X2(matrixAt(total, shareFor(total))).draw - target.draw;
  const total = solveTotal(outer, 2 * LAMBDA_MIN, 2 * LAMBDA_MAX);
  const share = shareFor(total);
  const lambdaHome = share * total;
  const lambdaAway = (1 - share) * total;

  const matrix = matrixAt(total, share);
  const fitted = p1X2(matrix);
  const pp = (x: number) => Number((x * 100).toFixed(4));
  return {
    version: MARKET_FIT_VERSION,
    lambdaHome,
    lambdaAway,
    rho,
    anchor: over ? "over_under" : "draw",
    residuals: {
      homeMinusAwayPp: pp(fitted.home - fitted.away - diffTarget),
      drawPp: pp(fitted.draw - target.draw),
      overPp: over ? pp(pOverUnder(matrix, over.line) - over.over) : null,
    },
  };
}
