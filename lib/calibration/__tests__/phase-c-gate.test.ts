import { describe, expect, it } from "vitest";

import { evaluateKellyGate } from "@/lib/calibration/phase-c-gate";
import type { OverUnderCalibrationRow } from "@/lib/db/queries/calibration";

const row = (
  modelPOver: number,
  marketPOver: number,
  overHappened: 0 | 1,
): OverUnderCalibrationRow => ({
  promptVersion: "v",
  modelPOver,
  marketPOver,
  overHappened,
  isBet: false,
  engine: "llm",
  engineConfig: null,
});

// Modelo e mercado idênticos → skill 0 em toda análise → IC [0, 0] alcança 0.
const tiedRows = Array.from({ length: 40 }, (_, i) =>
  row(0.5, 0.5, (i % 2) as 0 | 1),
);
// CLV positivo com pouca dispersão: 1.0pp ± 0.5.
const goodClv = (n: number) =>
  Array.from({ length: n }, (_, i) => (i % 2 ? 1.5 : 0.5));

describe("evaluateKellyGate", () => {
  it("vazio → não pronto, sem IC, as três checagens falham", () => {
    const g = evaluateKellyGate({ clvNoVigDeltasPp: [], calibrationRows: [] });
    expect(g.ready).toBe(false);
    expect(g.clvBets).toBe(0);
    expect(g.clvCi).toBeNull();
    expect(g.skillCi).toBeNull();
    expect(g.checks.every((c) => !c.pass)).toBe(true);
  });

  it("50 apostas com CLV positivo e modelo empatado com o mercado → pronto", () => {
    const g = evaluateKellyGate({
      clvNoVigDeltasPp: goodClv(50),
      calibrationRows: tiedRows,
    });
    expect(g.clvBets).toBe(50);
    expect(g.clvMeanPp).toBeCloseTo(1, 9);
    expect(g.clvCi!.lo).toBeGreaterThan(0);
    expect(g.skillMean).toBeCloseTo(0, 12);
    expect(g.ready).toBe(true);
  });

  it("49 apostas → falha só a amostra", () => {
    const g = evaluateKellyGate({
      clvNoVigDeltasPp: goodClv(49),
      calibrationRows: tiedRows,
    });
    expect(g.ready).toBe(false);
    expect(g.checks.map((c) => [c.key, c.pass])).toEqual([
      ["clv_sample", false],
      ["clv_mean", true],
      ["skill_guard", true],
    ]);
  });

  it("CLV médio positivo mas ruidoso (IC cruza 0) → falha o CLV", () => {
    const noisy = Array.from({ length: 60 }, (_, i) => (i % 2 ? 6 : -5));
    const g = evaluateKellyGate({
      clvNoVigDeltasPp: noisy,
      calibrationRows: tiedRows,
    });
    expect(g.clvMeanPp).toBeGreaterThan(0);
    expect(g.clvCi!.lo).toBeLessThan(0);
    expect(g.checks.find((c) => c.key === "clv_mean")!.pass).toBe(false);
  });

  it("mercado bate o modelo com folga → falha a guarda", () => {
    // Mercado acerta com convicção, modelo fica em 0.5: skill negativo em toda análise.
    const rows = Array.from({ length: 40 }, (_, i) => {
      const y = (i % 2) as 0 | 1;
      return row(0.5, y ? 0.8 : 0.2, y);
    });
    const g = evaluateKellyGate({
      clvNoVigDeltasPp: goodClv(60),
      calibrationRows: rows,
    });
    expect(g.skillCi!.hi).toBeLessThan(0);
    expect(g.checks.find((c) => c.key === "skill_guard")!.pass).toBe(false);
    expect(g.ready).toBe(false);
  });

  it("é determinístico (mesmo dado → mesmo IC)", () => {
    const input = {
      clvNoVigDeltasPp: [3, -1, 2, 0.5, -2, 4, 1],
      calibrationRows: tiedRows,
    };
    expect(evaluateKellyGate(input).clvCi).toEqual(
      evaluateKellyGate(input).clvCi,
    );
  });
});
