import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MODEL_REGISTRY, type AIModel } from "@/lib/ai/models";
import type {
  AIProvider,
  AnalysisErr,
  AnalysisOk,
  AnalysisRequest,
} from "@/lib/ai/providers/types";

// O wrapper das versões adotadas (ADR 0062) com um provider FAKE: nenhuma chamada
// real. O resolver e a marcação no banco são mockados.
vi.mock("@/lib/ai/model-versions/active", () => ({
  resolveActiveModel: vi.fn(),
  resetActiveModelMemo: vi.fn(),
}));
vi.mock("@/lib/db/queries/model-versions", () => ({
  markModelVersionFailed: vi.fn(async () => true),
}));

import {
  resetActiveModelMemo,
  resolveActiveModel,
} from "@/lib/ai/model-versions/active";
import { markModelVersionFailed } from "@/lib/db/queries/model-versions";

import { withAdoptedVersions } from "../adopted-versions";

const resolveMock = vi.mocked(resolveActiveModel);
const markMock = vi.mocked(markModelVersionFailed);
const resetMock = vi.mocked(resetActiveModelMemo);

const SONNET = MODEL_REGISTRY["claude-sonnet-5-5"];
const SONNET_56: AIModel = {
  ...SONNET,
  id: "claude-sonnet-5-6",
  adopted: { priceEstimated: true, pinnedId: "claude-sonnet-5-5" },
};

function req(over: Partial<AnalysisRequest> = {}): AnalysisRequest {
  return {
    model: SONNET,
    system: "s",
    userMessage: "u",
    tool: { name: "t", inputSchema: { type: "object" } },
    toolName: "t",
    maxTokens: 1000,
    effort: "low",
    deadlineAt: 123_456,
    ...over,
  };
}

function ok(model: AIModel): AnalysisOk {
  return {
    ok: true,
    toolInput: { a: 1 },
    usage: { inputTokens: 10, outputTokens: 5 },
    inputPayload: { model: model.id },
    outputPayload: { content: [] },
    stopReason: "tool_use",
    latencyMs: 7,
    servedModel: model,
  };
}

function err(model: AIModel, over: Partial<AnalysisErr> = {}): AnalysisErr {
  return {
    ok: false,
    status: "provider_error",
    message: "boom",
    usage: { inputTokens: 0, outputTokens: 0 },
    inputPayload: {},
    outputPayload: { error: {} },
    stopReason: null,
    latencyMs: 3,
    servedModel: model,
    ...over,
  };
}

// Responde por modelo pedido: `byModel[id]` (função do request).
function fakeProvider(
  byModel: Record<string, (r: AnalysisRequest) => AnalysisOk | AnalysisErr>,
  providerKey = "anthropic",
) {
  const runAnalysis = vi.fn(async (r: AnalysisRequest) => {
    const f = byModel[r.model.id];
    if (!f) throw new Error(`modelo inesperado ${r.model.id}`);
    return f(r);
  });
  const provider: AIProvider = { providerKey, hasKey: () => true, runAnalysis };
  return { provider, runAnalysis };
}

const overloaded = () =>
  new Anthropic.InternalServerError(
    529,
    { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
    "Overloaded",
    new Headers(),
  );

beforeEach(() => {
  resolveMock.mockReset();
  resolveMock.mockResolvedValue(SONNET_56);
  markMock.mockReset();
  markMock.mockResolvedValue(true);
  resetMock.mockReset();
});

describe("withAdoptedVersions — repasse", () => {
  it("nada adotado (a ativa é a conferida) → repassa o pedido como está", async () => {
    resolveMock.mockResolvedValue(SONNET);
    const { provider, runAnalysis } = fakeProvider({ [SONNET.id]: () => ok(SONNET) });
    const r = await withAdoptedVersions(provider).runAnalysis(req());
    expect(r.servedModel).toBe(SONNET);
    expect(runAnalysis).toHaveBeenCalledTimes(1);
    expect(runAnalysis.mock.calls[0][0].model).toBe(SONNET);
  });

  it("pedido que não é a conferida da família (ex.: já uma versão adotada) → repassa sem resolver", async () => {
    const { provider, runAnalysis } = fakeProvider({ [SONNET_56.id]: () => ok(SONNET_56) });
    await withAdoptedVersions(provider).runAnalysis(req({ model: SONNET_56 }));
    expect(resolveMock).not.toHaveBeenCalled();
    expect(runAnalysis.mock.calls[0][0].model).toBe(SONNET_56);
  });

  it("modelo de outro provider → repassa sem resolver", async () => {
    const gpt: AIModel = { ...SONNET, id: "gpt-x", provider: "openai" };
    const { provider } = fakeProvider({ "gpt-x": () => ok(gpt) }, "openai");
    await withAdoptedVersions(provider).runAnalysis(req({ model: gpt }));
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it("preserva providerKey e hasKey", () => {
    const { provider } = fakeProvider({});
    const w = withAdoptedVersions(provider);
    expect(w.providerKey).toBe("anthropic");
    expect(w.hasKey()).toBe(true);
  });
});

describe("withAdoptedVersions — chamada na adotada", () => {
  it("sucesso → servedModel é a adotada, o resto do pedido igual (prazo incluso)", async () => {
    const { provider, runAnalysis } = fakeProvider({ [SONNET_56.id]: () => ok(SONNET_56) });
    const r = await withAdoptedVersions(provider).runAnalysis(req());
    expect(r.ok).toBe(true);
    expect(r.servedModel).toBe(SONNET_56);
    expect(resolveMock).toHaveBeenCalledWith("sonnet");
    expect(runAnalysis).toHaveBeenCalledTimes(1);
    expect(runAnalysis.mock.calls[0][0]).toEqual({ ...req(), model: SONNET_56 });
  });

  it("falha SEM rejeição (timeout, 429, 5xx) → devolve como está, sem refazer nem marcar", async () => {
    for (const status of ["timeout", "rate_limited", "provider_error"] as const) {
      const { provider, runAnalysis } = fakeProvider({
        [SONNET_56.id]: () => err(SONNET_56, { status }),
      });
      const r = await withAdoptedVersions(provider).runAnalysis(req());
      expect(r).toMatchObject({ ok: false, status, servedModel: SONNET_56 });
      expect(runAnalysis).toHaveBeenCalledTimes(1);
    }
    expect(markMock).not.toHaveBeenCalled();
  });

  it("rejeição que GASTOU tokens (pause_turn) → não refaz: refazer perderia o custo", async () => {
    const { provider, runAnalysis } = fakeProvider({
      [SONNET_56.id]: () =>
        err(SONNET_56, {
          rejection: "invalid_request",
          usage: { inputTokens: 500, outputTokens: 20 },
        }),
    });
    const r = await withAdoptedVersions(provider).runAnalysis(req());
    expect(r.servedModel).toBe(SONNET_56);
    expect(runAnalysis).toHaveBeenCalledTimes(1);
    expect(markMock).not.toHaveBeenCalled();
  });
});

describe("withAdoptedVersions — fallback pra conferida", () => {
  it.each(["not_found", "invalid_request"] as const)(
    "rejeição %s e a conferida passa → devolve a conferida, marca a adotada e zera o memo",
    async (rejection) => {
      const { provider, runAnalysis } = fakeProvider({
        [SONNET_56.id]: () => err(SONNET_56, { rejection, message: "404 model not found" }),
        [SONNET.id]: () => ok(SONNET),
      });
      const r = await withAdoptedVersions(provider).runAnalysis(req());
      expect(r.ok).toBe(true);
      expect(r.servedModel).toBe(SONNET);
      expect(runAnalysis).toHaveBeenCalledTimes(2);
      // Mesmo pedido, mesmo prazo, na conferida.
      expect(runAnalysis.mock.calls[1][0]).toEqual(req());
      expect(r.outputPayload.adoptedFallback).toEqual({
        model: "claude-sonnet-5-6",
        status: "provider_error",
        rejection,
        error: "404 model not found",
      });
      // O resto do payload cru segue lá (o snippet de tool_missing lê `.content`).
      expect(r.outputPayload.content).toEqual([]);
      expect(markMock).toHaveBeenCalledTimes(1);
      expect(markMock.mock.calls[0][0]).toBe("claude-sonnet-5-6");
      expect(markMock.mock.calls[0][1]).toContain("a conferida passou");
      expect(resetMock).toHaveBeenCalledTimes(1);
    },
  );

  it("403 (permissão da conta, rejection not_found) e a conferida TAMBÉM falha → devolve a falha da conferida, sem marcar", async () => {
    const { provider } = fakeProvider({
      [SONNET_56.id]: () => err(SONNET_56, { rejection: "not_found", message: "403" }),
      [SONNET.id]: () => err(SONNET, { rejection: "not_found", message: "403 de novo" }),
    });
    const r = await withAdoptedVersions(provider).runAnalysis(req());
    expect(r).toMatchObject({ ok: false, servedModel: SONNET, message: "403 de novo" });
    expect(r.outputPayload.adoptedFallback).toMatchObject({ model: "claude-sonnet-5-6" });
    expect(markMock).not.toHaveBeenCalled();
    expect(resetMock).not.toHaveBeenCalled();
  });

  it("400 de crédito esgotado na adotada E na conferida → sem marcar, devolve a falha da conferida", async () => {
    const credits = "400: Your credit balance is too low to access the Anthropic API.";
    const { provider, runAnalysis } = fakeProvider({
      [SONNET_56.id]: () => err(SONNET_56, { rejection: "invalid_request", message: credits }),
      [SONNET.id]: () => err(SONNET, { rejection: "invalid_request", message: credits }),
    });
    const r = await withAdoptedVersions(provider).runAnalysis(req());
    expect(runAnalysis).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({
      ok: false,
      status: "provider_error",
      rejection: "invalid_request",
      message: credits,
      servedModel: SONNET,
    });
    expect(markMock).not.toHaveBeenCalled();
  });

  it("529 overloaded sem tokens → cai na conferida SEM marcar", async () => {
    const { provider, runAnalysis } = fakeProvider({
      [SONNET_56.id]: () =>
        err(SONNET_56, { status: "provider_error", cause: overloaded(), message: "529: Overloaded" }),
      [SONNET.id]: () => ok(SONNET),
    });
    const r = await withAdoptedVersions(provider).runAnalysis(req());
    expect(r.servedModel).toBe(SONNET);
    expect(runAnalysis).toHaveBeenCalledTimes(2);
    expect(r.outputPayload.adoptedFallback).toEqual({
      model: "claude-sonnet-5-6",
      status: "provider_error",
      overloaded: true,
      error: "529: Overloaded",
    });
    expect(markMock).not.toHaveBeenCalled();
  });

  it("marcar no banco que falha NUNCA derruba a análise (que já veio da conferida)", async () => {
    markMock.mockRejectedValue(new Error("neon down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { provider } = fakeProvider({
      [SONNET_56.id]: () => err(SONNET_56, { rejection: "not_found" }),
      [SONNET.id]: () => ok(SONNET),
    });
    const r = await withAdoptedVersions(provider).runAnalysis(req());
    expect(r.ok).toBe(true);
    expect(r.servedModel).toBe(SONNET);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
