import { describe, expect, it } from "vitest";

import {
  MODEL_REGISTRY,
  SELECTABLE_MODELS,
  isModelAllowedForAudience,
  modelsForAudience,
} from "@/lib/ai/models";

describe("modelsForAudience — gating por audiência (ADR 0013)", () => {
  it("admin → todos os 5 modelos, em capacidade decrescente (a UI depende da ordem)", () => {
    const ids = modelsForAudience(true).map((m) => m.id);
    expect(ids).toEqual(SELECTABLE_MODELS.map((m) => m.id));
    expect(ids).toEqual([
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-sonnet-4-5-20250929",
      "claude-haiku-4-5",
    ]);
    expect(ids).toHaveLength(5);
  });

  it("usuário comum → exatamente os 3 userSelectable (Opus 4.8, Sonnet 4.6, Haiku 4.5)", () => {
    const ids = modelsForAudience(false).map((m) => m.id);
    expect(ids).toEqual([
      "claude-opus-4-8",
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ]);
  });

  it("usuário comum NÃO vê Fable 5 nem Sonnet 4.5", () => {
    const ids = modelsForAudience(false).map((m) => m.id);
    expect(ids).not.toContain("claude-fable-5");
    expect(ids).not.toContain("claude-sonnet-4-5-20250929");
  });
});

describe("isModelAllowedForAudience — invariante de gating (ADR 0013)", () => {
  it("Fable 5: permitido pra admin, NUNCA pra usuário comum", () => {
    expect(isModelAllowedForAudience("claude-fable-5", true)).toBe(true);
    expect(isModelAllowedForAudience("claude-fable-5", false)).toBe(false);
  });

  it("Haiku 4.5: permitido pro usuário comum", () => {
    expect(isModelAllowedForAudience("claude-haiku-4-5", false)).toBe(true);
  });

  it("Sonnet 4.5: admin-only", () => {
    expect(isModelAllowedForAudience("claude-sonnet-4-5-20250929", false)).toBe(
      false,
    );
    expect(isModelAllowedForAudience("claude-sonnet-4-5-20250929", true)).toBe(
      true,
    );
  });

  it("id inválido → false mesmo pra admin", () => {
    expect(isModelAllowedForAudience("gpt-4", true)).toBe(false);
  });
});

describe("registry — sanidade dos modelos novos", () => {
  it("Fable 5: pricing 10/50, adaptive thinking, admin-only", () => {
    const m = MODEL_REGISTRY["claude-fable-5"];
    expect(m.inputPricePerMTok).toBe(10);
    expect(m.outputPricePerMTok).toBe(50);
    expect(m.thinkingMode).toBe("adaptive");
    expect(m.userSelectable).toBe(false);
  });

  it("Haiku 4.5: pricing 1/5, temperature 0.3, userSelectable", () => {
    const m = MODEL_REGISTRY["claude-haiku-4-5"];
    expect(m.inputPricePerMTok).toBe(1);
    expect(m.outputPricePerMTok).toBe(5);
    expect(m.thinkingMode).toBe("temperature");
    expect(m.temperature).toBe(0.3);
    expect(m.userSelectable).toBe(true);
  });

  it("flags userSelectable dos modelos existentes", () => {
    expect(MODEL_REGISTRY["claude-opus-4-8"].userSelectable).toBe(true);
    expect(MODEL_REGISTRY["claude-sonnet-4-6"].userSelectable).toBe(true);
    expect(MODEL_REGISTRY["claude-sonnet-4-5-20250929"].userSelectable).toBe(
      false,
    );
  });
});
