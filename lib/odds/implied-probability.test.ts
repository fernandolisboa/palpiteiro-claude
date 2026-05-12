import { describe, it, expect } from "vitest";

import { computeImpliedProbabilities } from "@/lib/odds/implied-probability";

describe("computeImpliedProbabilities", () => {
  it("handles a balanced market (1.90 / 1.95)", () => {
    // Hand-computed values:
    //   1/1.90 = 0.526316; 1/1.95 = 0.512821; sum = 1.039136
    //   overround = 0.039136; over_prob = 0.506494; under_prob = 0.493506
    const { overProb, underProb, overround } = computeImpliedProbabilities(
      1.9,
      1.95,
    );
    expect(overround).toBeCloseTo(0.039136, 6);
    expect(overProb).toBeCloseTo(0.506494, 6);
    expect(underProb).toBeCloseTo(0.493506, 6);
    expect(overProb + underProb).toBeCloseTo(1, 10);
  });

  it("handles a skewed market (2.00 / 1.80)", () => {
    // 1/2.00 = 0.5; 1/1.80 = 0.555556; sum = 1.055556
    // overround = 0.055556; over_prob = 0.473684; under_prob = 0.526316
    const { overProb, underProb, overround } = computeImpliedProbabilities(
      2.0,
      1.8,
    );
    expect(overround).toBeCloseTo(0.055556, 6);
    expect(overProb).toBeCloseTo(0.473684, 6);
    expect(underProb).toBeCloseTo(0.526316, 6);
    expect(overProb + underProb).toBeCloseTo(1, 10);
  });

  it("yields zero overround for a theoretically fair market (2.00 / 2.00)", () => {
    const { overProb, underProb, overround } = computeImpliedProbabilities(
      2.0,
      2.0,
    );
    expect(overround).toBeCloseTo(0, 10);
    expect(overProb).toBeCloseTo(0.5, 10);
    expect(underProb).toBeCloseTo(0.5, 10);
  });

  it("matches raw probabilities relative ordering", () => {
    // Under has lower odd → higher normalized probability.
    const { overProb, underProb } = computeImpliedProbabilities(2.5, 1.55);
    expect(underProb).toBeGreaterThan(overProb);
  });

  it("throws on odds <= 1", () => {
    expect(() => computeImpliedProbabilities(1, 1.95)).toThrow();
    expect(() => computeImpliedProbabilities(1.9, 1)).toThrow();
    expect(() => computeImpliedProbabilities(0.5, 1.95)).toThrow();
  });

  it("throws on non-finite odds", () => {
    expect(() => computeImpliedProbabilities(NaN, 1.95)).toThrow();
    expect(() => computeImpliedProbabilities(1.9, Infinity)).toThrow();
    expect(() => computeImpliedProbabilities(-1, 1.95)).toThrow();
  });
});
