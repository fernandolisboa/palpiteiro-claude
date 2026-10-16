import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MODEL_REGISTRY } from "@/lib/ai/models";

// Ponta a ponta do seam (ADR 0062): getProviderForModel → withAdoptedVersions →
// resolveActiveModel → adapter Anthropic, com só o client mockado (nenhuma chamada
// real) e o estado das versões vindo do mock global (vitest.setup.ts).
const messagesCreate = vi.fn();
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({ messages: { create: messagesCreate } }),
}));
vi.mock("@/lib/db/queries/model-versions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/queries/model-versions")>()),
  getActiveModelState: vi.fn(async () => ({ enabled: false, active: [] })),
  markModelVersionFailed: vi.fn(async () => true),
}));

import { resetActiveModelMemo } from "@/lib/ai/model-versions/active";
import { getProviderForModel } from "@/lib/ai/providers";
import type { AnalysisRequest } from "@/lib/ai/providers/types";
import {
  getActiveModelState,
  markModelVersionFailed,
  type ModelVersionRow,
} from "@/lib/db/queries/model-versions";

const stateMock = vi.mocked(getActiveModelState);
const markFailed = vi.mocked(markModelVersionFailed);
const SONNET = MODEL_REGISTRY["claude-sonnet-5-5"];

function req(): AnalysisRequest {
  return {
    model: SONNET,
    system: "s",
    userMessage: "u",
    tool: { name: "submit_prediction", inputSchema: { type: "object" } },
    toolName: "submit_prediction",
    maxTokens: 4000,
    effort: "low",
  };
}

function message(model: string) {
  return {
    id: "m",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "tool_use", id: "t", name: "submit_prediction", input: {} }],
    stop_reason: "tool_use",
    stop_details: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

const active: ModelVersionRow = {
  id: "claude-sonnet-5-6",
  family: "sonnet",
  displayName: "Claude Sonnet 5.6",
  apiCreatedAt: null,
  capabilities: null,
  maxTokens: null,
  status: "active",
  pricing: { inputPricePerMTok: 2, outputPricePerMTok: 10 },
  priceConfirmedAt: null,
  adoptedAt: new Date(),
  failureReason: null,
  probeAiCallId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  resetActiveModelMemo();
  messagesCreate.mockReset();
  markFailed.mockClear();
  stateMock.mockResolvedValue({ enabled: false, active: [] });
});

afterEach(() => {
  resetActiveModelMemo();
});

describe("seam com versões adotadas", () => {
  it("estado desligado (default dos testes) → a conferida vai pra API, como antes", async () => {
    messagesCreate.mockResolvedValue(message("claude-sonnet-5-5"));
    const r = await getProviderForModel(SONNET).runAnalysis(req());
    expect(messagesCreate.mock.calls[0][0].model).toBe("claude-sonnet-5-5");
    expect(r.servedModel).toBe(SONNET);
  });

  it("versão adotada → ela vai pra API e é o servedModel", async () => {
    stateMock.mockResolvedValue({ enabled: true, active: [active] });
    messagesCreate.mockResolvedValue(message("claude-sonnet-5-6"));
    const r = await getProviderForModel(SONNET).runAnalysis(req());
    expect(messagesCreate.mock.calls[0][0].model).toBe("claude-sonnet-5-6");
    expect(r.servedModel).toMatchObject({
      id: "claude-sonnet-5-6",
      adopted: { priceEstimated: true, pinnedId: "claude-sonnet-5-5" },
    });
  });

  it("404 na adotada → a conferida responde e a adotada é marcada (preview: row falsa → 404 → 5.5)", async () => {
    stateMock.mockResolvedValue({ enabled: true, active: [active] });
    messagesCreate
      .mockRejectedValueOnce(
        new Anthropic.NotFoundError(404, undefined, "model not found", new Headers()),
      )
      .mockResolvedValueOnce(message("claude-sonnet-5-5"));
    const r = await getProviderForModel(SONNET).runAnalysis(req());
    expect(messagesCreate.mock.calls.map((c) => c[0].model)).toEqual([
      "claude-sonnet-5-6",
      "claude-sonnet-5-5",
    ]);
    expect(r.ok).toBe(true);
    expect(r.servedModel).toBe(SONNET);
    expect(markFailed).toHaveBeenCalledTimes(1);
  });
});
