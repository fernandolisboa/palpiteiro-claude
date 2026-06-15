import { describe, it, expect } from "vitest";

import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";

// over/under (N=2) é só o caso particular do core N-ário — o wrapper binário
// `computeImpliedProbabilities` saiu na Fase 5; os callers passam [over, under].
describe("computeMarketImpliedProbabilities (N=2 over/under)", () => {
  it("handles a balanced market (1.90 / 1.95)", () => {
    // Hand-computed values:
    //   1/1.90 = 0.526316; 1/1.95 = 0.512821; sum = 1.039136
    //   overround = 0.039136; over_prob = 0.506494; under_prob = 0.493506
    const {
      probs: [overProb, underProb],
      overround,
    } = computeMarketImpliedProbabilities([1.9, 1.95]);
    expect(overround).toBeCloseTo(0.039136, 6);
    expect(overProb).toBeCloseTo(0.506494, 6);
    expect(underProb).toBeCloseTo(0.493506, 6);
    expect(overProb + underProb).toBeCloseTo(1, 10);
  });

  it("handles a skewed market (2.00 / 1.80)", () => {
    // 1/2.00 = 0.5; 1/1.80 = 0.555556; sum = 1.055556
    // overround = 0.055556; over_prob = 0.473684; under_prob = 0.526316
    const {
      probs: [overProb, underProb],
      overround,
    } = computeMarketImpliedProbabilities([2.0, 1.8]);
    expect(overround).toBeCloseTo(0.055556, 6);
    expect(overProb).toBeCloseTo(0.473684, 6);
    expect(underProb).toBeCloseTo(0.526316, 6);
    expect(overProb + underProb).toBeCloseTo(1, 10);
  });

  it("yields zero overround for a theoretically fair market (2.00 / 2.00)", () => {
    const {
      probs: [overProb, underProb],
      overround,
    } = computeMarketImpliedProbabilities([2.0, 2.0]);
    expect(overround).toBeCloseTo(0, 10);
    expect(overProb).toBeCloseTo(0.5, 10);
    expect(underProb).toBeCloseTo(0.5, 10);
  });

  it("matches raw probabilities relative ordering", () => {
    // Under has lower odd → higher normalized probability.
    const {
      probs: [overProb, underProb],
    } = computeMarketImpliedProbabilities([2.5, 1.55]);
    expect(underProb).toBeGreaterThan(overProb);
  });
});

describe("computeMarketImpliedProbabilities", () => {
  it("normalizes an N=3 market (1X2 odds 2.10 / 3.40 / 3.60)", () => {
    // Full-precision goldens (ADR 0018 N=3 example), precision 6:
    //   raw = 1/2.10, 1/3.40, 1/3.60; Σraw = 1.048085901; overround = 0.048085901
    //   probs×100 = 45.4342984 / 28.0623608 / 26.5033408
    const { probs, overround } = computeMarketImpliedProbabilities([
      2.1, 3.4, 3.6,
    ]);
    expect(overround).toBeCloseTo(0.0480859, 6);
    expect(probs[0] * 100).toBeCloseTo(45.4342984, 6);
    expect(probs[1] * 100).toBeCloseTo(28.0623608, 6);
    expect(probs[2] * 100).toBeCloseTo(26.5033408, 6);
    expect(probs[0] + probs[1] + probs[2]).toBeCloseTo(1, 10);
  });

  it("produces the N=2 over/under split (1.90 / 1.95)", () => {
    const core = computeMarketImpliedProbabilities([1.9, 1.95]);
    expect(core.overround).toBeCloseTo(0.039136, 6);
    expect(core.probs[0]).toBeCloseTo(0.506494, 6);
    expect(core.probs[1]).toBeCloseTo(0.493506, 6);
    expect(core.probs[0] + core.probs[1]).toBeCloseTo(1, 10);
  });

  it("throws on an empty market", () => {
    expect(() => computeMarketImpliedProbabilities([])).toThrow();
  });

  it("throws on odds <= 1", () => {
    expect(() => computeMarketImpliedProbabilities([2.1, 1, 3.6])).toThrow();
    expect(() => computeMarketImpliedProbabilities([0.5])).toThrow();
  });

  it("throws on non-finite odds", () => {
    expect(() => computeMarketImpliedProbabilities([2.1, NaN])).toThrow();
    expect(() =>
      computeMarketImpliedProbabilities([Infinity, 3.4, 3.6]),
    ).toThrow();
  });
});
