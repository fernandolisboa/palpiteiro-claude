import { describe, it, expect } from "vitest";

import { formatEdge } from "@/lib/format";
import { computeImpliedProbabilities } from "@/lib/odds/implied-probability";
import {
  computeBreakEvenProbPct,
  computeEvPerUnit,
  computeModelBreakEvenOdd,
  computeScenarios,
} from "@/lib/odds/scenario";

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

describe("computeBreakEvenProbPct", () => {
  it("returns the raw 1/odd break-even (NOT the normalized implied)", () => {
    expect(computeBreakEvenProbPct(2.0)).toBe(50);
    // 100/1.92 = 52.083… — acima da implied normalizada do mesmo lado num
    // mercado com overround; é o conceito certo pro break-even (odd crua paga).
    expect(computeBreakEvenProbPct(1.92)).toBeCloseTo(52.0833, 4);
  });

  it("throws on odds <= 1 or non-finite", () => {
    expect(() => computeBreakEvenProbPct(1)).toThrow();
    expect(() => computeBreakEvenProbPct(0.5)).toThrow();
    expect(() => computeBreakEvenProbPct(NaN)).toThrow();
    expect(() => computeBreakEvenProbPct(Infinity)).toThrow();
  });
});

describe("computeModelBreakEvenOdd", () => {
  it("returns 100/modelProbPct (odd mínima pra sair do zero SE o modelo estiver certo)", () => {
    expect(computeModelBreakEvenOdd(42)).toBeCloseTo(2.381, 3);
    expect(computeModelBreakEvenOdd(50)).toBe(2);
    expect(computeModelBreakEvenOdd(100)).toBe(1);
  });

  it("throws on probabilities outside (0, 100] or non-finite", () => {
    expect(() => computeModelBreakEvenOdd(0)).toThrow();
    expect(() => computeModelBreakEvenOdd(-5)).toThrow();
    expect(() => computeModelBreakEvenOdd(100.1)).toThrow();
    expect(() => computeModelBreakEvenOdd(NaN)).toThrow();
  });
});

describe("computeScenarios", () => {
  it("over novo: lado recomendado usa SEMPRE os valores salvos, mesmo quando divergem do recomputado", () => {
    // Caso de precedência: edge salvo 7.35 (.toFixed(2)) vs recomputado das
    // odds 7.3505… — na exibição divergem ("+7.3" vs "+7.4"). O salvo VENCE.
    const result = computeScenarios({
      recommendation: "over",
      confidencePct: 58,
      oddAtRecommendation: 1.9,
      impliedProbPct: 50.65,
      edgePct: 7.35,
      overOdd: 1.9,
      underOdd: 1.95,
    });

    expect(result.recommended).toBe("over");
    // Salvos passam intactos — nunca recomputados.
    expect(result.over.odd).toBe(1.9);
    expect(result.over.impliedProbPct).toBe(50.65);
    expect(result.over.edgePct).toBe(7.35);
    // O recomputado de fato divergiria na exibição — pina que a divergência
    // existe e que o salvo é o exibido.
    const recomputedEdge =
      58 - computeImpliedProbabilities(1.9, 1.95).overProb * 100;
    expect(formatEdge(recomputedEdge)).toBe("+7.4");
    expect(formatEdge(result.over.edgePct)).toBe("+7.3");
    // Derivados do lado recomendado.
    expect(result.over.modelProbPct).toBe(58);
    expect(result.over.evPerUnit).toBeCloseTo(0.102, 6);
    expect(result.over.breakEvenProbPct).toBeCloseTo(52.6316, 4);
    expect(result.over.modelBreakEvenOdd).toBeCloseTo(1.7241, 4);
    // Lado oposto: derivado dos salvos (100 − x, −edge) + par congelado.
    expect(result.under.modelProbPct).toBe(42);
    expect(result.under.impliedProbPct).toBeCloseTo(49.35, 10);
    expect(result.under.edgePct).toBe(-7.35);
    expect(result.under.odd).toBe(1.95);
    expect(result.under.evPerUnit).toBeCloseTo(-0.181, 6);
    expect(result.under.breakEvenProbPct).toBeCloseTo(51.2821, 4);
    expect(result.under.modelBreakEvenOdd).toBeCloseTo(2.381, 3);
  });

  it("under novo: espelha a precedência com o under recomendado", () => {
    const result = computeScenarios({
      recommendation: "under",
      confidencePct: 56,
      oddAtRecommendation: 1.85,
      impliedProbPct: 49.3,
      edgePct: 6.7,
      overOdd: 1.98,
      underOdd: 1.85,
    });

    expect(result.recommended).toBe("under");
    expect(result.under.modelProbPct).toBe(56);
    expect(result.under.impliedProbPct).toBe(49.3);
    expect(result.under.edgePct).toBe(6.7);
    expect(result.under.odd).toBe(1.85);
    expect(result.under.evPerUnit).toBeCloseTo(0.036, 6);
    expect(result.over.modelProbPct).toBe(44);
    expect(result.over.impliedProbPct).toBeCloseTo(50.7, 10);
    expect(result.over.edgePct).toBe(-6.7);
    expect(result.over.odd).toBe(1.98);
    expect(result.over.evPerUnit).toBeCloseTo(-0.1288, 6);
    expect(result.over.modelBreakEvenOdd).toBeCloseTo(2.2727, 4);
  });

  it("pass novo: implied recomputada do par congelado; edge < 5pp com EV positivo é estado legítimo", () => {
    // conf 53 @ 1.92/1.92 → edge over +3pp (abaixo do threshold → pass), mas
    // EV over = 0.53 × 1.92 − 1 = +0.0176 (ADR 0012, decisão 7).
    const result = computeScenarios({
      recommendation: "pass",
      confidencePct: 53, // convenção: prob do OVER
      oddAtRecommendation: null,
      impliedProbPct: null,
      edgePct: null,
      overOdd: 1.92,
      underOdd: 1.92,
    });

    expect(result.recommended).toBeNull();
    expect(result.over.modelProbPct).toBe(53);
    expect(result.under.modelProbPct).toBe(47);
    // Odds iguais → implied normalizada 50/50 (via computeImpliedProbabilities).
    expect(result.over.impliedProbPct).toBeCloseTo(50, 10);
    expect(result.under.impliedProbPct).toBeCloseTo(50, 10);
    expect(result.over.edgePct).toBeCloseTo(3, 10);
    expect(result.under.edgePct).toBeCloseTo(-3, 10);
    expect(result.over.odd).toBe(1.92);
    expect(result.under.odd).toBe(1.92);
    expect(result.over.evPerUnit).toBeCloseTo(0.018, 2);
    expect(result.under.evPerUnit).toBeCloseTo(-0.0976, 4);
    expect(result.over.modelBreakEvenOdd).toBeCloseTo(1.8868, 4);
    expect(result.under.modelBreakEvenOdd).toBeCloseTo(2.1277, 4);
  });

  it("histórica não-pass (par congelado null): recomendado completo via salvos; oposto sem odd/EV/break-even", () => {
    const result = computeScenarios({
      recommendation: "over",
      confidencePct: 58,
      oddAtRecommendation: 1.92,
      impliedProbPct: 50.7,
      edgePct: 7.3,
      overOdd: null,
      underOdd: null,
    });

    expect(result.recommended).toBe("over");
    // Lado recomendado completo (odd salva + derivados dela).
    expect(result.over.odd).toBe(1.92);
    expect(result.over.impliedProbPct).toBe(50.7);
    expect(result.over.edgePct).toBe(7.3);
    expect(result.over.evPerUnit).toBeCloseTo(0.1136, 6);
    expect(result.over.breakEvenProbPct).toBeCloseTo(52.0833, 4);
    // Oposto: probs/edge derivados dos salvos; resto null.
    expect(result.under.modelProbPct).toBe(42);
    expect(result.under.impliedProbPct).toBeCloseTo(49.3, 10);
    expect(result.under.edgePct).toBe(-7.3);
    expect(result.under.odd).toBeNull();
    expect(result.under.evPerUnit).toBeNull();
    expect(result.under.breakEvenProbPct).toBeNull();
    // modelBreakEvenOdd sempre derivável, mesmo sem odds.
    expect(result.under.modelBreakEvenOdd).toBeCloseTo(2.381, 3);
  });

  it("histórica pass (tudo null): só prob do modelo + odd de equilíbrio do modelo", () => {
    const result = computeScenarios({
      recommendation: "pass",
      confidencePct: 51,
      oddAtRecommendation: null,
      impliedProbPct: null,
      edgePct: null,
      overOdd: null,
      underOdd: null,
    });

    expect(result.recommended).toBeNull();
    for (const side of [result.over, result.under]) {
      expect(side.impliedProbPct).toBeNull();
      expect(side.edgePct).toBeNull();
      expect(side.odd).toBeNull();
      expect(side.evPerUnit).toBeNull();
      expect(side.breakEvenProbPct).toBeNull();
    }
    expect(result.over.modelProbPct).toBe(51);
    expect(result.under.modelProbPct).toBe(49);
    expect(result.over.modelBreakEvenOdd).toBeCloseTo(1.9608, 4);
    expect(result.under.modelBreakEvenOdd).toBeCloseTo(2.0408, 4);
  });

  it("invariantes: probs do modelo somam 100; edge do recomendado === edgePct salvo de input", () => {
    const inputs = [
      {
        recommendation: "over" as const,
        confidencePct: 58,
        oddAtRecommendation: 1.9,
        impliedProbPct: 50.65,
        edgePct: 7.35,
        overOdd: 1.9,
        underOdd: 1.95,
      },
      {
        recommendation: "under" as const,
        confidencePct: 56,
        oddAtRecommendation: 1.85,
        impliedProbPct: 49.3,
        edgePct: 6.7,
        overOdd: null,
        underOdd: null,
      },
    ];
    for (const input of inputs) {
      const result = computeScenarios(input);
      expect(result.over.modelProbPct + result.under.modelProbPct).toBe(100);
      const rec = result.recommended === "over" ? result.over : result.under;
      expect(rec.edgePct).toBe(input.edgePct);
    }
  });

  it("guarda: confidencePct fora de (0, 100) ou não-finita lança", () => {
    const base = {
      recommendation: "over" as const,
      oddAtRecommendation: 1.9,
      impliedProbPct: 50.65,
      edgePct: 7.35,
      overOdd: 1.9,
      underOdd: 1.95,
    };
    expect(() => computeScenarios({ ...base, confidencePct: 0 })).toThrow();
    expect(() => computeScenarios({ ...base, confidencePct: 100 })).toThrow();
    expect(() => computeScenarios({ ...base, confidencePct: NaN })).toThrow();
  });
});
