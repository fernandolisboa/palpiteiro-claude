import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MODEL_REGISTRY, type AIModel } from "@/lib/ai/models";
import type { AnalysisRequest } from "@/lib/ai/providers/types";

// O adapter informa o modelo que respondeu (`servedModel`, PLAN-608) e marca a
// rejeição do pedido (`rejection`). Mocka só o shim do client: nenhuma chamada real.
const messagesCreate = vi.fn();
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: { create: messagesCreate },
  }),
}));

import { anthropicProvider } from "../index";

const SONNET: AIModel = MODEL_REGISTRY["claude-sonnet-5-5"];

function request(over: Partial<AnalysisRequest> = {}): AnalysisRequest {
  return {
    model: SONNET,
    system: "sys",
    userMessage: "msg",
    tool: { name: "submit_prediction", inputSchema: { type: "object" } },
    toolName: "submit_prediction",
    maxTokens: 4000,
    effort: "low",
    ...over,
  };
}

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [{ type: "tool_use", id: "tu-1", name: "submit_prediction", input: {} }],
    stop_reason: "tool_use",
    stop_details: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  };
}

const headers = new Headers();

beforeEach(() => {
  messagesCreate.mockReset();
});

describe("anthropic adapter — servedModel", () => {
  it("sucesso: servedModel é o modelo do pedido", async () => {
    messagesCreate.mockResolvedValue(message());
    const r = await anthropicProvider.runAnalysis(request());
    expect(r.ok).toBe(true);
    expect(r.servedModel).toBe(SONNET);
  });

  it("server tool: servedModel é o modelo do pedido", async () => {
    messagesCreate.mockResolvedValue(message({ content: [], stop_reason: "end_turn" }));
    const r = await anthropicProvider.runAnalysis(
      request({ serverTool: { kind: "web_search", maxUses: 1 } }),
    );
    expect(r.ok).toBe(true);
    expect(r.servedModel).toBe(SONNET);
  });

  it("recusa: servedModel é o modelo do pedido", async () => {
    messagesCreate.mockResolvedValue(message({ stop_reason: "refusal" }));
    const r = await anthropicProvider.runAnalysis(request());
    expect(r.ok).toBe(false);
    expect(r.servedModel).toBe(SONNET);
  });

  it("sem prazo: timeout sem chamada, servedModel é o pedido e sem rejection", async () => {
    const r = await anthropicProvider.runAnalysis(request({ deadlineAt: Date.now() - 1 }));
    expect(messagesCreate).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.servedModel).toBe(SONNET);
    expect(r.ok === false && r.rejection).toBeUndefined();
  });
});

describe("anthropic adapter — rejection na falha", () => {
  it.each([
    ["400", new Anthropic.BadRequestError(400, undefined, "bad", headers), "invalid_request"],
    ["404", new Anthropic.NotFoundError(404, undefined, "no model", headers), "not_found"],
    ["403", new Anthropic.PermissionDeniedError(403, undefined, "denied", headers), "not_found"],
  ] as const)("%s → rejection %s, status segue provider_error", async (_l, err, rejection) => {
    messagesCreate.mockRejectedValue(err);
    const r = await anthropicProvider.runAnalysis(request());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe("provider_error");
    expect(r.rejection).toBe(rejection);
    expect(r.servedModel).toBe(SONNET);
    expect(r.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("500 e 429 não são rejeição", async () => {
    messagesCreate.mockRejectedValueOnce(
      new Anthropic.APIError(500, undefined, "boom", headers),
    );
    const r500 = await anthropicProvider.runAnalysis(request());
    expect(r500.ok === false && r500.rejection).toBeUndefined();
    expect(r500).not.toHaveProperty("rejection");

    messagesCreate.mockRejectedValueOnce(
      new Anthropic.RateLimitError(429, undefined, "slow", headers),
    );
    const r429 = await anthropicProvider.runAnalysis(request());
    expect(r429.ok === false && r429.status).toBe("rate_limited");
    expect(r429).not.toHaveProperty("rejection");
  });

  it("rejeição numa retomada de pause_turn carrega o usage já gasto", async () => {
    messagesCreate
      .mockResolvedValueOnce(message({ content: [], stop_reason: "pause_turn" }))
      .mockRejectedValueOnce(new Anthropic.NotFoundError(404, undefined, "nf", headers));
    const r = await anthropicProvider.runAnalysis(
      request({ serverTool: { kind: "web_search", maxUses: 1 } }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.rejection).toBe("not_found");
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });
});
