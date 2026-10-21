import { beforeEach, describe, expect, it, vi } from "vitest";

import { MODEL_REGISTRY, type AIModel } from "@/lib/ai/models";
import type { AnalysisRequest, AnalysisResult } from "@/lib/ai/providers/types";

const insertValues = vi.fn((..._args: unknown[]) => {});
vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: (...args: unknown[]) => {
        insertValues(...args);
        return {
          returning: vi.fn(() => Promise.resolve([{ id: "explain-ok-1" }])),
        };
      },
    })),
  },
}));
const persistAiCallError = vi.fn(
  async (..._args: unknown[]) => "explain-err-1"
);
vi.mock("@/lib/ai/ai-call-logging", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/ai-call-logging")>()),
  persistAiCallError: (...args: unknown[]) => persistAiCallError(...args),
}));
const fakeProvider = {
  providerKey: "anthropic",
  hasKey: vi.fn(() => true),
  runAnalysis: vi.fn(
    async (_r: AnalysisRequest): Promise<AnalysisResult> => ok(GOOD)
  ),
};
vi.mock("@/lib/ai/providers", () => ({
  getProviderForModel: vi.fn(() => fakeProvider),
}));
const getPreferredModelId = vi.fn(
  async (_u: string): Promise<string | null> => null
);
vi.mock("@/lib/db/queries/users", () => ({
  getPreferredModelId: (u: string) => getPreferredModelId(u),
}));
const getDefaultModelId = vi.fn(async () => "claude-sonnet-5-5");
vi.mock("@/lib/db/queries/ai-config", () => ({
  getDefaultModelId: () => getDefaultModelId(),
}));

import { BET_SLIP_EXPLAIN_VERSION } from "@/lib/ai/bet-slip-explain/cartridge";
import {
  EXPLAIN_MAX_TOKENS,
  explainBetSlipWithAI,
} from "@/lib/ai/bet-slip-explain/explain";
import { templatedBetExplanation } from "@/lib/ai/bet-slip-explain/fallback";

import { simplesInput } from "./fixtures";

const INPUT = simplesInput();
const GOOD = {
  resumo:
    "A primeira tem valor pela sua odd e a segunda não; é a opinião do modelo.",
  pernas: [
    {
      indice: 0,
      texto: "56,2% contra os 51,3% que a odd 1,95 precisa: +9,6%.",
    },
    { indice: 1, texto: "48,0% contra 55,6%: -13,6%, não tem valor." },
  ],
  combinada: null,
};

function ok(toolInput: unknown): AnalysisResult {
  return {
    ok: true,
    toolInput,
    usage: { inputTokens: 1000, outputTokens: 200 },
    inputPayload: { req: 1 },
    outputPayload: { res: 1 },
    stopReason: "tool_use",
    latencyMs: 900,
    servedModel: MODEL_REGISTRY["claude-sonnet-5-5"],
  };
}

const ARGS = { input: INPUT, userId: "u-1", matchId: "m-1", isAdmin: false };

beforeEach(() => {
  vi.clearAllMocks();
  fakeProvider.hasKey.mockReturnValue(true);
  getPreferredModelId.mockResolvedValue(null);
  getDefaultModelId.mockResolvedValue("claude-sonnet-5-5");
});

describe("explainBetSlipWithAI (#562)", () => {
  it("caminho ok: texto do LLM, row ok com a versão do prompt, usuário e jogo", async () => {
    const r = await explainBetSlipWithAI(ARGS);
    expect(r).toEqual({
      explanation: GOOD,
      source: "llm",
      aiCallId: "explain-ok-1",
    });
    expect(insertValues.mock.calls[0][0]).toMatchObject({
      status: "ok",
      promptVersion: BET_SLIP_EXPLAIN_VERSION,
      model: "claude-sonnet-5-5",
      userId: "u-1",
      matchId: "m-1",
    });
  });

  it.each([
    [
      "fidelidade",
      ok({ ...GOOD, resumo: "chance de 77,7%" }),
      "invalid_output",
      /^fidelity:/,
    ],
    [
      "linguagem",
      ok({ ...GOOD, resumo: "Aposte no over." }),
      "invalid_output",
      /^language:/,
    ],
    ["Zod", ok({ ...GOOD, extra: 1 }), "invalid_output", /./],
    ["tool ausente", ok(undefined), "tool_missing", /submit_bet_explanation/],
  ] as const)("%s → template com a row %s", async (_l, result, status, msg) => {
    fakeProvider.runAnalysis.mockResolvedValueOnce(result as AnalysisResult);
    const r = await explainBetSlipWithAI(ARGS);
    expect(r.source).toBe("template");
    expect(r.explanation).toEqual(templatedBetExplanation(INPUT));
    expect(r.aiCallId).toBe("explain-err-1");
    const row = persistAiCallError.mock.calls[0][0] as {
      status: string;
      errorMessage: string;
      promptVersion: string;
    };
    expect(row.status).toBe(status);
    expect(row.errorMessage).toMatch(msg);
    expect(row.promptVersion).toBe(BET_SLIP_EXPLAIN_VERSION);
  });

  it("sem chave → template sem chamada", async () => {
    fakeProvider.hasKey.mockReturnValue(false);
    const r = await explainBetSlipWithAI(ARGS);
    expect(r.source).toBe("template");
    expect(fakeProvider.runAnalysis).not.toHaveBeenCalled();
    expect(persistAiCallError.mock.calls[0][0]).toMatchObject({
      status: "provider_error",
    });
  });

  it("sem tempo → timeout sem chamada", async () => {
    const r = await explainBetSlipWithAI({
      ...ARGS,
      deadlineAt: Date.now() + 1000,
    });
    expect(r.source).toBe("template");
    expect(fakeProvider.runAnalysis).not.toHaveBeenCalled();
    expect(persistAiCallError.mock.calls[0][0]).toMatchObject({
      status: "timeout",
    });
  });

  it("modelo da preferência do usuário, effort low, sem temperature, 2000 tokens", async () => {
    getPreferredModelId.mockResolvedValue("claude-opus-5-5");
    await explainBetSlipWithAI(ARGS);
    const req = fakeProvider.runAnalysis.mock.calls[0][0];
    expect(req.model.id).toBe("claude-opus-5-5");
    expect(req.effort).toBe("low");
    expect(req).not.toHaveProperty("temperature");
    expect(req.maxTokens).toBe(EXPLAIN_MAX_TOKENS);
    expect(req.toolName).toBe("submit_bet_explanation");
  });

  it("modelo servido diferente do pedido (versão adotada) vai pra row", async () => {
    const adopted: AIModel = {
      ...MODEL_REGISTRY["claude-sonnet-5-5"],
      id: "claude-sonnet-5-6",
      adopted: { priceEstimated: true, pinnedId: "claude-sonnet-5-5" },
    };
    fakeProvider.runAnalysis.mockResolvedValueOnce({
      ...ok(GOOD),
      servedModel: adopted,
    });
    await explainBetSlipWithAI(ARGS);
    expect(insertValues.mock.calls[0][0]).toMatchObject({
      model: "claude-sonnet-5-6",
    });
  });

  it("nunca lança: erro inesperado vira template", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getPreferredModelId.mockRejectedValue(new Error("db down"));
    const r = await explainBetSlipWithAI(ARGS);
    expect(r).toEqual({
      explanation: templatedBetExplanation(INPUT),
      source: "template",
      aiCallId: null,
    });
  });
});
