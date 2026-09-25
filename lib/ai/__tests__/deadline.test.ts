import { describe, expect, it } from "vitest";

import {
  ACTION_BUDGET_MS,
  actionDeadline,
  canFitCall,
  MAX_MIN_CALL_BUDGET_MS,
  minCallBudgetMs,
  SYNTHESIS_RESERVE_MS,
} from "@/lib/ai/deadline";

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

  it("piso limitado pelo que um run novo oferece: 32000 em xhigh não fica impossível", () => {
    // metade de ~548s = 274s > os 270s do run inteiro; o teto é 270 − 25 − 60 = 185s.
    const call = {
      thinkingMode: "adaptive" as const,
      maxTokens: 32000,
      effort: "xhigh" as const,
    };
    expect(MAX_MIN_CALL_BUDGET_MS).toBe(185_000);
    expect(minCallBudgetMs(call)).toBe(185_000);
    // Um fan-out recém-iniciado (prazo − reserva da síntese = 245s) ainda começa.
    const now = 1_000_000;
    const fanOutDeadline = actionDeadline(now) - SYNTHESIS_RESERVE_MS;
    expect(canFitCall(fanOutDeadline, call, now)).toBe(true);
    expect(minCallBudgetMs(call)).toBeLessThan(ACTION_BUDGET_MS);
  });

  it("mercado marginal (100s restantes) não inicia adaptive, mas inicia temperature", () => {
    const now = 1_000_000;
    const deadlineAt = now + 100_000;
    expect(canFitCall(deadlineAt, "adaptive", now)).toBe(false);
    expect(canFitCall(deadlineAt, "temperature", now)).toBe(true);
    expect(canFitCall(undefined, "adaptive", now)).toBe(true);
  });
});
