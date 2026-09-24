import { describe, expect, it } from "vitest";

import { evaluatePhaseCGate } from "@/lib/calibration/phase-c-gate";
import type { OverUnderCalibrationRow } from "@/lib/db/queries/calibration";

const row = (
  modelPOver: number,
  overHappened: 0 | 1,
  isBet = true,
  marketPOver = 0.5,
): OverUnderCalibrationRow => ({
  promptVersion: "v",
  modelPOver,
  marketPOver,
  overHappened,
  isBet,
});

// n cópias de um bloco bem calibrado: p=0.2 com 1/5 over, p=0.8 com 4/5 over
// (slope exato 1, Brier 0.16 < mercado 0.5 → 0.25).
function calibratedBets(blocks: number): OverUnderCalibrationRow[] {
  const block = [
    row(0.2, 1),
    ...Array.from({ length: 4 }, () => row(0.2, 0)),
    row(0.8, 0),
    ...Array.from({ length: 4 }, () => row(0.8, 1)),
  ];
  return Array.from({ length: blocks }, () => block).flat();
}

describe("evaluatePhaseCGate", () => {
  it("vazio → não pronto, slope NaN, as três checagens falham", () => {
    const g = evaluatePhaseCGate([]);
    expect(g.ready).toBe(false);
    expect(g.settledBets).toBe(0);
    expect(g.slope).toBeNaN();
    expect(g.checks.every((c) => !c.pass)).toBe(true);
  });

  it("150 apostas calibradas e melhores que o mercado → pronto", () => {
    const g = evaluatePhaseCGate(calibratedBets(15));
    expect(g.settledBets).toBe(150);
    expect(g.slope).toBeCloseTo(1, 6);
    expect(g.modelBrier).toBeLessThan(g.marketBrier);
    expect(g.ready).toBe(true);
  });

  it("149 apostas → falha só a amostra", () => {
    const g = evaluatePhaseCGate(calibratedBets(15).slice(1));
    expect(g.ready).toBe(false);
    expect(g.checks.find((c) => c.key === "sample")!.pass).toBe(false);
  });

  it("passes não contam pro gate", () => {
    const passes = calibratedBets(15).map((r) => ({ ...r, isBet: false }));
    const g = evaluatePhaseCGate([...calibratedBets(1), ...passes]);
    expect(g.settledBets).toBe(10);
    expect(g.ready).toBe(false);
  });

  it("overconfident (slope 0.5) → falha o slope", () => {
    const block = [
      ...Array.from({ length: 2 }, () => row(1 / 17, 1)),
      ...Array.from({ length: 8 }, () => row(1 / 17, 0)),
      ...Array.from({ length: 8 }, () => row(16 / 17, 1)),
      ...Array.from({ length: 2 }, () => row(16 / 17, 0)),
    ];
    const g = evaluatePhaseCGate(Array.from({ length: 8 }, () => block).flat());
    expect(g.settledBets).toBe(160);
    expect(g.slope).toBeCloseTo(0.5, 6);
    expect(g.checks.find((c) => c.key === "slope")!.pass).toBe(false);
    expect(g.ready).toBe(false);
  });

  it("mercado com Brier menor → falha o brier", () => {
    const rows = calibratedBets(15).map((r) => ({
      ...r,
      marketPOver: r.overHappened ? 0.9 : 0.1,
    }));
    const g = evaluatePhaseCGate(rows);
    expect(g.checks.find((c) => c.key === "brier")!.pass).toBe(false);
    expect(g.ready).toBe(false);
  });
});
