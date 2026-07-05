import { describe, expect, it } from "vitest";

import {
  DIXON_COLES_RHO,
  KAPPA_FIRST_HALF,
  LAMBDA_MAX,
  LAMBDA_MIN,
  cs16,
  estimateLambdas,
  firstHalfScorelineMatrix,
  firstToScoreProbs,
  jointProbability,
  p1X2,
  pBtts,
  pCleanSheet,
  pHomeScoresFirst,
  pMarginAtLeast,
  pOverUnder,
  poolSplitRates,
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

  it("poolSplitRates: soma as contagens das duas fatias do MESMO time", () => {
    const pooled = poolSplitRates(
      { played: 5, goalsFor: 12, goalsAgainst: 3 },
      { played: 5, goalsFor: 8, goalsAgainst: 5 },
    );
    expect(pooled).toEqual({ played: 10, goalsFor: 20, goalsAgainst: 8 });
    expect(poolSplitRates(null, null)).toBeNull();
    expect(poolSplitRates({ played: 5, goalsFor: 4, goalsAgainst: 4 }, null)).toEqual(
      { played: 5, goalsFor: 4, goalsAgainst: 4 },
    );
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

describe("readers sobre a matriz (Fase 2)", () => {
  // Matriz sem τ (ρ=0) → produto de Poisson: oráculos de forma fechada limpos.
  const lh = 1.6;
  const la = 1.0;
  const m = scorelineMatrix(lh, la, { rho: 0 });

  it("p1X2 soma 1 e bate as marginais; mandante mais forte ⇒ home > away", () => {
    const { home, draw, away } = p1X2(m);
    expect(home + draw + away).toBeCloseTo(1, 9);
    expect(home).toBeGreaterThan(away);
  });

  it("pBtts = 1 − P(h=0) − P(a=0) + P(0,0) (inclusão-exclusão)", () => {
    const pH0 = pois(0, lh); // ~normalizado (tail desprezível em λ<=1.6)
    // Usa a própria matriz pros marginais renormalizados (evita erro de truncamento):
    let pHome0 = 0;
    let pAway0 = 0;
    for (let a = 0; a <= m.maxGoals; a++) pHome0 += pScoreline(m, 0, a);
    for (let h = 0; h <= m.maxGoals; h++) pAway0 += pScoreline(m, h, 0);
    const expected = 1 - pHome0 - pAway0 + pScoreline(m, 0, 0);
    expect(pBtts(m)).toBeCloseTo(expected, 9);
    expect(pH0).toBeGreaterThan(0); // sanity do helper
  });

  it("pOverUnder(2.5) + P(under 2.5) = 1; monotônico decrescente na linha", () => {
    const over15 = pOverUnder(m, 1.5);
    const over25 = pOverUnder(m, 2.5);
    const over35 = pOverUnder(m, 3.5);
    expect(over15).toBeGreaterThan(over25);
    expect(over25).toBeGreaterThan(over35);
    // under 2.5 = 1 - over 2.5 (sem push em k+0.5).
    expect(1 - over25).toBeGreaterThan(0);
  });

  it("pMarginAtLeast: home por >=2 ⊂ home por >=1; away idem", () => {
    expect(pMarginAtLeast(m, "home", 1)).toBeGreaterThan(
      pMarginAtLeast(m, "home", 2),
    );
    expect(pMarginAtLeast(m, "home", 1)).toBeCloseTo(p1X2(m).home, 9); // margem>=1 == vitória
    expect(pMarginAtLeast(m, "away", 1)).toBeCloseTo(p1X2(m).away, 9);
  });

  it("pCleanSheet(home) = Σ_h P(h,0) = P(away marca 0)", () => {
    let pAwayZero = 0;
    for (let h = 0; h <= m.maxGoals; h++) pAwayZero += pScoreline(m, h, 0);
    expect(pCleanSheet(m, "home")).toBeCloseTo(pAwayZero, 9);
  });

  it("cs16: 16 células 0-3×0-3 + other ≈ 1", () => {
    const { grid, other } = cs16(m);
    expect(grid.length).toBe(4);
    expect(grid[0].length).toBe(4);
    let sum = other;
    for (const row of grid) for (const c of row) sum += c;
    expect(sum).toBeCloseTo(1, 9);
    expect(grid[2][0]).toBeCloseTo(pScoreline(m, 2, 0), 12);
  });

  it("jointProbability: AND de predicados = Σ células que satisfazem todos", () => {
    // joint(home vence E over 1.5) <= min das marginais; e == pOverUnder condicional manual.
    const joint = jointProbability(m, [
      (h, a) => h > a,
      (h, a) => h + a > 1.5,
    ]);
    expect(joint).toBeLessThanOrEqual(p1X2(m).home);
    expect(joint).toBeLessThanOrEqual(pOverUnder(m, 1.5));
    // conferência direta
    let manual = 0;
    for (let h = 0; h <= m.maxGoals; h++)
      for (let a = 0; a <= m.maxGoals; a++)
        if (h > a && h + a > 1.5) manual += pScoreline(m, h, a);
    expect(joint).toBeCloseTo(manual, 12);
  });

  it("firstHalfScorelineMatrix: λ_1T = κ·λ (mais 0-0 que a matriz cheia)", () => {
    const fh = firstHalfScorelineMatrix(lh, la, { rho: 0 });
    // No 1º tempo há menos gols → P(0-0) maior que no jogo cheio.
    expect(pScoreline(fh, 0, 0)).toBeGreaterThan(pScoreline(m, 0, 0));
    // Oráculo: fh(1,0)/fh(0,0) = λh·κ (razão de Poisson).
    expect(pScoreline(fh, 1, 0) / pScoreline(fh, 0, 0)).toBeCloseTo(
      lh * KAPPA_FIRST_HALF,
      6,
    );
  });

  it("firstToScoreProbs: soma 1; home>away com mandante forte; none = e^{-(λh+λa)}", () => {
    const { home, away, none } = firstToScoreProbs(lh, la);
    expect(home + away + none).toBeCloseTo(1, 12);
    expect(home).toBeGreaterThan(away);
    expect(none).toBeCloseTo(Math.exp(-(lh + la)), 12);
    expect(pHomeScoresFirst(lh, la)).toBeCloseTo(home, 12);
  });

  it("firstToScoreProbs: λ total 0 → none=1", () => {
    expect(firstToScoreProbs(0, 0)).toEqual({ home: 0, away: 0, none: 1 });
  });
});
