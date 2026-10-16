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

  it("erro de conteúdo duas vezes seguidas → reprova; as duas chamadas logadas", async () => {
    messagesCreate.mockResolvedValue(answer(6));
    const out = await probeModelVersion(SONNET_56);
    expect(out).toMatchObject({
      kind: "fail",
      reason: expect.stringContaining("2ª tentativa"),
      aiCallId: "call-2",
    });
    expect(messagesCreate).toHaveBeenCalledTimes(2);
    expect(inserted.map((r) => [r.model, r.status])).toEqual([
      ["claude-sonnet-5-6", "invalid_output"],
      ["claude-sonnet-5-6", "invalid_output"],
    ]);
  });

  it("um erro de conteúdo e depois acerto → passa", async () => {
    messagesCreate
      .mockResolvedValueOnce(message([{ type: "text", text: "5" }], { stop_reason: "end_turn" }))
      .mockResolvedValueOnce(answer(5));
    expect(await probeModelVersion(SONNET_56)).toEqual({ kind: "pass", aiCallId: "call-2" });
    expect(messagesCreate).toHaveBeenCalledTimes(2);
    expect(inserted.map((r) => r.status)).toEqual(["tool_missing", "ok"]);
  });

  it.each([
    ["404", new Anthropic.NotFoundError(404, undefined, "nf", headers)],
    ["403", new Anthropic.PermissionDeniedError(403, undefined, "forbidden", headers)],
    ["400", new Anthropic.BadRequestError(400, undefined, "bad", headers)],
  ])("%s na versão e a conferida passa no mesmo pedido → reprova", async (_l, e) => {
    messagesCreate.mockRejectedValueOnce(e).mockResolvedValueOnce(answer(5));
    const out = await probeModelVersion(SONNET_56);
    expect(out).toMatchObject({
      kind: "fail",
      reason: expect.stringMatching(/recusou o pedido.*conferida passou/),
      // O id é o da chamada da versão, não o da contraprova.
      aiCallId: "call-1",
    });
    expect(messagesCreate.mock.calls.map(([p]) => p.model)).toEqual([
      "claude-sonnet-5-6",
      "claude-sonnet-5-5",
    ]);
    // A contraprova também é logada (mesmo prompt_version, sem usuário nem jogo).
    expect(inserted.map((r) => [r.model, r.status, r.promptVersion])).toEqual([
      ["claude-sonnet-5-6", "provider_error", PROBE_PROMPT_VERSION],
      ["claude-sonnet-5-5", "ok", PROBE_PROMPT_VERSION],
    ]);
    expect(inserted[1]).toMatchObject({ userId: null, matchId: null });
  });

  it("crédito esgotado (400 na versão E na conferida) → transitório, não reprova", async () => {
    messagesCreate.mockRejectedValue(
      new Anthropic.BadRequestError(
        400,
        undefined,
        "Your credit balance is too low to access the Anthropic API.",
        headers,
      ),
    );
    const out = await probeModelVersion(SONNET_56);
    expect(out).toMatchObject({
      kind: "transient",
      reason: expect.stringContaining("a conferida também falhou"),
      aiCallId: "call-1",
    });
    expect(messagesCreate).toHaveBeenCalledTimes(2);
    expect(inserted.map((r) => r.model)).toEqual(["claude-sonnet-5-6", "claude-sonnet-5-5"]);
  });

  it("403 da conta (na versão e na conferida) → transitório", async () => {
    messagesCreate.mockRejectedValue(
      new Anthropic.PermissionDeniedError(403, undefined, "forbidden", headers),
    );
    expect(await probeModelVersion(SONNET_56)).toMatchObject({ kind: "transient" });
  });

  it("erro de conteúdo e depois rejeição → contraprova na conferida", async () => {
    messagesCreate
      .mockResolvedValueOnce(answer(6))
      .mockRejectedValueOnce(new Anthropic.BadRequestError(400, undefined, "bad", headers))
      .mockResolvedValueOnce(answer(5));
    expect(await probeModelVersion(SONNET_56)).toMatchObject({ kind: "fail", aiCallId: "call-2" });
    expect(messagesCreate.mock.calls.map(([p]) => p.model)).toEqual([
      "claude-sonnet-5-6",
      "claude-sonnet-5-6",
      "claude-sonnet-5-5",
    ]);
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

  const noSearch = () =>
    message([{ type: "text", text: "sei lá" }], { stop_reason: "end_turn" });

  it("sem bloco de busca duas vezes → reprova", async () => {
    messagesCreate
      .mockResolvedValueOnce(answer(5))
      .mockResolvedValueOnce(noSearch())
      .mockResolvedValueOnce(noSearch());
    const out = await probeModelVersion(HAIKU_56);
    expect(out).toMatchObject({ kind: "fail", reason: expect.stringContaining("web") });
    expect(inserted.map((r) => r.status)).toEqual(["ok", "tool_missing", "tool_missing"]);
  });

  it("sem bloco de busca uma vez e depois com busca → passa", async () => {
    messagesCreate
      .mockResolvedValueOnce(answer(5))
      .mockResolvedValueOnce(noSearch())
      .mockResolvedValueOnce(message([searchResult], { stop_reason: "end_turn" }));
    expect(await probeModelVersion(HAIKU_56)).toEqual({ kind: "pass", aiCallId: "call-3" });
  });

  it("busca rejeitada na versão e a conferida busca → reprova; contraprova no formato de notícias", async () => {
    messagesCreate
      .mockResolvedValueOnce(answer(5))
      .mockRejectedValueOnce(new Anthropic.BadRequestError(400, undefined, "bad", headers))
      .mockResolvedValueOnce(message([searchResult], { stop_reason: "end_turn" }));
    expect(await probeModelVersion(HAIKU_56)).toMatchObject({ kind: "fail", aiCallId: "call-2" });
    const [control] = messagesCreate.mock.calls[2];
    expect(control).toMatchObject({
      model: "claude-haiku-5-5",
      tools: [{ type: "web_search_20250305", max_uses: 1 }],
    });
    expect(inserted[2]).toMatchObject({
      model: "claude-haiku-5-5",
      promptVersion: PROBE_SEARCH_PROMPT_VERSION,
      status: "ok",
    });
  });

  it("a chamada de tool reprovada não chega a buscar", async () => {
    messagesCreate.mockResolvedValue(answer(4));
    expect(await probeModelVersion(HAIKU_56)).toMatchObject({ kind: "fail" });
    expect(messagesCreate).toHaveBeenCalledTimes(2);
  });
});
