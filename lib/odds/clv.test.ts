import { describe, expect, it } from "vitest";

import {
  clvNoVigDeltaPp,
  clvOddsRatioPct,
  computeClv,
  noVigProbPct,
} from "@/lib/odds/clv";
import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";

describe("clvOddsRatioPct — razão de odds (+ = bateu o fechamento)", () => {
  it("odd de entrada MAIOR que o fechamento → CLV positivo", () => {
    expect(clvOddsRatioPct(2.1, 1.95)).toBeCloseTo((2.1 / 1.95 - 1) * 100, 6);
    expect(clvOddsRatioPct(2.1, 1.95)).toBeGreaterThan(0);
  });

  it("odd de entrada MENOR que o fechamento → CLV negativo", () => {
    expect(clvOddsRatioPct(1.95, 2.1)).toBeLessThan(0);
  });

  it("entrada == fechamento → 0", () => {
    expect(clvOddsRatioPct(2.0, 2.0)).toBe(0);
  });

  it("aceita string (numeric do Drizzle) só via number; null/inválido → null", () => {
    expect(clvOddsRatioPct(null, 1.95)).toBeNull();
    expect(clvOddsRatioPct(2.1, null)).toBeNull();
    expect(clvOddsRatioPct(undefined, undefined)).toBeNull();
    // odd ≤ 1 é inválida (espelha assertValidOdd) → null, nunca throw/divisão ruim.
    expect(clvOddsRatioPct(1.0, 1.95)).toBeNull();
    expect(clvOddsRatioPct(2.1, 1.0)).toBeNull();
    expect(clvOddsRatioPct(Number.NaN, 1.95)).toBeNull();
  });
});

describe("noVigProbPct — prob no-vig de uma seleção", () => {
  it("consistente com computeMarketImpliedProbabilities (de-vig do mercado)", () => {
    // Mercado over/under [over 2.0, under 1.95]: a prob no-vig do 'over' tem que casar
    // com probs[0] do core canônico, alimentado pelo overroundPct armazenado.
    const { probs, overround } = computeMarketImpliedProbabilities([2.0, 1.95]);
    const overroundPct = overround * 100; // como select-bookmaker grava
    expect(noVigProbPct(2.0, overroundPct, 1)).toBeCloseTo(probs[0] * 100, 6);
  });

  it("impliedSumTarget escala (dupla chance = 2 → mesma escala de impliedProbPct)", () => {
    const base = noVigProbPct(1.5, 100, 1) ?? 0;
    expect(noVigProbPct(1.5, 100, 2)).toBeCloseTo(base * 2, 6);
  });

  it("default impliedSumTarget = 1 (null/undefined)", () => {
    expect(noVigProbPct(2.0, 5, undefined)).toBe(noVigProbPct(2.0, 5, 1));
  });

  it("inválidos → null", () => {
    expect(noVigProbPct(null, 5, 1)).toBeNull();
    expect(noVigProbPct(2.0, null, 1)).toBeNull();
    expect(noVigProbPct(1.0, 5, 1)).toBeNull(); // odd ≤ 1
  });
});

describe("clvNoVigDeltaPp — delta de prob no-vig (+ = bateu o fechamento)", () => {
  it("prob de fechamento MAIOR que a implícita na recomendação → positivo", () => {
    const closeProb = noVigProbPct(2.0, 5, 1) ?? 0; // ~47.6%
    const recImplied = closeProb - 3;
    expect(clvNoVigDeltaPp(recImplied, 2.0, 5, 1)).toBeCloseTo(3, 6);
    expect(clvNoVigDeltaPp(recImplied, 2.0, 5, 1)!).toBeGreaterThan(0);
  });

  it("prob de fechamento MENOR que a implícita → negativo", () => {
    const closeProb = noVigProbPct(2.0, 5, 1) ?? 0;
    expect(clvNoVigDeltaPp(closeProb + 5, 2.0, 5, 1)).toBeLessThan(0);
  });

  it("null se faltar recImpliedPct OU o fechamento", () => {
    expect(clvNoVigDeltaPp(null, 2.0, 5, 1)).toBeNull();
    expect(clvNoVigDeltaPp(45, null, 5, 1)).toBeNull();
    expect(clvNoVigDeltaPp(45, 2.0, null, 1)).toBeNull();
  });
});

describe("computeClv — as duas métricas, nulls independentes", () => {
  it("razão-de-odds presente, no-vig null quando falta recImpliedPct", () => {
    const r = computeClv({
      oddRec: 2.1,
      oddClose: 1.95,
      overroundPctClose: 5,
      recImpliedPct: null, // sem impliedProbPct (row antiga)
      impliedSumTarget: 1,
    });
    expect(r.oddsRatioPct).not.toBeNull();
    expect(r.noVigDeltaPp).toBeNull();
  });

  it("ambos null sem fechamento", () => {
    const r = computeClv({
      oddRec: 2.1,
      oddClose: null,
      overroundPctClose: null,
      recImpliedPct: 50,
      impliedSumTarget: 1,
    });
    expect(r.oddsRatioPct).toBeNull();
    expect(r.noVigDeltaPp).toBeNull();
  });
});
