import { describe, expect, it } from "vitest";

import { calculateCost } from "@/lib/ai/cost";

describe("calculateCost — derived from MODEL_REGISTRY", () => {
  it("Opus 4.8: $5 in + $25 out per 1M → 30 for 1M+1M", () => {
    expect(
      calculateCost({
        model: "claude-opus-4-8",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(30);
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
});
