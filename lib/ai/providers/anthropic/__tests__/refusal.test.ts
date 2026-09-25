import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MODEL_REGISTRY, type AIModel } from "@/lib/ai/models";
import type { AnalysisRequest } from "@/lib/ai/providers/types";

// Mocka SÓ o shim @/lib/ai/anthropic (boundary mockável do adapter). Nenhuma
// chamada real; sem ANTHROPIC_API_KEY.
const messagesCreate = vi.fn();
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: { create: messagesCreate },
  }),
}));

import { ModelRefusalError, refusalFromMessage } from "../errors";
import { anthropicProvider } from "../index";
import { adaptiveTimeoutMs } from "../timeouts";

const FABLE: AIModel = MODEL_REGISTRY["claude-fable-5-1"];
const HAIKU: AIModel = MODEL_REGISTRY["claude-haiku-4-5"];

function forcedRequest(model: AIModel): AnalysisRequest {
  return {
    model,
    system: "sys",
    userMessage: "msg",
    tool: {
      name: "submit_prediction",
      description: "d",
      inputSchema: { type: "object" },
    },
    toolName: "submit_prediction",
    maxTokens: 16000,
    effort: "high",
    temperature: 0.3,
  };
}

function message(overrides: Record<string, unknown>) {
  return {
    id: "msg-1",
    type: "message",
    role: "assistant",
    model: "claude-fable-5-1",
    content: [],
    stop_reason: "end_turn",
    stop_details: null,
    usage: { input_tokens: 900, output_tokens: 40 },
    ...overrides,
  };
}

beforeEach(() => {
  messagesCreate.mockReset();
});

describe("refusalFromMessage", () => {
  it("só reconhece stop_reason 'refusal'", () => {
    expect(refusalFromMessage({ stop_reason: "end_turn" })).toBeNull();
    expect(refusalFromMessage({ stop_reason: "tool_use" })).toBeNull();
    expect(refusalFromMessage({ stop_reason: null })).toBeNull();
  });

  it("carrega category/explanation do stop_details; tolera stop_details ausente", () => {
    const withDetails = refusalFromMessage({
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber", explanation: "x" },
    });
    expect(withDetails).toBeInstanceOf(ModelRefusalError);
    expect(withDetails?.category).toBe("cyber");
    expect(withDetails?.explanation).toBe("x");
    expect(withDetails?.message).toContain("o modelo recusou a análise");

    const bare = refusalFromMessage({ stop_reason: "refusal" });
    expect(bare?.category).toBeNull();
    expect(bare?.explanation).toBeNull();
  });
});

describe("anthropic adapter — recusa do modelo (#524)", () => {
  it("stop_reason 'refusal' → falha TIPADA (provider_error + refusal), tokens cobrados, sem toolInput", async () => {
    messagesCreate.mockResolvedValue(
      message({
        stop_reason: "refusal",
        stop_details: {
          type: "refusal",
          category: "cyber",
          explanation: "Pedido fora da política.",
        },
        // Mesmo que venha um tool_use parcial, a recusa é checada ANTES do content.
        content: [
          { type: "tool_use", id: "tu", name: "submit_prediction", input: {} },
        ],
      }),
    );

    const res = await anthropicProvider.runAnalysis(forcedRequest(FABLE));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe("provider_error");
    expect(res.stopReason).toBe("refusal");
    expect(res.refusal).toEqual({
      category: "cyber",
      explanation: "Pedido fora da política.",
    });
    expect(res.cause).toBeInstanceOf(ModelRefusalError);
    expect(res.message).toBe(
      "o modelo recusou a análise (category=cyber): Pedido fora da política.",
    );
    // A chamada foi paga: os tokens vão pro ai_calls/custo.
    expect(res.usage).toEqual({ inputTokens: 900, outputTokens: 40 });
    // outputPayload = a resposta crua (auditoria), inputPayload = o request enviado.
    expect((res.outputPayload as { stop_reason: string }).stop_reason).toBe(
      "refusal",
    );
    expect((res.inputPayload as { model: string }).model).toBe(
      "claude-fable-5-1",
    );
  });

  it("recusa no modo server-tool também vira falha tipada", async () => {
    messagesCreate.mockResolvedValue(
      message({ stop_reason: "refusal", stop_details: null }),
    );
    const res = await anthropicProvider.runAnalysis({
      ...forcedRequest(HAIKU),
      serverTool: { kind: "web_search", maxUses: 1 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.refusal).toEqual({ category: null, explanation: null });
    expect(res.stopReason).toBe("refusal");
  });

  it("resposta normal segue ok (a checagem não afeta o caminho feliz)", async () => {
    messagesCreate.mockResolvedValue(
      message({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tu",
            name: "submit_prediction",
            input: { recommendation: "pass" },
          },
        ],
      }),
    );
    const res = await anthropicProvider.runAnalysis(forcedRequest(FABLE));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.toolInput).toEqual({ recommendation: "pass" });
  });
});

describe("anthropic adapter — opções por request (#524)", () => {
  it("adaptive sem prazo: timeout escalado por max_tokens/effort como 2º argumento", async () => {
    messagesCreate.mockResolvedValue(message({}));
    await anthropicProvider.runAnalysis(forcedRequest(FABLE));
    expect(messagesCreate.mock.calls[0]).toHaveLength(2);
    // 16000 tokens × 0.75 (high) / 60 tok/s + 15s = 215s.
    expect(adaptiveTimeoutMs(16000, "high")).toBe(215_000);
    expect(messagesCreate.mock.calls[0][1]).toEqual({
      timeout: 215_000,
      maxRetries: 2,
    });
  });

  it("temperature sem prazo: chamada com 1 argumento só (opções do client, como antes)", async () => {
    messagesCreate.mockResolvedValue(message({}));
    await anthropicProvider.runAnalysis(forcedRequest(HAIKU));
    expect(messagesCreate.mock.calls[0]).toHaveLength(1);
  });

  it("com prazo: timeout cortado pelo restante − margem, sem retry que não caiba", async () => {
    messagesCreate.mockResolvedValue(message({}));
    await anthropicProvider.runAnalysis({
      ...forcedRequest(FABLE),
      deadlineAt: Date.now() + 100_000,
    });
    const opts = messagesCreate.mock.calls[0][1] as {
      timeout: number;
      maxRetries: number;
    };
    // ~95s restantes (100s − 5s de margem): bem abaixo dos 215s escalados.
    expect(opts.timeout).toBeLessThanOrEqual(95_000);
    expect(opts.timeout).toBeGreaterThan(90_000);
    expect(opts.maxRetries).toBe(0);
  });

  it("prazo já esgotado: NÃO chama o SDK e devolve timeout sem tokens", async () => {
    const res = await anthropicProvider.runAnalysis({
      ...forcedRequest(HAIKU),
      deadlineAt: Date.now() + 1_000,
    });
    expect(messagesCreate).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe("timeout");
    expect(res.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("timeout do SDK: status timeout, tokens 0/0 marcados como desconhecidos", async () => {
    messagesCreate.mockRejectedValue(
      new Anthropic.APIConnectionTimeoutError({ message: "Request timed out." }),
    );
    const res = await anthropicProvider.runAnalysis(forcedRequest(FABLE));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe("timeout");
    expect(res.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(res.outputPayload).toMatchObject({ usageUnknown: true });
  });
});
