import { describe, expect, it } from "vitest";

import {
  DIXON_COLES_RHO,
  LAMBDA_MAX,
  LAMBDA_MIN,
  estimateLambdas,
  pScoreline,
  scorelineMatrix,
  type SplitGoalRates,
} from "@/lib/quant/scoreline-model";

// Poisson pmf de referência (independente da implementação) pros oráculos.
function pois(k: number, lambda: number): number {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p = (p * lambda) / i;
  return p;
}

describe("scorelineMatrix", () => {
  it("soma ≈ 1 e todas as células ≥ 0 (renormalização + clamp de τ)", () => {
    const m = scorelineMatrix(1.7, 1.1);
    let sum = 0;
    for (const row of m.cells) {
      for (const c of row) {
        expect(c).toBeGreaterThanOrEqual(0);
        sum += c;
      }
    }
    expect(sum).toBeCloseTo(1, 9);
  });

  it("mantém células ≥ 0 mesmo com λ absurdo (guarda de τ)", () => {
    const m = scorelineMatrix(LAMBDA_MAX, LAMBDA_MAX);
    for (const row of m.cells) {
      for (const c of row) expect(c).toBeGreaterThanOrEqual(0);
    }
  });

  it("com ρ=0 os RATIOS batem as formas fechadas de Poisson (renorm cancela)", () => {
    const lh = 1.6;
    const la = 1.2;
    const m = scorelineMatrix(lh, la, { rho: 0 });
    const base = pScoreline(m, 0, 0);
    // pScoreline(h,a)/pScoreline(0,0) = [pois(h,λh)/pois(0,λh)]·[pois(a,λa)/pois(0,λa)]
    for (const [h, a] of [
      [1, 0],
      [2, 1],
      [0, 3],
      [2, 2],
    ] as const) {
      const expected =
        (pois(h, lh) / pois(0, lh)) * (pois(a, la) / pois(0, la));
      expect(pScoreline(m, h, a) / base).toBeCloseTo(expected, 6);
    }
  });

  it("ρ negativo (default) reforça 0-0 e 1-1 vs o produto independente", () => {
    const lh = 1.4;
    const la = 1.1;
    const indep = scorelineMatrix(lh, la, { rho: 0 });
    const dc = scorelineMatrix(lh, la, { rho: DIXON_COLES_RHO });
    // τ00 = 1 - λhλaρ > 1 e τ11 = 1 - ρ = 1.1 > 1 → mais massa (pós-renorm relativa).
    expect(pScoreline(dc, 0, 0) / pScoreline(dc, 1, 0)).toBeGreaterThan(
      pScoreline(indep, 0, 0) / pScoreline(indep, 1, 0),
    );
    expect(pScoreline(dc, 1, 1) / pScoreline(dc, 2, 1)).toBeGreaterThan(
      pScoreline(indep, 1, 1) / pScoreline(indep, 2, 1),
    );
  });

  it("pScoreline retorna 0 fora do range truncado e pra índices não-inteiros", () => {
    const m = scorelineMatrix(1.2, 1.2, { maxGoals: 5 });
    expect(pScoreline(m, 6, 0)).toBe(0);
    expect(pScoreline(m, 0, 99)).toBe(0);
    expect(pScoreline(m, -1, 0)).toBe(0);
    expect(pScoreline(m, 1.5, 0)).toBe(0);
    expect(pScoreline(m, 2, 1)).toBeGreaterThan(0);
  });
});

describe("estimateLambdas", () => {
  const homeSplit: SplitGoalRates = {
    played: 10,
    goalsFor: 20,
    goalsAgainst: 10,
  };
  const awaySplit: SplitGoalRates = {
    played: 10,
    goalsFor: 10,
    goalsAgainst: 15,
  };

  it("degrau (i): golden de λ com k=5 pinado", () => {
    const { lambdaHome, lambdaAway, meta } = estimateLambdas({
      home: homeSplit,
      away: awaySplit,
      leagueAvgGoalsPerTeam: 1.3,
    });
    // Hand-computed (k=5, prior=1.3):
    // atkH=2.0 → shrink=(10·2+5·1.3)/15=1.766667; defA=1.5 → shrink=1.433333
    // λ_home = 1.766667·1.433333/1.3 = 1.947863
    // atkA=1.0 → shrink=1.1; defH=1.0 → shrink=1.1; λ_away = 1.21/1.3 = 0.930769
    expect(lambdaHome).toBeCloseTo(1.947863, 5);
    expect(lambdaAway).toBeCloseTo(0.930769, 5);
    expect(meta.source).toBe("splits");
  });

  it("degrau (ii): splits ausentes → prior de liga puro nos dois", () => {
    const { lambdaHome, lambdaAway, meta } = estimateLambdas({
      home: null,
      away: null,
      leagueAvgGoalsPerTeam: 1.3,
    });
    expect(lambdaHome).toBeCloseTo(1.3, 9);
    expect(lambdaAway).toBeCloseTo(1.3, 9);
    expect(meta.source).toBe("prior");
  });

  it("degrau (ii): amostra pequena (played < 5) recai no prior", () => {
    const { meta } = estimateLambdas({
      home: { played: 3, goalsFor: 9, goalsAgainst: 0 },
      away: awaySplit,
      leagueAvgGoalsPerTeam: 1.3,
    });
    expect(meta.source).toBe("prior");
  });

  it("neutro: usa o pool casa+fora por time", () => {
    const { lambdaHome, lambdaAway, meta } = estimateLambdas({
      home: homeSplit,
      away: awaySplit,
      leagueAvgGoalsPerTeam: 1.3,
      neutral: true,
    });
    // pool(home) = home = {10,20,10}; pool(away) = away = {10,10,15} (só uma fatia cada
    // no input) — simétrico: ambos usam o MESMO pool dos dois → home==away.
    expect(meta.source).toBe("splits");
    expect(lambdaHome).toBeCloseTo(lambdaAway, 9);
  });

  it("clampa λ ao range são [0.2, 4.5]", () => {
    const { lambdaHome } = estimateLambdas({
      home: { played: 10, goalsFor: 80, goalsAgainst: 0 }, // atk absurdo
      away: { played: 10, goalsFor: 0, goalsAgainst: 80 },
      leagueAvgGoalsPerTeam: 1.3,
    });
    expect(lambdaHome).toBeLessThanOrEqual(LAMBDA_MAX);
    expect(lambdaHome).toBeGreaterThanOrEqual(LAMBDA_MIN);
  });

  it("precondição violada (leagueAvg ≤ 0 / NaN) → prior clampado, nunca NaN", () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      const { lambdaHome, lambdaAway } = estimateLambdas({
        home: homeSplit,
        away: awaySplit,
        leagueAvgGoalsPerTeam: bad,
      });
      expect(Number.isFinite(lambdaHome)).toBe(true);
      expect(Number.isFinite(lambdaAway)).toBe(true);
    }
  });

  it("monotonicidade: ↑ gols do mandante ⇒ ↑ λ_home", () => {
    const base = estimateLambdas({
      home: homeSplit,
      away: awaySplit,
      leagueAvgGoalsPerTeam: 1.3,
    }).lambdaHome;
    const more = estimateLambdas({
      home: { ...homeSplit, goalsFor: 30 },
      away: awaySplit,
      leagueAvgGoalsPerTeam: 1.3,
    }).lambdaHome;
    expect(more).toBeGreaterThan(base);
  });
});
