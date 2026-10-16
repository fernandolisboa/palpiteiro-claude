import { beforeEach, describe, expect, it, vi } from "vitest";

import { MODEL_REGISTRY, type AIModel } from "@/lib/ai/models";

// Spies/estado mutável criados via vi.hoisted (referenciáveis dentro dos factories de
// vi.mock, que são içados acima dos imports).
const h = vi.hoisted(() => ({
  runAnalysisSpy: vi.fn(),
  persistSpy: vi.fn(async () => {}),
  insertSpy: vi.fn(),
  state: { hasKey: true },
}));

vi.mock("@/lib/ai/providers", () => ({
  getProviderForModel: () => ({
    providerKey: "anthropic",
    hasKey: () => h.state.hasKey,
    runAnalysis: h.runAnalysisSpy,
  }),
}));
vi.mock("@/lib/ai/ai-call-logging", () => ({ persistAiCallError: h.persistSpy }));
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: async (row: unknown) => {
        h.insertSpy(row);
      },
    }),
  },
}));

import { extractCardCount } from "@/lib/settlement/extract-cards-from-web";

const REF = {
  league: "world_cup",
  kickoffAt: "2026-06-20T19:00:00Z",
  homeTeam: "Brasil",
  awayTeam: "Argentina",
};
const AUDIT = { userId: "u-1", matchId: "m-1" };
const HAIKU: AIModel = MODEL_REGISTRY["claude-haiku-5-5"];

// Resposta AnalysisOk simulada: bloco de texto com a contagem (ou null) + um bloco
// web_search_tool_result com as URLs citadas.
function okWith(countText: string | null, urls: string[]) {
  const contentBlocks: unknown[] = [];
  if (countText !== null) contentBlocks.push({ type: "text", text: countText });
  if (urls.length > 0) {
    contentBlocks.push({
      type: "web_search_tool_result",
      content: urls.map((url) => ({ title: "fonte", url })),
    });
  }
  return {
    ok: true,
    toolInput: undefined,
    usage: { inputTokens: 10, outputTokens: 5 },
    inputPayload: {},
    outputPayload: {},
    stopReason: "end_turn",
    latencyMs: 1,
    servedModel: HAIKU,
    contentBlocks,
  };
}

// A = pool BR (inclui ge.globo.com); B = pool INTL (inclui bbc.com). Roteia pelas
// allowedDomains do request pra dar respostas distintas a cada leitura.
function route(
  brResp: ReturnType<typeof okWith>,
  intlResp: ReturnType<typeof okWith>,
) {
  h.runAnalysisSpy.mockImplementation(
    async (req: { serverTool?: { allowedDomains?: string[] } }) => {
      const domains = req.serverTool?.allowedDomains ?? [];
      return domains.includes("bbc.com") ? intlResp : brResp;
    },
  );
}

beforeEach(() => {
  h.insertSpy.mockClear();
  h.runAnalysisSpy.mockReset();
  h.persistSpy.mockClear();
  h.state.hasKey = true;
});

describe("extractCardCount — reconciliação A≡B sobre pools disjuntos", () => {
  it("A≡B (5=5), ≥1 fonte cada, origens distintas (globo + bbc) → retorna 5", async () => {
    route(
      okWith("AMARELOS_TOTAL=5", ["https://ge.globo.com/jogo"]),
      okWith("AMARELOS_TOTAL=5", ["https://www.bbc.com/sport/jogo"]),
    );
    expect(await extractCardCount(REF, AUDIT)).toBe(5);
    expect(h.runAnalysisSpy).toHaveBeenCalledTimes(2);
  });

  it("A≠B (5 vs 4) → null (PENDENTE)", async () => {
    route(
      okWith("AMARELOS_TOTAL=5", ["https://ge.globo.com/jogo"]),
      okWith("AMARELOS_TOTAL=4", ["https://www.bbc.com/sport/jogo"]),
    );
    expect(await extractCardCount(REF, AUDIT)).toBeNull();
  });

  it("uma leitura sem contagem (INDISPONIVEL) → null", async () => {
    route(
      okWith("AMARELOS_TOTAL=5", ["https://ge.globo.com/jogo"]),
      okWith("AMARELOS_TOTAL=INDISPONIVEL", ["https://www.bbc.com/sport/jogo"]),
    );
    expect(await extractCardCount(REF, AUDIT)).toBeNull();
  });

  it("A≡B mas MESMA origem editorial (espn.com vs espn.com.br) → união <2 → null", async () => {
    route(
      okWith("AMARELOS_TOTAL=5", ["https://espn.com.br/jogo"]),
      okWith("AMARELOS_TOTAL=5", ["https://www.espn.com/jogo"]),
    );
    expect(await extractCardCount(REF, AUDIT)).toBeNull();
  });

  it("A≡B mas um pool com 0 fontes reais → null", async () => {
    route(
      okWith("AMARELOS_TOTAL=5", ["https://ge.globo.com/jogo"]),
      okWith("AMARELOS_TOTAL=5", []),
    );
    expect(await extractCardCount(REF, AUDIT)).toBeNull();
  });

  it("prosa ambígua (dois valores distintos numa leitura) → contagem null → null", async () => {
    route(
      okWith("AMARELOS_TOTAL=5 e depois AMARELOS_TOTAL=7", [
        "https://ge.globo.com/jogo",
      ]),
      okWith("AMARELOS_TOTAL=5", ["https://www.bbc.com/sport/jogo"]),
    );
    expect(await extractCardCount(REF, AUDIT)).toBeNull();
  });

  it("contagem fora do bound de sanidade (99) → null", async () => {
    route(
      okWith("AMARELOS_TOTAL=99", ["https://ge.globo.com/jogo"]),
      okWith("AMARELOS_TOTAL=99", ["https://www.bbc.com/sport/jogo"]),
    );
    expect(await extractCardCount(REF, AUDIT)).toBeNull();
  });
});

describe("extractCardCount — inércia sem chave", () => {
  it("hasKey()=false → null, ZERO runAnalysis, persistAiCallError logado por leitura", async () => {
    h.state.hasKey = false;
    expect(await extractCardCount(REF, AUDIT)).toBeNull();
    expect(h.runAnalysisSpy).not.toHaveBeenCalled();
    expect(h.persistSpy).toHaveBeenCalledTimes(2); // A + B, cada uma loga provider_error
  });
});

describe("extractCardCount — modelo que serviu (PLAN-608)", () => {
  const ADOPTED_HAIKU: AIModel = {
    ...MODEL_REGISTRY["claude-haiku-5-5"],
    id: "claude-haiku-5-6",
    inputPricePerMTok: 1,
    outputPricePerMTok: 2,
    longPromptPricing: undefined,
    adopted: { priceEstimated: true, pinnedId: "claude-haiku-5-5" },
  };

  it("cada leitura loga ai_calls.model e custo do servido", async () => {
    const served = (r: ReturnType<typeof okWith>) => ({ ...r, servedModel: ADOPTED_HAIKU });
    route(
      served(okWith("AMARELOS_TOTAL=5", ["https://ge.globo.com/jogo"])),
      served(okWith("AMARELOS_TOTAL=5", ["https://www.bbc.com/sport/jogo"])),
    );
    expect(await extractCardCount(REF, AUDIT)).toBe(5);
    expect(h.insertSpy).toHaveBeenCalledTimes(2);
    for (const [row] of h.insertSpy.mock.calls) {
      expect(row).toMatchObject({
        model: "claude-haiku-5-6",
        // 10 × $1 + 5 × $2 por 1M
        costUsd: ((10 * 1 + 5 * 2) / 1_000_000).toFixed(6),
      });
    }
  });

  it("adapter que lança: a row de erro leva o modelo pedido", async () => {
    h.runAnalysisSpy.mockRejectedValue(new Error("boom"));
    expect(await extractCardCount(REF, AUDIT)).toBeNull();
    const calls = h.persistSpy.mock.calls as unknown as [{ model: AIModel }][];
    expect(calls[0][0].model).toBe(HAIKU);
  });
});
