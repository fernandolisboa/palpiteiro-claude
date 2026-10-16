import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MODEL_REGISTRY } from "@/lib/ai/models";
import { ALLOWED_DOMAINS } from "@/lib/providers/news/allowed-domains";

// Sondagem (ADR 0062) pelo adapter Anthropic CRU, com o client mockado (nenhuma
// chamada real) e o insert de ai_calls capturado.
const messagesCreate = vi.fn();
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({ messages: { create: messagesCreate } }),
}));

const inserted: Record<string, unknown>[] = [];
const insertFails = { value: false };
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          if (insertFails.value) throw new Error("insert falhou");
          inserted.push(v);
          return [{ id: `call-${inserted.length}` }];
        },
      }),
    }),
  },
}));

import { adoptedModel, pricingOf } from "../active";
import {
  PROBE_PROMPT_VERSION,
  PROBE_SEARCH_PROMPT_VERSION,
  probeModelVersion,
} from "../probe";

function candidate(id: string, pinnedId: keyof typeof MODEL_REGISTRY) {
  const pinned = MODEL_REGISTRY[pinnedId];
  return adoptedModel({ id, pinned, pricing: pricingOf(pinned), priceConfirmed: false });
}

const SONNET_56 = candidate("claude-sonnet-5-6", "claude-sonnet-5-5");
const HAIKU_56 = candidate("claude-haiku-5-6", "claude-haiku-5-5");

function message(content: unknown[], over: Record<string, unknown> = {}) {
  return {
    id: "m",
    type: "message",
    role: "assistant",
    model: "x",
    content,
    stop_reason: "tool_use",
    stop_details: null,
    usage: { input_tokens: 1000, output_tokens: 100 },
    ...over,
  };
}

const answer = (n: unknown) =>
  message([{ type: "tool_use", id: "t", name: "submit_probe", input: { answer: n } }]);

const headers = new Headers();

beforeEach(() => {
  messagesCreate.mockReset();
  inserted.length = 0;
  insertFails.value = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("probeModelVersion — chamada de tool", () => {
  it("2+3 = 5 → passa; loga em ai_calls sem usuário e sem jogo, custo pelo preço herdado", async () => {
    messagesCreate.mockResolvedValue(answer(5));
    const out = await probeModelVersion(SONNET_56, Date.now() + 60_000);
    expect(out).toEqual({ kind: "pass", aiCallId: "call-1" });

    const [params] = messagesCreate.mock.calls[0];
    // Formato de produção: adaptive, tool_choice auto, effort low, max_tokens 2048.
    expect(params).toMatchObject({
      model: "claude-sonnet-5-6",
      max_tokens: 2048,
      tool_choice: { type: "auto" },
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
    });
    expect(params.tools[0].name).toBe("submit_probe");

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      userId: null,
      matchId: null,
      provider: "anthropic",
      model: "claude-sonnet-5-6",
      promptVersion: PROBE_PROMPT_VERSION,
      status: "ok",
      inputTokens: 1000,
      outputTokens: 100,
      // 1000 × $2 + 100 × $10 por 1M (preço do Sonnet 5.5).
      costUsd: "0.003000",
      errorMessage: null,
    });
  });

  it("resposta errada → reprova (invalid_output)", async () => {
    messagesCreate.mockResolvedValue(answer(6));
    const out = await probeModelVersion(SONNET_56);
    expect(out).toMatchObject({ kind: "fail", reason: expect.stringContaining("resposta errada") });
    expect(inserted[0]).toMatchObject({ status: "invalid_output" });
  });

  it("saída fora do schema → reprova", async () => {
    messagesCreate.mockResolvedValue(answer("cinco"));
    const out = await probeModelVersion(SONNET_56);
    expect(out).toMatchObject({ kind: "fail", reason: expect.stringContaining("saída inválida") });
  });

  it("não chamou o tool → reprova (tool_missing)", async () => {
    messagesCreate.mockResolvedValue(
      message([{ type: "text", text: "5" }], { stop_reason: "end_turn" }),
    );
    const out = await probeModelVersion(SONNET_56);
    expect(out).toMatchObject({ kind: "fail" });
    expect(inserted[0]).toMatchObject({ status: "tool_missing" });
  });

  it("recusa do modelo → reprova", async () => {
    messagesCreate.mockResolvedValue(message([], { stop_reason: "refusal" }));
    expect(await probeModelVersion(SONNET_56)).toMatchObject({ kind: "fail" });
  });

  it.each([
    ["404", new Anthropic.NotFoundError(404, undefined, "nf", headers)],
    ["400", new Anthropic.BadRequestError(400, undefined, "bad", headers)],
  ])("%s → reprova (rejeição)", async (_l, e) => {
    messagesCreate.mockRejectedValue(e);
    const out = await probeModelVersion(SONNET_56);
    expect(out).toMatchObject({ kind: "fail", reason: expect.stringContaining("recusou o pedido") });
    expect(inserted[0]).toMatchObject({ status: "provider_error", promptVersion: PROBE_PROMPT_VERSION });
  });

  it.each([
    ["500", new Anthropic.InternalServerError(500, undefined, "x", headers), "provider_error"],
    ["429", new Anthropic.RateLimitError(429, undefined, "x", headers), "rate_limited"],
    ["timeout", new Anthropic.APIConnectionTimeoutError({ message: "t" }), "timeout"],
  ])("%s → transitório (tenta amanhã)", async (_l, e, status) => {
    messagesCreate.mockRejectedValue(e);
    const out = await probeModelVersion(SONNET_56);
    expect(out).toMatchObject({ kind: "transient", reason: expect.stringContaining(status) });
  });

  it("insert de auditoria que falha não decide a sondagem", async () => {
    insertFails.value = true;
    messagesCreate.mockResolvedValue(answer(5));
    expect(await probeModelVersion(SONNET_56)).toEqual({ kind: "pass", aiCallId: null });
  });

  it("Opus e Sonnet não testam web search (uma chamada só)", async () => {
    messagesCreate.mockResolvedValue(answer(5));
    await probeModelVersion(SONNET_56);
    expect(messagesCreate).toHaveBeenCalledTimes(1);
  });
});

describe("probeModelVersion — Haiku com web search (S6)", () => {
  const searchResult = {
    type: "web_search_tool_result",
    tool_use_id: "s",
    content: [{ type: "web_search_result", title: "T", url: "https://ge.globo.com/x" }],
  };

  it("segunda chamada no formato de notícias/cartões; passa com bloco web_search_tool_result", async () => {
    messagesCreate
      .mockResolvedValueOnce(answer(5))
      .mockResolvedValueOnce(message([searchResult], { stop_reason: "end_turn" }));
    const out = await probeModelVersion(HAIKU_56);
    expect(out).toEqual({ kind: "pass", aiCallId: "call-2" });
    const [params] = messagesCreate.mock.calls[1];
    expect(params).toMatchObject({
      model: "claude-haiku-5-6",
      output_config: { effort: "medium" },
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 1,
          allowed_domains: [...ALLOWED_DOMAINS],
        },
      ],
    });
    expect(inserted.map((r) => r.promptVersion)).toEqual([
      PROBE_PROMPT_VERSION,
      PROBE_SEARCH_PROMPT_VERSION,
    ]);
  });

  it("sem bloco de busca → reprova", async () => {
    messagesCreate
      .mockResolvedValueOnce(answer(5))
      .mockResolvedValueOnce(message([{ type: "text", text: "sei lá" }], { stop_reason: "end_turn" }));
    const out = await probeModelVersion(HAIKU_56);
    expect(out).toMatchObject({ kind: "fail", reason: expect.stringContaining("web") });
    expect(inserted[1]).toMatchObject({ status: "tool_missing" });
  });

  it("a chamada de tool reprovada não chega a buscar", async () => {
    messagesCreate.mockResolvedValueOnce(answer(4));
    expect(await probeModelVersion(HAIKU_56)).toMatchObject({ kind: "fail" });
    expect(messagesCreate).toHaveBeenCalledTimes(1);
  });
});
