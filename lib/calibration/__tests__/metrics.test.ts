import { describe, expect, it } from "vitest";

import {
  brierScore,
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
    expect(s.bins).toHaveLength(10);
  });
});
