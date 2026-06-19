import {
  APIConnectionTimeoutError,
  APIError,
  RateLimitError,
} from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AIModel } from "@/lib/ai/models";
import type { AnalysisRequest } from "@/lib/ai/providers/types";

// Modelo INLINE com provider:'openai'. Pós-#374 o registry não tem modelo OpenAI
// (o gpt-5-mini de prova saiu), mas o SEAM segue intacto (AIProviderKey mantém
// 'openai'). Este adapter testa a normalização do structured output STRING-JSON
// independente do registry — basta um AIModel com provider:'openai'. O `id` é só
// um placeholder válido (AIModelId); o que importa é o `provider`.
const OPENAI_MODEL_FIXTURE: AIModel = {
  id: "claude-haiku-4-5",
  provider: "openai",
  label: "OpenAI seam fixture (#374)",
  inputPricePerMTok: 0.25,
  outputPricePerMTok: 2.0,
  thinkingMode: "temperature",
  userSelectable: false,
};

// Mocka SÓ o shim @/lib/ai/openai (boundary mockável): o adapter importa
// getOpenAIClient DAQUI. `hasKey` vem de ./client (não mockado, lê env). NENHUM
// client real é construído; NENHUMA chamada paga; sem OPENAI_API_KEY.
const openaiCreate = vi.fn();
vi.mock("@/lib/ai/openai", () => ({
  getOpenAIClient: () => ({
    chat: { completions: { create: openaiCreate } },
  }),
}));

import { openaiProvider } from "../index";

const REQUEST: AnalysisRequest = {
  model: OPENAI_MODEL_FIXTURE,
  system: "system prompt",
  userMessage: "user message",
  tool: {
    name: "submit_prediction",
    description: "envia a recomendação",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  toolName: "submit_prediction",
  maxTokens: 16000,
};

// ChatCompletion-shaped fixture com UM tool_call cujo arguments é STRING JSON.
function completion(overrides: Record<string, unknown> = {}) {
  return {
    id: "chatcmpl-1",
    object: "chat.completion",
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "submit_prediction",
                arguments:
                  '{"recommendation":"over","confidence_pct":60,"rationale":"x","key_factors":["a"]}',
              },
            },
          ],
        },
      },
    ],
    // completion_tokens JÁ inclui os reasoning tokens (itemizados em _details).
    usage: {
      prompt_tokens: 1200,
      completion_tokens: 300,
      completion_tokens_details: { reasoning_tokens: 250 },
    },
    ...overrides,
  };
}

beforeEach(() => {
  openaiCreate.mockReset();
});
afterEach(() => {
  delete process.env.OPENAI_API_KEY;
});

describe("openaiProvider — contrato do seam", () => {
  it("providerKey é 'openai'; hasKey reflete o env (inerte sem OPENAI_API_KEY)", () => {
    expect(openaiProvider.providerKey).toBe("openai");
    delete process.env.OPENAI_API_KEY;
    expect(openaiProvider.hasKey()).toBe(false);
    process.env.OPENAI_API_KEY = "test-key";
    expect(openaiProvider.hasKey()).toBe(true);
  });
});

describe("openaiProvider.runAnalysis — normalização do structured output", () => {
  it("arguments STRING JSON → toolInput PARSEADO (o passo de prova falsificável)", async () => {
    openaiCreate.mockResolvedValue(completion());
    const result = await openaiProvider.runAnalysis(REQUEST);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.toolInput).toEqual({
      recommendation: "over",
      confidence_pct: 60,
      rationale: "x",
      key_factors: ["a"],
    });
    expect(result.stopReason).toBe("tool_calls");
  });

  it("usage: prompt→input, completion→output; reasoning_tokens NÃO somado em dobro", async () => {
    openaiCreate.mockResolvedValue(completion());
    const result = await openaiProvider.runAnalysis(REQUEST);
    if (!result.ok) throw new Error("unreachable");
    expect(result.usage.inputTokens).toBe(1200);
    // 300 = completion_tokens (que já inclui os 250 de reasoning); NÃO 550.
    expect(result.usage.outputTokens).toBe(300);
  });

  it("request: tool function strict:false, tool_choice forçado, max_completion_tokens, SEM temperature", async () => {
    openaiCreate.mockResolvedValue(completion());
    await openaiProvider.runAnalysis(REQUEST);
    const sent = openaiCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty("temperature"); // modelo de raciocínio
    expect(sent.max_completion_tokens).toBe(16000);
    expect(sent).not.toHaveProperty("max_tokens");
    expect(sent.tool_choice).toEqual({
      type: "function",
      function: { name: "submit_prediction" },
    });
    const tools = sent.tools as Array<{
      type: string;
      function: { name: string; strict: boolean };
    }>;
    expect(tools[0].type).toBe("function");
    expect(tools[0].function.name).toBe("submit_prediction");
    expect(tools[0].function.strict).toBe(false);
  });

  it("nenhum tool_call que case → toolInput undefined (sentinel de tool_missing)", async () => {
    openaiCreate.mockResolvedValue(
      completion({
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: "sem convicção" },
          },
        ],
      }),
    );
    const result = await openaiProvider.runAnalysis(REQUEST);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.toolInput).toBeUndefined();
  });

  it("arguments NÃO-JSON → provider_error (NÃO crash, NÃO invalid_output)", async () => {
    openaiCreate.mockResolvedValue(
      completion({
        choices: [
          {
            index: 0,
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: { name: "submit_prediction", arguments: "{not json" },
                },
              ],
            },
          },
        ],
      }),
    );
    const result = await openaiProvider.runAnalysis(REQUEST);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe("provider_error");
    expect(result.message).toContain("not valid JSON");
  });
});

describe("openaiProvider.runAnalysis — classificação de erro do SDK (sem chamada paga)", () => {
  it("APIConnectionTimeoutError → timeout", async () => {
    openaiCreate.mockRejectedValue(
      new APIConnectionTimeoutError({ message: "timed out" }),
    );
    const result = await openaiProvider.runAnalysis(REQUEST);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe("timeout");
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("RateLimitError (429) → rate_limited", async () => {
    openaiCreate.mockRejectedValue(
      new RateLimitError(429, undefined, "slow down", new Headers()),
    );
    const result = await openaiProvider.runAnalysis(REQUEST);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe("rate_limited");
  });

  it("APIError (500) → provider_error, com payload de erro serializado", async () => {
    openaiCreate.mockRejectedValue(
      new APIError(500, undefined, "internal", new Headers()),
    );
    const result = await openaiProvider.runAnalysis(REQUEST);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe("provider_error");
    expect(result.outputPayload).toHaveProperty("error");
  });
});
