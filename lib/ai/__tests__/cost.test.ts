import { describe, expect, it } from "vitest";

import { calculateCost, calculateJudgmentCost } from "@/lib/ai/cost";
import { MODEL_REGISTRY, type AIModelId } from "@/lib/ai/models";

describe("calculateCost — derived from MODEL_REGISTRY", () => {
  // SENTINELA anti-NaN (ADR 0027 #231): costUsd é numeric(10,6) NOT NULL — um modelo
  // SEM pricing no registry faria calculateCost devolver NaN e o INSERT falhar DEPOIS
  // de gastar. Trava: TODO id do registry produz custo FINITO e POSITIVO. Pega de
  // imediato uma entrada nova (ex.: o gpt-5-mini do #231) sem pricing.
  it("custo é finito e > 0 para TODO id do registry (guarda de NaN/pricing-ausente)", () => {
    for (const id of Object.keys(MODEL_REGISTRY) as AIModelId[]) {
      const cost = calculateCost({
        model: id,
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });
      expect(Number.isFinite(cost), `custo não-finito para ${id}`).toBe(true);
      expect(cost, `custo não-positivo para ${id}`).toBeGreaterThan(0);
    }
  });

  it("Opus 5.5: $4 in + $20 out per 1M → 24 for 1M+1M", () => {
    expect(
      calculateCost({
        model: "claude-opus-5-5",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(24);
  });

  it("Sonnet 5.5: $2 in + $10 out per 1M → 12 for 1M+1M", () => {
    expect(
      calculateCost({
        model: "claude-sonnet-5-5",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(12);
  });

  it("Opus e Sonnet 5.5 não têm tarifa de prompt longo: preço linear acima de 100K", () => {
    expect(MODEL_REGISTRY["claude-opus-5-5"].longPromptPricing).toBeUndefined();
    expect(MODEL_REGISTRY["claude-sonnet-5-5"].longPromptPricing).toBeUndefined();
    expect(
      calculateCost({
        model: "claude-sonnet-5-5",
        inputTokens: 200_000,
        outputTokens: 0,
      }),
    ).toBeCloseTo(0.4, 12); // 200K × $2/1M
  });
});

describe("calculateCost — Haiku 5.5 com tarifa de prompt longo", () => {
  it("input ≤ 100_000: tarifa baixa $0.10 in / $0.50 out", () => {
    expect(
      calculateCost({
        model: "claude-haiku-5-5",
        inputTokens: 50_000,
        outputTokens: 10_000,
      }),
    ).toBeCloseTo((50_000 * 0.1 + 10_000 * 0.5) / 1_000_000, 12); // 0.01
  });

  it("fronteira exata 100_000 fica na tarifa baixa", () => {
    expect(
      calculateCost({
        model: "claude-haiku-5-5",
        inputTokens: 100_000,
        outputTokens: 10_000,
      }),
    ).toBeCloseTo((100_000 * 0.1 + 10_000 * 0.5) / 1_000_000, 12); // 0.015
  });

  it("input > 100_000: a chamada INTEIRA (input e output) vai pra $0.50 / $2.50", () => {
    expect(
      calculateCost({
        model: "claude-haiku-5-5",
        inputTokens: 100_001,
        outputTokens: 10_000,
      }),
    ).toBeCloseTo((100_001 * 0.5 + 10_000 * 2.5) / 1_000_000, 12); // ≈0.0750005
    expect(
      calculateCost({
        model: "claude-haiku-5-5",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(3); // 0.5 + 2.5, não 0.1 + 0.5
  });

  it("o output sozinho não dispara a tarifa alta (o limite é só de input)", () => {
    expect(
      calculateCost({
        model: "claude-haiku-5-5",
        inputTokens: 1_000,
        outputTokens: 500_000,
      }),
    ).toBeCloseTo((1_000 * 0.1 + 500_000 * 0.5) / 1_000_000, 12);
  });
});

describe("calculateJudgmentCost — JEV (ADR 0041)", () => {
  it("US$ 0,042 por 1M de tokens de input; output grátis", () => {
    expect(calculateJudgmentCost(1_000_000)).toBeCloseTo(0.042, 12);
    expect(calculateJudgmentCost(2_000)).toBeCloseTo(0.000084, 12);
    expect(calculateJudgmentCost(0)).toBe(0);
  });
});
