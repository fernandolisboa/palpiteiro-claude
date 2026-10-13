import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisRequest, AnalysisResult } from "@/lib/ai/providers/types";

const insertValues = vi.fn((..._args: unknown[]) => {});
vi.mock("@/lib/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: (...args: unknown[]) => {
        insertValues(...args);
        return { returning: vi.fn(() => Promise.resolve([{ id: "narrate-ok-1" }])) };
      },
    })),
  },
}));
const persistAiCallError = vi.fn(async (..._args: unknown[]) => "narrate-err-1");
vi.mock("@/lib/ai/ai-call-logging", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/ai-call-logging")>()),
  persistAiCallError: (...args: unknown[]) => persistAiCallError(...args),
}));
const fakeProvider = {
  providerKey: "anthropic",
  hasKey: vi.fn(() => true),
  runAnalysis: vi.fn(async (_r: AnalysisRequest): Promise<AnalysisResult> => ok(GOOD)),
};
vi.mock("@/lib/ai/providers", () => ({ getProviderForModel: vi.fn(() => fakeProvider) }));
const getPreferredModelId = vi.fn(async (_u: string): Promise<string | null> => null);
vi.mock("@/lib/db/queries/users", () => ({
  getPreferredModelId: (u: string) => getPreferredModelId(u),
}));
const getDefaultModelId = vi.fn(async () => "claude-sonnet-4-5-20250929");
vi.mock("@/lib/db/queries/ai-config", () => ({
  getDefaultModelId: () => getDefaultModelId(),
}));

import { USER_PALPITE_NARRATE_VERSION } from "@/lib/ai/user-palpite/narrate-cartridge";
import { NARRATE_MAX_TOKENS, narratePalpite } from "@/lib/ai/user-palpite/narrate";
import { templatedPalpiteNarration } from "@/lib/ai/user-palpite/fallback";

import { narrationInput } from "./fixtures";

const INPUT = narrationInput();
const GOOD = {
  veredito: "em_parte",
  resumo: "O placar é possível, mas não está entre os mais prováveis.",
  pontos: ["A forma do Flamengo não confirma a sequência de vitórias."],
  discordancias: [{ claimIndex: 1, texto: "Nos últimos 5 jogos foram 1 vitória, 2 empates e 2 derrotas." }],
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
  };
}

const ARGS = { input: INPUT, userId: "u-1", matchId: "m-1", isAdmin: false };

beforeEach(() => {
  vi.clearAllMocks();
  fakeProvider.hasKey.mockReturnValue(true);
  getPreferredModelId.mockResolvedValue(null);
  getDefaultModelId.mockResolvedValue("claude-sonnet-4-5-20250929");
});

describe("narratePalpite", () => {
  it("caminho ok: narração do LLM, row ok com a versão do prompt", async () => {
    const r = await narratePalpite(ARGS);
    expect(r).toEqual({ narration: GOOD, source: "llm", aiCallId: "narrate-ok-1" });
    expect(insertValues.mock.calls[0][0]).toMatchObject({
      status: "ok",
      promptVersion: USER_PALPITE_NARRATE_VERSION,
      model: "claude-sonnet-4-5-20250929",
    });
  });

  it.each([
    ["fidelidade", ok({ ...GOOD, resumo: "chance de 77,7%" }), "invalid_output", /^fidelity:/],
    ["linguagem de valor", ok({ ...GOOD, pontos: ["tem valor na odd"] }), "invalid_output", /^value_language/],
    ["Zod", ok({ ...GOOD, extra: 1 }), "invalid_output", /./],
    ["tool ausente", ok(undefined), "tool_missing", /submit_palpite_review/],
  ] as const)("%s → template com a row %s", async (_l, result, status, msg) => {
    fakeProvider.runAnalysis.mockResolvedValueOnce(result as AnalysisResult);
    const r = await narratePalpite(ARGS);
    expect(r.source).toBe("template");
    expect(r.narration).toEqual(templatedPalpiteNarration(INPUT));
    expect(r.aiCallId).toBe("narrate-err-1");
    const row = persistAiCallError.mock.calls[0][0] as { status: string; errorMessage: string };
    expect(row.status).toBe(status);
    expect(row.errorMessage).toMatch(msg);
  });

  it("erro do provider → template com o status do provider", async () => {
    fakeProvider.runAnalysis.mockResolvedValueOnce({
      ok: false,
      status: "provider_error",
      message: "boom",
      usage: { inputTokens: 0, outputTokens: 0 },
      inputPayload: {},
      outputPayload: {},
      stopReason: null,
      latencyMs: 1,
    });
    const r = await narratePalpite(ARGS);
    expect(r.source).toBe("template");
    expect(persistAiCallError.mock.calls[0][0]).toMatchObject({ status: "provider_error" });
  });

  it("sem chave → template sem chamada", async () => {
    fakeProvider.hasKey.mockReturnValue(false);
    const r = await narratePalpite(ARGS);
    expect(r.source).toBe("template");
    expect(fakeProvider.runAnalysis).not.toHaveBeenCalled();
    expect(persistAiCallError.mock.calls[0][0]).toMatchObject({ status: "provider_error" });
  });

  it("sem tempo → timeout sem chamada", async () => {
    const r = await narratePalpite({ ...ARGS, deadlineAt: Date.now() + 1000 });
    expect(r.source).toBe("template");
    expect(fakeProvider.runAnalysis).not.toHaveBeenCalled();
    expect(persistAiCallError.mock.calls[0][0]).toMatchObject({
      status: "timeout",
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("modelo adaptive: effort low, sem temperature, orçamento de 2000 tokens", async () => {
    getPreferredModelId.mockResolvedValue("claude-opus-5-5");
    await narratePalpite(ARGS);
    const req = fakeProvider.runAnalysis.mock.calls[0][0];
    expect(req.model.id).toBe("claude-opus-5-5");
    expect(req.effort).toBe("low");
    expect(req).not.toHaveProperty("temperature");
    expect(req.maxTokens).toBe(NARRATE_MAX_TOKENS);
  });

  it("modelo temperature: temperatura do registry, sem effort", async () => {
    await narratePalpite(ARGS);
    const req = fakeProvider.runAnalysis.mock.calls[0][0];
    expect(req.temperature).toBe(0.3);
    expect(req).not.toHaveProperty("effort");
  });

  it("preferência admin-only pra não-admin cai no default; admin usa a preferência", async () => {
    getPreferredModelId.mockResolvedValue("claude-fable-5-1");
    await narratePalpite(ARGS);
    expect(fakeProvider.runAnalysis.mock.calls[0][0].model.id).toBe(
      "claude-sonnet-4-5-20250929",
    );
    await narratePalpite({ ...ARGS, isAdmin: true });
    expect(fakeProvider.runAnalysis.mock.calls[1][0].model.id).toBe("claude-fable-5-1");
  });

  it("nunca lança: erro inesperado vira template", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getPreferredModelId.mockRejectedValue(new Error("db down"));
    const r = await narratePalpite(ARGS);
    expect(r).toEqual({
      narration: templatedPalpiteNarration(INPUT),
      source: "template",
      aiCallId: null,
    });
  });
});
