import { beforeEach, describe, expect, it, vi } from "vitest";

import { MODEL_REGISTRY, type AIModel } from "@/lib/ai/models";
import type { AnalysisRequest, AnalysisResult } from "@/lib/ai/providers/types";

// parseBetText loga em ai_calls o modelo que respondeu (`servedModel`, PLAN-608), não o
// pedido. Sem DB nem provider reais.
const insertValues = vi.fn((..._args: unknown[]) => {});
vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: (...args: unknown[]) => {
        insertValues(...args);
        return { returning: vi.fn(() => Promise.resolve([{ id: "parse-ok-1" }])) };
      },
    })),
  },
}));
const persistAiCallError = vi.fn(async (..._args: unknown[]) => "parse-err-1");
vi.mock("@/lib/ai/ai-call-logging", () => ({
  persistAiCallError: (...args: unknown[]) => persistAiCallError(...args),
}));
const fakeProvider = {
  providerKey: "anthropic",
  hasKey: vi.fn(() => true),
  runAnalysis: vi.fn(async (_r: AnalysisRequest): Promise<AnalysisResult> => ok()),
};
vi.mock("@/lib/ai/providers", () => ({
  getProviderForModel: () => fakeProvider,
}));

import { parseBetText } from "@/lib/ai/bet-parse/parse";

const HAIKU = MODEL_REGISTRY["claude-haiku-5-5"];
const ADOPTED: AIModel = {
  ...HAIKU,
  id: "claude-haiku-5-6",
  inputPricePerMTok: 1,
  outputPricePerMTok: 2,
  longPromptPricing: undefined,
  adopted: { priceEstimated: true, pinnedId: "claude-haiku-5-5" },
};

function ok(servedModel: AIModel = HAIKU): AnalysisResult {
  return {
    ok: true,
    toolInput: { legs: [{ kind: "btts", params: { selection: "yes" }, userOdd: 1.9 }] },
    usage: { inputTokens: 1000, outputTokens: 500 },
    inputPayload: { req: 1 },
    outputPayload: { res: 1 },
    stopReason: "tool_use",
    latencyMs: 100,
    servedModel,
  };
}

const ARGS = { rawInput: "ambas marcam @1,90", matchId: "m-1", userId: "u-1" };

beforeEach(() => {
  vi.clearAllMocks();
  fakeProvider.hasKey.mockReturnValue(true);
});

describe("parseBetText — modelo que serviu", () => {
  it("sucesso: ai_calls.model e custo do servido; o pedido segue o Haiku conferido", async () => {
    fakeProvider.runAnalysis.mockResolvedValueOnce(ok(ADOPTED));
    const r = await parseBetText(ARGS);
    expect(r.ok).toBe(true);
    expect(fakeProvider.runAnalysis.mock.calls[0][0].model.id).toBe("claude-haiku-5-5");
    expect(insertValues.mock.calls[0][0]).toMatchObject({
      status: "ok",
      model: "claude-haiku-5-6",
      // 1000 × $1 + 500 × $2 por 1M
      costUsd: ((1000 * 1 + 500 * 2) / 1_000_000).toFixed(6),
    });
  });

  it("erro do provider: a row de erro leva o servido", async () => {
    fakeProvider.runAnalysis.mockResolvedValueOnce({
      ok: false,
      status: "provider_error",
      message: "boom",
      usage: { inputTokens: 0, outputTokens: 0 },
      inputPayload: {},
      outputPayload: {},
      stopReason: null,
      latencyMs: 1,
      servedModel: ADOPTED,
    });
    const r = await parseBetText(ARGS);
    expect(r.ok).toBe(false);
    expect(persistAiCallError.mock.calls[0][0]).toMatchObject({
      status: "provider_error",
      model: ADOPTED,
    });
  });

  it("sem chave: nenhuma chamada, a row leva o modelo pedido", async () => {
    fakeProvider.hasKey.mockReturnValue(false);
    await parseBetText(ARGS);
    expect(fakeProvider.runAnalysis).not.toHaveBeenCalled();
    expect(persistAiCallError.mock.calls[0][0]).toMatchObject({ model: HAIKU });
  });
});
