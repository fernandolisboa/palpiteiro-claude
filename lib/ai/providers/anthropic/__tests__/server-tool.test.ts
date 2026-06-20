import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AIModel } from "@/lib/ai/models";
import type { AnalysisRequest } from "@/lib/ai/providers/types";

// Modelo temperature-mode (Haiku do registry) — o que o provider de notícias usa.
const HAIKU: AIModel = {
  id: "claude-haiku-4-5",
  provider: "anthropic",
  label: "Haiku fixture",
  inputPricePerMTok: 1,
  outputPricePerMTok: 5,
  thinkingMode: "temperature",
  userSelectable: false,
};

// Mocka SÓ o shim @/lib/ai/anthropic (boundary mockável): o adapter importa
// getAnthropicClient DAQUI. hasKey vem de ./client (não relevante aqui — chamamos
// runAnalysis direto). NENHUM client real; sem ANTHROPIC_API_KEY.
const messagesCreate = vi.fn();
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: { create: messagesCreate },
  }),
}));

import { anthropicProvider } from "../index";

function serverToolRequest(): AnalysisRequest {
  return {
    model: HAIKU,
    system: "busque notícias",
    userMessage: "jogo: Flamengo x Fluminense",
    tool: { name: "news_noop", inputSchema: { type: "object" } },
    toolName: "news_noop",
    maxTokens: 4096,
    temperature: 0.3,
    serverTool: {
      kind: "web_search",
      allowedDomains: ["ge.globo.com"],
      maxUses: 1,
    },
  };
}

function message(overrides: Record<string, unknown>) {
  return {
    id: "msg-1",
    type: "message",
    role: "assistant",
    content: [],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 50 },
    ...overrides,
  };
}

beforeEach(() => {
  messagesCreate.mockReset();
});

describe("anthropic adapter — modo server-tool (web search, ADR 0032 / #377)", () => {
  it("devolve contentBlocks crus (pro provider andar atrás dos web_search_tool_result)", async () => {
    const blocks = [
      { type: "text", text: "Resumo" },
      {
        type: "web_search_tool_result",
        content: [{ type: "web_search_result", title: "T", url: "https://ge.globo.com/x" }],
      },
    ];
    messagesCreate.mockResolvedValue(message({ content: blocks, stop_reason: "end_turn" }));

    const res = await anthropicProvider.runAnalysis(serverToolRequest());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.contentBlocks).toEqual(blocks);
    expect(res.toolInput).toBeUndefined();
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    expect(messagesCreate).toHaveBeenCalledTimes(1);
  });

  it("pause_turn → reenvia [user, {assistant, content}] SEM 'Continue'; acumula tokens", async () => {
    const pausedContent = [{ type: "server_tool_use", id: "srv-1" }];
    const finalBlocks = [
      {
        type: "web_search_tool_result",
        content: [{ type: "web_search_result", title: "Final", url: "https://ge.globo.com/y" }],
      },
    ];
    messagesCreate
      .mockResolvedValueOnce(
        message({
          content: pausedContent,
          stop_reason: "pause_turn",
          usage: { input_tokens: 100, output_tokens: 40 },
        }),
      )
      .mockResolvedValueOnce(
        message({
          content: finalBlocks,
          stop_reason: "end_turn",
          usage: { input_tokens: 30, output_tokens: 20 },
        }),
      );

    const res = await anthropicProvider.runAnalysis(serverToolRequest());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(messagesCreate).toHaveBeenCalledTimes(2);
    // Reenvio: [user, {assistant, content do response pausado}] — sem mensagem "Continue".
    const secondCall = messagesCreate.mock.calls[1][0] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(secondCall.messages).toHaveLength(2);
    expect(secondCall.messages[0].role).toBe("user");
    expect(secondCall.messages[1].role).toBe("assistant");
    expect(secondCall.messages[1].content).toEqual(pausedContent);
    expect(JSON.stringify(secondCall.messages)).not.toContain("Continue");
    // Tokens acumulados das duas rodadas.
    expect(res.usage).toEqual({ inputTokens: 130, outputTokens: 60 });
    expect(res.contentBlocks).toEqual(finalBlocks);
  });

  it("laço de pause_turn é BOUNDED (~3 continuações) — nunca loop infinito", async () => {
    // Sempre pause_turn: o adapter deve parar no teto e devolver, não loopar.
    messagesCreate.mockResolvedValue(
      message({ content: [{ type: "server_tool_use" }], stop_reason: "pause_turn" }),
    );
    const res = await anthropicProvider.runAnalysis(serverToolRequest());
    expect(res.ok).toBe(true);
    // 1 chamada inicial + 3 continuações = 4 no máximo.
    expect(messagesCreate).toHaveBeenCalledTimes(4);
  });

  it("erro do SDK no modo server-tool → AnalysisErr classificado (não throw)", async () => {
    messagesCreate.mockRejectedValue(new Error("boom"));
    const res = await anthropicProvider.runAnalysis(serverToolRequest());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});
