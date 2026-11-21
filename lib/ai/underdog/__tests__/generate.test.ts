import { beforeEach, describe, expect, it, vi } from "vitest";

import { MODEL_REGISTRY } from "@/lib/ai/models";
import type { AnalysisRequest, AnalysisResult } from "@/lib/ai/providers/types";

// Nenhuma chamada real: provider, banco e preferência de modelo mockados.
const insertValues = vi.fn((..._args: unknown[]) => {});
let insertSeq = 0;
vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: (...args: unknown[]) => {
        insertValues(...args);
        return {
          returning: vi.fn(() =>
            Promise.resolve([{ id: `ok-${++insertSeq}` }])
          ),
        };
      },
    })),
  },
}));
const persistAiCallError = vi.fn(async (..._args: unknown[]) => "err-1");
vi.mock("@/lib/ai/ai-call-logging", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/ai-call-logging")>()),
  persistAiCallError: (...args: unknown[]) => persistAiCallError(...args),
}));
const fakeProvider = {
  providerKey: "anthropic",
  hasKey: vi.fn(() => true),
  runAnalysis: vi.fn(
    async (_r: AnalysisRequest): Promise<AnalysisResult> => ok(null)
  ),
};
vi.mock("@/lib/ai/providers", () => ({
  getProviderForModel: vi.fn(() => fakeProvider),
}));
vi.mock("@/lib/db/queries/users", () => ({
  getPreferredModelId: vi.fn(async () => null),
}));
vi.mock("@/lib/db/queries/ai-config", () => ({
  getDefaultModelId: vi.fn(async () => "claude-sonnet-5-5"),
}));

import { UNDERDOG_ADVOCATE_VERSION } from "@/lib/ai/underdog/advocate-cartridge";
import { templatedNarrative } from "@/lib/ai/underdog/fallback";
import {
  ADVOCATE_MAX_TOKENS,
  generateUnderdogCase,
  REVIEW_MAX_TOKENS,
} from "@/lib/ai/underdog/generate";
import { UNDERDOG_REVIEW_VERSION } from "@/lib/ai/underdog/review-cartridge";

import { block, facts, goodDraft, goodReview, TEAMS } from "./fixtures";

function ok(
  toolInput: unknown,
  model = MODEL_REGISTRY["claude-sonnet-5-5"]
): AnalysisResult {
  return {
    ok: true,
    toolInput,
    usage: {
      inputTokens: 1000,
      outputTokens: 200,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 300,
    },
    inputPayload: { req: 1 },
    outputPayload: { res: 1 },
    stopReason: "tool_use",
    latencyMs: 900,
    servedModel: model,
  };
}
const haiku = (toolInput: unknown) =>
  ok(toolInput, MODEL_REGISTRY["claude-haiku-5-5"]);

const ARGS = () => ({
  facts: facts(),
  block: block(),
  teams: TEAMS,
  userId: "u-1",
  matchId: "m-1",
  isAdmin: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  insertSeq = 0;
  fakeProvider.hasKey.mockReturnValue(true);
});

describe("generateUnderdogCase", () => {
  it("caminho ok: duas rows ok em ai_calls, com as versões, custo e modelos", async () => {
    fakeProvider.runAnalysis
      .mockResolvedValueOnce(ok(goodDraft()))
      .mockResolvedValueOnce(haiku(goodReview()));
    const r = await generateUnderdogCase(ARGS());
    expect(r).toMatchObject({
      source: "llm",
      failure: "none",
      persist: true,
      advocateAiCallId: "ok-1",
      reviewerAiCallId: "ok-2",
    });
    expect(r.narrative.advocateFamily).toBe("Sonnet");
    const rows = insertValues.mock.calls.map(
      (c) => c[0] as Record<string, unknown>
    );
    expect(rows[0]).toMatchObject({
      status: "ok",
      promptVersion: UNDERDOG_ADVOCATE_VERSION,
      model: "claude-sonnet-5-5",
      userId: "u-1",
      matchId: "m-1",
      cacheReadInputTokens: 300,
    });
    expect(rows[1]).toMatchObject({
      status: "ok",
      promptVersion: UNDERDOG_REVIEW_VERSION,
      model: "claude-haiku-5-5",
    });
    expect(Number(rows[0].costUsd)).toBeGreaterThan(0);
    const [advReq, revReq] = fakeProvider.runAnalysis.mock.calls.map(
      (c) => c[0]
    );
    expect(advReq.maxTokens).toBe(ADVOCATE_MAX_TOKENS);
    expect(revReq.maxTokens).toBe(REVIEW_MAX_TOKENS);
    expect(revReq.model.id).toBe("claude-haiku-5-5");
    // Contexto limpo: o revisor não recebe o system do advogado.
    expect(revReq.system).not.toBe(advReq.system);
    expect(revReq.userMessage).not.toContain(advReq.system.slice(0, 40));
  });

  it("advogado falha (provider) → template sem chamar o revisor, infra, não grava", async () => {
    fakeProvider.runAnalysis.mockResolvedValueOnce({
      ok: false,
      status: "provider_error",
      message: "500",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
      inputPayload: {},
      outputPayload: {},
      latencyMs: 10,
      servedModel: MODEL_REGISTRY["claude-sonnet-5-5"],
    } as AnalysisResult);
    const r = await generateUnderdogCase(ARGS());
    expect(r).toMatchObject({
      source: "template",
      failure: "infra",
      persist: false,
    });
    expect(r.narrative).toEqual(templatedNarrative(facts(), TEAMS));
    expect(fakeProvider.runAnalysis).toHaveBeenCalledTimes(1);
    expect(persistAiCallError.mock.calls[0][0]).toMatchObject({
      status: "provider_error",
      promptVersion: UNDERDOG_ADVOCATE_VERSION,
    });
  });

  it("sem chave → infra, nada enviado", async () => {
    fakeProvider.hasKey.mockReturnValue(false);
    const r = await generateUnderdogCase(ARGS());
    expect(r).toMatchObject({ failure: "infra", persist: false });
    expect(fakeProvider.runAnalysis).not.toHaveBeenCalled();
  });

  it("prazo que não cabe → infra, nada enviado", async () => {
    const r = await generateUnderdogCase({
      ...ARGS(),
      deadlineAt: Date.now() + 500,
    });
    expect(r).toMatchObject({ failure: "infra", persist: false });
    expect(fakeProvider.runAnalysis).not.toHaveBeenCalled();
    expect(persistAiCallError.mock.calls[0][0]).toMatchObject({
      status: "timeout",
    });
  });

  it("Zod do advogado reprova → template que grava (guards)", async () => {
    fakeProvider.runAnalysis.mockResolvedValueOnce(
      ok({ ...goodDraft(), extra: 1 })
    );
    const r = await generateUnderdogCase(ARGS());
    expect(r).toMatchObject({
      source: "template",
      failure: "guards",
      persist: true,
    });
    expect(fakeProvider.runAnalysis).toHaveBeenCalledTimes(1);
  });

  it("ferramenta ausente no advogado → infra", async () => {
    fakeProvider.runAnalysis.mockResolvedValueOnce(ok(undefined));
    const r = await generateUnderdogCase(ARGS());
    expect(r).toMatchObject({ failure: "infra", persist: false });
  });

  it("guardas cortam mais da metade → template que grava, row invalid_output, sem revisor", async () => {
    const draft = goodDraft();
    for (const i of [0, 1, 2])
      draft.frases[i] = { texto: "A odd é boa.", fatos: ["P1"] };
    fakeProvider.runAnalysis.mockResolvedValueOnce(ok(draft));
    const r = await generateUnderdogCase(ARGS());
    expect(r).toMatchObject({
      failure: "guards",
      persist: true,
      advocateAiCallId: "err-1",
    });
    expect(r.narrative.total).toBe(4);
    expect(fakeProvider.runAnalysis).toHaveBeenCalledTimes(1);
    expect(persistAiCallError.mock.calls[0][0]).toMatchObject({
      status: "invalid_output",
    });
  });

  it.each([
    ["Zod", haiku({ ...goodReview(), extra: 1 })],
    ["ferramenta ausente", haiku(undefined)],
    [
      "índice faltando",
      haiku({
        ...goodReview(),
        avaliacoes: goodReview().avaliacoes.slice(0, 2),
      }),
    ],
  ])("revisor falha (%s) → template que NÃO grava", async (_l, review) => {
    fakeProvider.runAnalysis
      .mockResolvedValueOnce(ok(goodDraft()))
      .mockResolvedValueOnce(review);
    const r = await generateUnderdogCase(ARGS());
    expect(r).toMatchObject({
      source: "template",
      failure: "infra",
      persist: false,
    });
    expect(r.advocateAiCallId).toBe("ok-1");
    expect(r.reviewerAiCallId).toBe("err-1");
  });

  it("revisor deixa menos de 2 apoiadas → template que grava", async () => {
    const review = goodReview();
    review.avaliacoes = review.avaliacoes.map((a, i) => ({
      ...a,
      veredito: i === 0 ? "apoiada" : "exagerada",
    }));
    fakeProvider.runAnalysis
      .mockResolvedValueOnce(ok(goodDraft()))
      .mockResolvedValueOnce(haiku(review));
    const r = await generateUnderdogCase(ARGS());
    expect(r).toMatchObject({
      source: "template",
      failure: "guards",
      persist: true,
    });
  });

  it("nunca lança: exceção do provider vira template infra", async () => {
    fakeProvider.runAnalysis.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await generateUnderdogCase(ARGS());
    expect(r).toMatchObject({
      source: "template",
      failure: "infra",
      persist: false,
    });
  });
});
