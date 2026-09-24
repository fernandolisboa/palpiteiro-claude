import { describe, expect, it } from "vitest";

import {
  bootstrapMeanCi,
  brierScore,
  calibrationSlope,
  computeCalibration,
  logLoss,
  reliabilityBins,
  type CalibrationPair,
} from "@/lib/calibration/metrics";

describe("brierScore", () => {
  it("vazio → NaN", () => {
    expect(Number.isNaN(brierScore([]))).toBe(true);
  });
  it("previsão perfeita → 0", () => {
    expect(
      brierScore([
        { p: 1, y: 1 },
        { p: 0, y: 0 },
      ]),
    ).toBeCloseTo(0, 12);
  });
  it("meia-moeda: (0.5-1)²+(0.5-0)² /2 = 0.25", () => {
    expect(
      brierScore([
        { p: 0.5, y: 1 },
        { p: 0.5, y: 0 },
      ]),
    ).toBeCloseTo(0.25, 12);
  });
});

describe("logLoss", () => {
  it("vazio → NaN", () => {
    expect(Number.isNaN(logLoss([]))).toBe(true);
  });
  it("p=0.5, y=1 → −ln(0.5) = 0.693147", () => {
    expect(logLoss([{ p: 0.5, y: 1 }])).toBeCloseTo(Math.log(2), 12);
  });
  it("previsão perfeita → ~0 (clamp evita log(0))", () => {
    expect(
      logLoss([
        { p: 1, y: 1 },
        { p: 0, y: 0 },
      ]),
    ).toBeCloseTo(0, 10);
  });
  it("errado com convicção → finito e grande (clamp, não Infinity)", () => {
    const ll = logLoss([{ p: 0, y: 1 }]);
    expect(Number.isFinite(ll)).toBe(true);
    expect(ll).toBeGreaterThan(30);
  });
});

describe("reliabilityBins", () => {
  it("10 bins uniformes; p=1 cai no último (topo inclusive)", () => {
    const bins = reliabilityBins([{ p: 1, y: 1 }], 10);
    expect(bins).toHaveLength(10);
    expect(bins[9].n).toBe(1);
    expect(bins[0].n).toBe(0);
    expect(bins[0].meanForecast).toBeNull();
  });
  it("agrupa por faixa e mede previsto vs observado", () => {
    const pairs: CalibrationPair[] = [
      { p: 0.05, y: 0 },
      { p: 0.08, y: 0 },
      { p: 0.95, y: 1 },
    ];
    const bins = reliabilityBins(pairs, 10);
    expect(bins[0].n).toBe(2);
    expect(bins[0].meanForecast).toBeCloseTo(0.065, 12);
    expect(bins[0].meanOutcome).toBe(0); // ambos y=0
    expect(bins[9].n).toBe(1);
    expect(bins[9].meanOutcome).toBe(1);
  });
});

describe("computeCalibration", () => {
  it("agrega n + brier + logLoss + bins", () => {
    const pairs: CalibrationPair[] = [
      { p: 0.5, y: 1 },
      { p: 0.5, y: 0 },
    ];
    const s = computeCalibration(pairs);
    expect(s.n).toBe(2);
    expect(s.brier).toBeCloseTo(0.25, 12);
    expect(s.logLoss).toBeCloseTo(Math.log(2), 12);
    expect(s.slope).toBeNaN(); // p constante → slope não identificável
    expect(s.bins).toHaveLength(10);
  });
});

// Pares com frequência observada EXATA = sigmoid(b·logit(p)): o MLE bate b em cheio
// (as equações de score zeram em a=0, b=b0).
function pairsAt(p: number, n: number, ones: number): CalibrationPair[] {
  return Array.from({ length: n }, (_, i) => ({ p, y: i < ones ? 1 : 0 }));
}

describe("calibrationSlope", () => {
  it("bem calibrado → 1 (p=0.2 com 1/5, p=0.8 com 4/5)", () => {
    const pairs = [...pairsAt(0.2, 5, 1), ...pairsAt(0.8, 5, 4)];
    expect(calibrationSlope(pairs)).toBeCloseTo(1, 8);
  });

  it("overconfident → 0.5 (logit(1/17)=−ln16, observado 1/5 = sigmoid(−ln4))", () => {
    const pairs = [
      ...pairsAt(1 / 17, 10, 2),
      ...pairsAt(16 / 17, 10, 8),
      ...pairsAt(0.5, 2, 1),
    ];
    expect(calibrationSlope(pairs)).toBeCloseTo(0.5, 8);
  });

  it("tímido → 2 (p=0.2 observado 1/17)", () => {
    const pairs = [...pairsAt(0.2, 17, 1), ...pairsAt(0.8, 17, 16)];
    expect(calibrationSlope(pairs)).toBeCloseTo(2, 8);
  });

  it("não identificável → NaN (vazio, 1 par, y constante, p constante)", () => {
    expect(calibrationSlope([])).toBeNaN();
    expect(calibrationSlope([{ p: 0.6, y: 1 }])).toBeNaN();
    expect(calibrationSlope(pairsAt(0.3, 4, 4))).toBeNaN();
    expect(calibrationSlope(pairsAt(0.3, 4, 2))).toBeNaN();
  });

  it("separação completa → NaN (MLE diverge)", () => {
    const pairs = [...pairsAt(0.3, 3, 0), ...pairsAt(0.7, 3, 3)];
    expect(calibrationSlope(pairs)).toBeNaN();
  });
});

describe("bootstrapMeanCi", () => {
  it("< 2 valores → null", () => {
    expect(bootstrapMeanCi([])).toBeNull();
    expect(bootstrapMeanCi([1])).toBeNull();
  });

  it("valores constantes → IC degenerado no próprio valor", () => {
    expect(bootstrapMeanCi([2, 2, 2, 2])).toEqual({ lo: 2, hi: 2 });
  });

  it("IC contém a média e é determinístico pela semente", () => {
    const xs = Array.from({ length: 100 }, (_, i) => (i % 10) - 4.5);
    const ci = bootstrapMeanCi(xs)!;
    expect(ci.lo).toBeLessThan(0);
    expect(ci.hi).toBeGreaterThan(0);
    expect(bootstrapMeanCi(xs)).toEqual(ci);
  });
});
