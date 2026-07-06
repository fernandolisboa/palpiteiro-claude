import { describe, expect, it } from "vitest";

import { deriveCalibration } from "@/lib/calibration/derive";
import type { OverUnderCalibrationRow } from "@/lib/db/queries/calibration";

const row = (
  promptVersion: string,
  modelPOver: number,
  marketPOver: number,
  overHappened: 0 | 1,
): OverUnderCalibrationRow => ({
  promptVersion,
  modelPOver,
  marketPOver,
  overHappened,
});

describe("deriveCalibration", () => {
  it("vazio → overall null, byVersion vazio", () => {
    const { overall, byVersion } = deriveCalibration([]);
    expect(overall).toBeNull();
    expect(byVersion).toHaveLength(0);
  });

  it("agrupa por versão + overall agregado", () => {
    const rows = [
      row("over_under_v3.2", 0.6, 0.55, 1),
      row("over_under_v3.2", 0.4, 0.5, 0),
      row("over_under_v3.1", 0.5, 0.5, 1),
    ];
    const { overall, byVersion } = deriveCalibration(rows);
    expect(overall?.n).toBe(3);
    expect(byVersion.map((g) => g.promptVersion)).toEqual([
      "over_under_v3.2", // n=2 primeiro
      "over_under_v3.1", // n=1
    ]);
    expect(byVersion[0].n).toBe(2);
  });

  it("skill > 0 quando o modelo bate o mercado (log-loss menor)", () => {
    // modelo perfeito (p bate y), mercado no fio da navalha (0.5) → skill LL > 0.
    const rows = [
      row("v", 0.99, 0.5, 1),
      row("v", 0.01, 0.5, 0),
    ];
    const { overall } = deriveCalibration(rows);
    expect(overall!.model.logLoss).toBeLessThan(overall!.market.logLoss);
    expect(overall!.logLossSkill).toBeGreaterThan(0);
    expect(overall!.brierSkill).toBeGreaterThan(0);
  });

  it("skill < 0 quando o mercado bate o modelo", () => {
    const rows = [
      row("v", 0.5, 0.99, 1),
      row("v", 0.5, 0.01, 0),
    ];
    const { overall } = deriveCalibration(rows);
    expect(overall!.logLossSkill).toBeLessThan(0);
  });
});
