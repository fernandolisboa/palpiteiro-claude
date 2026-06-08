import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

import { MODEL_REGISTRY } from "@/lib/ai/models";
import { buildAnthropicRequest } from "@/lib/ai/request-builder";
import { SUBMIT_PREDICTION_TOOL } from "@/lib/ai/prompts/over_under_v1";

const MAX_TOKENS = 2048;

function build(model: Parameters<typeof buildAnthropicRequest>[0]["model"]) {
  return buildAnthropicRequest({
    model,
    system: "sys",
    userMessage: "msg",
    tools: [SUBMIT_PREDICTION_TOOL as unknown as Anthropic.Tool],
    toolName: SUBMIT_PREDICTION_TOOL.name,
    maxTokens: MAX_TOKENS,
  });
}

describe("buildAnthropicRequest — model-aware payload", () => {
  it("Opus 4.8: adaptive thinking, NO temperature/top_p/top_k", () => {
    const payload = build(MODEL_REGISTRY["claude-opus-4-8"]);

    expect(payload.model).toBe("claude-opus-4-8");
    // CRÍTICO: Opus 4.x dá 400 em sampling params; o builder DEVE omiti-los.
    expect(payload).not.toHaveProperty("temperature");
    expect(payload).not.toHaveProperty("top_p");
    expect(payload).not.toHaveProperty("top_k");
    expect(payload.thinking).toEqual({ type: "adaptive" });
  });

  it("Sonnet 4.5: temperature 0.3, NO thinking", () => {
    const payload = build(MODEL_REGISTRY["claude-sonnet-4-5-20250929"]);

    expect(payload.model).toBe("claude-sonnet-4-5-20250929");
    expect(payload.temperature).toBe(0.3);
    expect(payload).not.toHaveProperty("thinking");
  });

  it("both: tool_choice forces submit_prediction and max_tokens is wired", () => {
    for (const model of Object.values(MODEL_REGISTRY)) {
      const payload = build(model);
      expect(payload.tool_choice).toEqual({
        type: "tool",
        name: SUBMIT_PREDICTION_TOOL.name,
      });
      expect(payload.max_tokens).toBe(MAX_TOKENS);
    }
  });
});
