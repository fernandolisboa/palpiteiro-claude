import { describe, expect, it } from "vitest";

import {
  ACTION_BUDGET_MS,
  actionDeadline,
  canFitCall,
  MAX_MIN_CALL_BUDGET_MS,
  minCallBudgetMs,
  NEWS_MIN_BUDGET_MS,
  SYNTHESIS_CALL_RESERVE_MS,
  SYNTHESIS_RESERVE_MS,
} from "@/lib/ai/deadline";
import { MODEL_REGISTRY } from "@/lib/ai/models";

describe("minCallBudgetMs / canFitCall (#524 re-review)", () => {
  it("fast: 20s", () => {
    expect(minCallBudgetMs({ speed: "fast" })).toBe(20_000);
  });

  it("fast: piso de 20s em effort low/medium, sem effort ou sem max_tokens", () => {
    expect(minCallBudgetMs({ speed: "fast", maxTokens: 1024, effort: "low" })).toBe(
      20_000,
    );
    // A manchete: max_tokens do admin, effort low — fica no piso mesmo com 32000.
    expect(minCallBudgetMs({ speed: "fast", maxTokens: 32000, effort: "low" })).toBe(
      20_000,
    );
    expect(minCallBudgetMs({ speed: "fast", maxTokens: 4096, effort: "medium" })).toBe(
      20_000,
    );
    expect(minCallBudgetMs({ speed: "fast", maxTokens: 32000 })).toBe(20_000);
    expect(minCallBudgetMs({ speed: "fast", effort: "max" })).toBe(20_000);
  });

  it("fast: em high ou acima, um quarto do timeout estimado (Haiku 5.5 pensa)", () => {
    // 16000 em high → timeout 215s → 53,75s.
    expect(minCallBudgetMs({ speed: "fast", maxTokens: 16000, effort: "high" })).toBe(
      53_750,
    );
    // 32000 em xhigh → 15s + 533,3s = 548,3s → ~137s, abaixo do teto.
    expect(
      minCallBudgetMs({ speed: "fast", maxTokens: 32000, effort: "xhigh" }),
    ).toBeCloseTo(137_083, -1);
    // Formato pequeno em high ainda fica no piso.
    expect(minCallBudgetMs({ speed: "fast", maxTokens: 1024, effort: "high" })).toBe(
      20_000,
    );
  });

  it("deliberate: piso de 120s, ou metade do timeout estimado se for maior", () => {
    // Checagem grossa, sem max_tokens: o piso.
    expect(minCallBudgetMs({ speed: "deliberate" })).toBe(120_000);
    // 16000 em high → timeout 215s → metade 107,5s < piso.
    expect(
      minCallBudgetMs({ speed: "deliberate", maxTokens: 16000, effort: "high" }),
    ).toBe(120_000);
    // 16000 em xhigh → timeout ~281,7s → metade ~140,8s.
    expect(
      minCallBudgetMs({ speed: "deliberate", maxTokens: 16000, effort: "xhigh" }),
    ).toBeCloseTo(140_833, -1);
    // Sem effort o timeout assume high: 16000 → 215s → metade abaixo do piso.
    expect(minCallBudgetMs({ speed: "deliberate", maxTokens: 16000 })).toBe(120_000);
    // max_tokens baixo nunca desce do piso.
    expect(
      minCallBudgetMs({ speed: "deliberate", maxTokens: 1024, effort: "low" }),
    ).toBe(120_000);
  });

  it("piso limitado pelo que um run novo oferece: 32000 em xhigh não fica impossível", () => {
    // metade de ~548s = 274s > os 270s do run inteiro; o teto é 270 − 45 − 60 = 165s.
    const call = {
      speed: "deliberate" as const,
      maxTokens: 32000,
      effort: "xhigh" as const,
    };
    expect(MAX_MIN_CALL_BUDGET_MS).toBe(165_000);
    expect(minCallBudgetMs(call)).toBe(165_000);
    // Um fan-out recém-iniciado (prazo − reserva da síntese = 225s) ainda começa.
    const now = 1_000_000;
    const fanOutDeadline = actionDeadline(now) - SYNTHESIS_RESERVE_MS;
    expect(canFitCall(fanOutDeadline, call, now)).toBe(true);
    expect(minCallBudgetMs(call)).toBeLessThan(ACTION_BUDGET_MS);
  });

  it("mercado marginal (100s restantes) não inicia deliberate, mas inicia fast", () => {
    const now = 1_000_000;
    const deadlineAt = now + 100_000;
    expect(canFitCall(deadlineAt, "deliberate", now)).toBe(false);
    expect(canFitCall(deadlineAt, "fast", now)).toBe(true);
    expect(canFitCall(undefined, "deliberate", now)).toBe(true);
  });

  it("fast: cabe com 20s restantes exatos, não com menos", () => {
    const now = 1_000_000;
    expect(canFitCall(now + 20_000, "fast", now)).toBe(true);
    expect(canFitCall(now + 19_999, "fast", now)).toBe(false);
    expect(
      canFitCall(now + 20_000, { speed: "fast", maxTokens: 32000, effort: "low" }, now),
    ).toBe(true);
    expect(
      canFitCall(now + 20_000, { speed: "fast", maxTokens: 16000, effort: "high" }, now),
    ).toBe(false);
  });

  it("o ritmo do registry: Haiku 5.5 é fast, Opus e Sonnet 5.5 são deliberate", () => {
    expect(MODEL_REGISTRY["claude-haiku-5-5"].speed).toBe("fast");
    expect(MODEL_REGISTRY["claude-sonnet-5-5"].speed).toBe("deliberate");
    expect(MODEL_REGISTRY["claude-opus-5-5"].speed).toBe("deliberate");
  });
});

describe("reserva da síntese", () => {
  it("a parte da manchete comporta uma chamada fast (Haiku 5.5)", () => {
    const deadlineAt = 1_000_000;
    expect(
      canFitCall(deadlineAt, "fast", deadlineAt - SYNTHESIS_CALL_RESERVE_MS),
    ).toBe(true);
  });

  it("a reserva cobre notícias + manchete", () => {
    expect(SYNTHESIS_RESERVE_MS).toBeGreaterThanOrEqual(
      NEWS_MIN_BUDGET_MS + SYNTHESIS_CALL_RESERVE_MS,
    );
  });
});
