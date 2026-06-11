import { describe, expect, it } from "vitest";

import {
  EFFORT_LEVELS,
  GENERATION_PARAM_DEFAULTS,
  isEffort,
  isValidMaxTokens,
  isValidTemperature,
  MAX_TOKENS_MAX,
  MAX_TOKENS_MIN,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
} from "@/lib/ai/generation-params";

describe("generation-params — validação pura (ADR 0008 emenda 2)", () => {
  it("EFFORT_LEVELS = low/medium/high/max (xhigh omitido — não universal nos adaptive)", () => {
    expect(EFFORT_LEVELS).toEqual(["low", "medium", "high", "max"]);
    expect(EFFORT_LEVELS).not.toContain("xhigh");
  });

  it("defaults espelham o seed da migration (16000 / high / 0.3)", () => {
    expect(GENERATION_PARAM_DEFAULTS).toEqual({
      maxTokens: 16000,
      effort: "high",
      temperature: 0.3,
    });
  });

  it("isEffort aceita só os níveis do registry", () => {
    for (const e of EFFORT_LEVELS) expect(isEffort(e)).toBe(true);
    expect(isEffort("xhigh")).toBe(false);
    expect(isEffort("HIGH")).toBe(false);
    expect(isEffort("")).toBe(false);
    expect(isEffort(undefined)).toBe(false);
    expect(isEffort(3)).toBe(false);
  });

  it("isValidMaxTokens: inteiro dentro do range", () => {
    expect(isValidMaxTokens(MAX_TOKENS_MIN)).toBe(true);
    expect(isValidMaxTokens(MAX_TOKENS_MAX)).toBe(true);
    expect(isValidMaxTokens(16000)).toBe(true);
    expect(isValidMaxTokens(MAX_TOKENS_MIN - 1)).toBe(false);
    expect(isValidMaxTokens(MAX_TOKENS_MAX + 1)).toBe(false);
    expect(isValidMaxTokens(1024.5)).toBe(false);
    expect(isValidMaxTokens(Number.NaN)).toBe(false);
  });

  it("isValidTemperature: finito dentro de [0,1]", () => {
    expect(isValidTemperature(TEMPERATURE_MIN)).toBe(true);
    expect(isValidTemperature(TEMPERATURE_MAX)).toBe(true);
    expect(isValidTemperature(0.3)).toBe(true);
    expect(isValidTemperature(-0.1)).toBe(false);
    expect(isValidTemperature(1.1)).toBe(false);
    expect(isValidTemperature(Number.NaN)).toBe(false);
  });
});
