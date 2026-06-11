import { describe, it, expect } from "vitest";

import { computeEvPerUnit } from "@/lib/odds/scenario";

describe("computeEvPerUnit", () => {
  it("computes positive EV for a favorable price (58% @ 1.92)", () => {
    // Hand-computed: 0.58 × 1.92 = 1.1136 → EV = +0.1136 por unidade.
    expect(computeEvPerUnit(58, 1.92)).toBeCloseTo(0.1136, 6);
  });

  it("computes negative EV for an unfavorable price (42% @ 1.94)", () => {
    // 0.42 × 1.94 = 0.8148 → EV = −0.1852 por unidade.
    expect(computeEvPerUnit(42, 1.94)).toBeCloseTo(-0.1852, 6);
  });

  it("yields zero EV at the exact break-even (50% @ 2.00)", () => {
    expect(computeEvPerUnit(50, 2.0)).toBeCloseTo(0, 10);
  });

  it("throws on odds <= 1", () => {
    expect(() => computeEvPerUnit(58, 1)).toThrow();
    expect(() => computeEvPerUnit(58, 0.5)).toThrow();
    expect(() => computeEvPerUnit(58, -1)).toThrow();
  });

  it("throws on non-finite odds", () => {
    expect(() => computeEvPerUnit(58, NaN)).toThrow();
    expect(() => computeEvPerUnit(58, Infinity)).toThrow();
  });
});
