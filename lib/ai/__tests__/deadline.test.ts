import { describe, expect, it } from "vitest";

import { canFitCall, minCallBudgetMs } from "@/lib/ai/deadline";

describe("minCallBudgetMs / canFitCall (#524 re-review)", () => {
  it("temperature: 20s", () => {
    expect(minCallBudgetMs({ thinkingMode: "temperature" })).toBe(20_000);
  });

  it("adaptive: piso de 120s, ou metade do timeout estimado se for maior", () => {
    // Checagem grossa, sem max_tokens: o piso.
    expect(minCallBudgetMs({ thinkingMode: "adaptive" })).toBe(120_000);
    // 16000 em high → timeout 215s → metade 107,5s < piso.
    expect(
      minCallBudgetMs({ thinkingMode: "adaptive", maxTokens: 16000, effort: "high" }),
    ).toBe(120_000);
    // 16000 em xhigh → timeout ~281,7s → metade ~140,8s.
    expect(
      minCallBudgetMs({ thinkingMode: "adaptive", maxTokens: 16000, effort: "xhigh" }),
    ).toBeCloseTo(140_833, -1);
  });

  it("mercado marginal (100s restantes) não inicia adaptive, mas inicia temperature", () => {
    const now = 1_000_000;
    const deadlineAt = now + 100_000;
    expect(canFitCall(deadlineAt, "adaptive", now)).toBe(false);
    expect(canFitCall(deadlineAt, "temperature", now)).toBe(true);
    expect(canFitCall(undefined, "adaptive", now)).toBe(true);
  });
});
