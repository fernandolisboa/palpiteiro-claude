import { describe, expect, it } from "vitest";

import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";
import {
  MARKET_FIT_VERSION,
  fitLambdasToMarket,
} from "@/lib/quant/market-fit";
import {
  DIXON_COLES_RHO,
  LAMBDA_MAX,
  LAMBDA_MIN,
  p1X2,
  pOverUnder,
  scorelineMatrix,
} from "@/lib/quant/scoreline-model";

function targetsFrom(lh: number, la: number, rho: number, line?: number) {
  const m = scorelineMatrix(lh, la, { rho });
  return {
    oneXTwo: p1X2(m),
    overUnder: line === undefined ? null : { line, over: pOverUnder(m, line) },
  };
}

describe("fitLambdasToMarket", () => {
  it("ida e volta: o 1X2 de um λ devolve o mesmo λ (empate ancora o total)", () => {
    for (const [lh, la] of [
      [1.6, 1.1],
      [0.95, 1.55],
      [2.4, 0.6],
      [1.2, 1.2],
    ] as const) {
      const fit = fitLambdasToMarket(targetsFrom(lh, la, DIXON_COLES_RHO));
      expect(fit).not.toBeNull();
      expect(fit!.anchor).toBe("draw");
      expect(fit!.version).toBe(MARKET_FIT_VERSION);
      expect(fit!.lambdaHome).toBeCloseTo(lh, 5);
      expect(fit!.lambdaAway).toBeCloseTo(la, 5);
      expect(Math.abs(fit!.residuals.drawPp)).toBeLessThan(1e-4);
      expect(Math.abs(fit!.residuals.homeMinusAwayPp)).toBeLessThan(1e-4);
    }
  });

  it("ida e volta com ρ da predição e over/under coerente (linhas 1.5, 2.5, 3.5)", () => {
    for (const line of [1.5, 2.5, 3.5]) {
      const rho = -0.06;
      const fit = fitLambdasToMarket(targetsFrom(1.7, 1.05, rho, line), { rho });
      expect(fit!.anchor).toBe("over_under");
      expect(fit!.rho).toBe(rho);
      expect(fit!.lambdaHome).toBeCloseTo(1.7, 5);
      expect(fit!.lambdaAway).toBeCloseTo(1.05, 5);
      expect(Math.abs(fit!.residuals.overPp!)).toBeLessThan(1e-4);
    }
  });

  it("ρ ausente usa o pinado", () => {
    const fit = fitLambdasToMarket(targetsFrom(1.3, 1.0, DIXON_COLES_RHO), { rho: null });
    expect(fit!.rho).toBe(DIXON_COLES_RHO);
  });

  it("over/under conflitante: o total segue o over, a divisão segue o 1X2", () => {
    const oneXTwo = p1X2(scorelineMatrix(1.4, 1.0));
    const over = pOverUnder(scorelineMatrix(2.2, 1.6), 2.5);
    const fit = fitLambdasToMarket({ oneXTwo, overUnder: { line: 2.5, over } });
    expect(fit!.anchor).toBe("over_under");
    expect(fit!.lambdaHome + fit!.lambdaAway).toBeGreaterThan(3);
    expect(Math.abs(fit!.residuals.overPp!)).toBeLessThan(1e-4);
    expect(Math.abs(fit!.residuals.homeMinusAwayPp)).toBeLessThan(1e-4);
    // O empate sobra: é o resíduo que vai pro log.
    expect(Math.abs(fit!.residuals.drawPp)).toBeGreaterThan(0.5);
  });

  it("favorito extremo (1.05): λ dentro dos limites e mandante muito acima", () => {
    const { probs } = computeMarketImpliedProbabilities([1.05, 15, 34]);
    const fit = fitLambdasToMarket({
      oneXTwo: { home: probs[0], draw: probs[1], away: probs[2] },
    });
    expect(fit).not.toBeNull();
    for (const l of [fit!.lambdaHome, fit!.lambdaAway]) {
      expect(l).toBeGreaterThanOrEqual(LAMBDA_MIN - 1e-9);
      expect(l).toBeLessThanOrEqual(LAMBDA_MAX + 1e-9);
    }
    expect(fit!.lambdaHome).toBeGreaterThan(3 * fit!.lambdaAway);
    expect(Number.isFinite(fit!.residuals.drawPp)).toBe(true);
  });

  it("alvos inválidos → null", () => {
    expect(fitLambdasToMarket({ oneXTwo: { home: 0, draw: 0.3, away: 0.7 } })).toBeNull();
    expect(fitLambdasToMarket({ oneXTwo: { home: Number.NaN, draw: 0.3, away: 0.3 } })).toBeNull();
    expect(fitLambdasToMarket({ oneXTwo: { home: -0.1, draw: 0.5, away: 0.6 } })).toBeNull();
    const ok = { home: 0.45, draw: 0.28, away: 0.27 };
    expect(fitLambdasToMarket({ oneXTwo: ok, overUnder: { line: 2.5, over: 1 } })).toBeNull();
    expect(fitLambdasToMarket({ oneXTwo: ok, overUnder: { line: Number.NaN, over: 0.5 } })).toBeNull();
    expect(fitLambdasToMarket({ oneXTwo: ok }, { rho: Number.NaN })).toBeNull();
  });

  it("aceita probabilidades em qualquer escala (normaliza)", () => {
    const a = fitLambdasToMarket({ oneXTwo: { home: 45, draw: 28, away: 27 } });
    const b = fitLambdasToMarket({ oneXTwo: { home: 0.45, draw: 0.28, away: 0.27 } });
    expect(a!.lambdaHome).toBeCloseTo(b!.lambdaHome, 9);
  });

  it("determinístico: duas chamadas iguais dão o mesmo resultado", () => {
    const t = { oneXTwo: { home: 0.31, draw: 0.27, away: 0.42 }, overUnder: { line: 2.5, over: 0.47 } };
    expect(fitLambdasToMarket(t)).toEqual(fitLambdasToMarket(t));
  });
});

describe("monotonia das funções das bisseções", () => {
  it("P(H) − P(A) cresce com a divisão s, a total fixo", () => {
    for (const total of [1.5, 2.6, 4]) {
      let prev = -Infinity;
      for (let s = 0.15; s <= 0.85; s += 0.05) {
        const p = p1X2(scorelineMatrix(s * total, (1 - s) * total));
        const d = p.home - p.away;
        expect(d).toBeGreaterThan(prev);
        prev = d;
      }
    }
  });

  it("P(over) cresce e P(empate) cai com o total, a divisão fixa", () => {
    for (const s of [0.3, 0.5, 0.7]) {
      let prevOver = -Infinity;
      let prevDraw = Infinity;
      for (let total = 0.6; total <= 8; total += 0.2) {
        const m = scorelineMatrix(s * total, (1 - s) * total);
        const o = pOverUnder(m, 2.5);
        const d = p1X2(m).draw;
        expect(o).toBeGreaterThan(prevOver);
        expect(d).toBeLessThan(prevDraw);
        prevOver = o;
        prevDraw = d;
      }
    }
  });
});
