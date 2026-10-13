import { describe, expect, it } from "vitest";

import { scorelineMatrix } from "@/lib/quant/scoreline-model";
import {
  MAX_TOTAL_FRACTION,
  outcomesFromScoreMatrix,
  simultaneousKellyFractions,
} from "@/lib/quant/simultaneous-kelly";

const binary = (p: number) => [
  { p, wins: [true] },
  { p: 1 - p, wins: [false] },
];

describe("simultaneousKellyFractions", () => {
  it("uma aposta só = Kelly clássico (p·o − 1)/(o − 1)", () => {
    const [f] = simultaneousKellyFractions(binary(0.55), [2.1])!;
    expect(f).toBeCloseTo((0.55 * 2.1 - 1) / (2.1 - 1), 6);
  });

  it("aposta sem valor fica em zero", () => {
    expect(simultaneousKellyFractions(binary(0.4), [2.0])).toEqual([0]);
  });

  it("duas apostas que sempre ganham juntas não somam dois Kelly", () => {
    // Mesmo evento duplicado: o ótimo conjunto expõe o mesmo que UMA aposta.
    const outcomes = [
      { p: 0.55, wins: [true, true] },
      { p: 0.45, wins: [false, false] },
    ];
    const f = simultaneousKellyFractions(outcomes, [2.1, 2.1])!;
    const single = (0.55 * 2.1 - 1) / (2.1 - 1);
    expect(f[0] + f[1]).toBeCloseTo(single, 4);
  });

  it("apostas independentes ficam perto do Kelly individual de cada uma", () => {
    // Dois eventos independentes com p=0.55 @2.1.
    const p = 0.55;
    const outcomes = [
      { p: p * p, wins: [true, true] },
      { p: p * (1 - p), wins: [true, false] },
      { p: (1 - p) * p, wins: [false, true] },
      { p: (1 - p) * (1 - p), wins: [false, false] },
    ];
    const f = simultaneousKellyFractions(outcomes, [2.1, 2.1])!;
    const single = (p * 2.1 - 1) / (2.1 - 1);
    // Independentes: levemente abaixo do individual (o log pune a soma), nunca acima.
    expect(f[0]).toBeLessThanOrEqual(single + 1e-6);
    expect(f[0]).toBeGreaterThan(single * 0.85);
    expect(f[0]).toBeCloseTo(f[1], 6);
  });

  it("nunca passa do teto total", () => {
    const outcomes = [
      { p: 0.97, wins: [true, false] },
      { p: 0.03, wins: [false, true] },
    ];
    const f = simultaneousKellyFractions(outcomes, [5, 5])!;
    expect(f[0] + f[1]).toBeLessThanOrEqual(MAX_TOTAL_FRACTION + 1e-9);
  });

  it("entrada inválida → null", () => {
    expect(simultaneousKellyFractions(binary(0.5), [1])).toBeNull();
    expect(
      simultaneousKellyFractions([{ p: 1, wins: [true, true] }], [2]),
    ).toBeNull();
  });
});

describe("outcomesFromScoreMatrix", () => {
  it("agrupa a matriz pelo padrão de vitórias e preserva a massa", () => {
    const m = scorelineMatrix(1.6, 1.1);
    const outcomes = outcomesFromScoreMatrix(m.cells, [
      (h, a) => h > a,
      (h, a) => h + a > 2.5,
    ]);
    expect(outcomes.length).toBeLessThanOrEqual(4);
    const total = outcomes.reduce((s, o) => s + o.p, 0);
    expect(total).toBeCloseTo(1, 9);
  });
});
