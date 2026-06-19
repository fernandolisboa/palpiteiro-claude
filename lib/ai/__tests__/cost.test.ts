import { describe, expect, it } from "vitest";

import { calculateCost } from "@/lib/ai/cost";
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

  it("Sonnet 4.5: $3 in + $15 out per 1M → 18 for 1M+1M", () => {
    expect(
      calculateCost({
        model: "claude-sonnet-4-5-20250929",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(18);
  });

  it("Haiku 4.5: $1 in + $5 out per 1M → 6 for 1M+1M", () => {
    expect(
      calculateCost({
        model: "claude-haiku-4-5",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(6);
  });
});
