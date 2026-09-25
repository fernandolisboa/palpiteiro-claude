import { beforeEach, describe, expect, it, vi } from "vitest";

// Orquestração do best bet no motor code_jev (#512, ADR 0041 §4): a porta do predict
// é mockada (a decisão/persistência reais são cobertas em predict.code-jev.test) pra
// travar QUEM é narrado, a cobrança de slots e o best-of-successful.
vi.mock("@/lib/ai/predict", () => ({
  predict: vi.fn(),
  predictForBestBet: vi.fn(),
  narratePendingPrediction: vi.fn(),
  persistPendingPrediction: vi.fn(),
  PredictError: class PredictError extends Error {},
}));

import {
  RATE_LIMITED_MARKET_MESSAGE,
  groupSlotUnits,
  isCodeJevFanOutMarket,
  runCodeJevFanOut,
  type FanOutMarket,
} from "@/lib/ai/best-bet";
import {
  narratePendingPrediction,
  persistPendingPrediction,
  predict,
  predictForBestBet,
  type PendingCodeJevPrediction,
  type PredictResult,
} from "@/lib/ai/predict";

const mockPredict = vi.mocked(predict);
const mockPredictForBestBet = vi.mocked(predictForBestBet);
const mockNarrate = vi.mocked(narratePendingPrediction);
const mockPersist = vi.mocked(persistPendingPrediction);

const base = { matchId: "m1", userId: "u1", isAdmin: true };
const mapError = (err: unknown): string =>
  err instanceof Error ? `falhou: ${err.message}` : "erro";

type Sel = { key: string; modelProbPct: number; odd: number | null };

// Decisões pendentes plausíveis: over/under tem o MAIOR edge (60% vs ~51% implícito),
// 1X2 um edge menor (50% vs ~45%), btts é pass.
const SPECS: Record<string, { recommendation: string; selections: Sel[] }> = {
  over_under: {
    recommendation: "over",
    selections: [
      { key: "over", modelProbPct: 60, odd: 1.9 },
      { key: "under", modelProbPct: 40, odd: 2.0 },
    ],
  },
  match_result: {
    recommendation: "home",
    selections: [
      { key: "home", modelProbPct: 50, odd: 2.1 },
      { key: "draw", modelProbPct: 28, odd: 3.4 },
      { key: "away", modelProbPct: 22, odd: 3.6 },
    ],
  },
  btts: {
    recommendation: "pass",
    selections: [
      { key: "yes", modelProbPct: 52, odd: 1.9 },
      { key: "no", modelProbPct: 48, odd: 1.95 },
    ],
  },
  double_chance: {
    recommendation: "pass",
    selections: [
      { key: "home_or_draw", modelProbPct: 70, odd: 1.3 },
      { key: "away_or_draw", modelProbPct: 55, odd: 1.7 },
      { key: "home_or_away", modelProbPct: 75, odd: 1.3 },
    ],
  },
};

function pendingFor(
  marketKey: string,
  spec = SPECS[marketKey]
): PendingCodeJevPrediction {
  const rec = spec.selections.find((s) => s.key === spec.recommendation);
  return {
    marketKey,
    rankInput: {
      recommendation: spec.recommendation,
      confidencePct: (
        rec?.modelProbPct ?? spec.selections[0].modelProbPct
      ).toFixed(2),
      oddAtRecommendation: rec?.odd?.toFixed(3) ?? null,
      selections: spec.selections,
    },
  } as unknown as PendingCodeJevPrediction;
}

const resultFor = (marketKey: string, aiCallId: string) =>
  ({
    prediction: { id: `pred-${marketKey}`, aiCallId },
    marketKey,
    selections: [],
  }) as unknown as PredictResult;

const NARRATION = {
  aiCallId: "ac-narr",
  output: { rationale: "narrado", key_factors: ["a", "b"] },
};

const markets = (...keys: string[]): FanOutMarket[] =>
  keys.map((marketKey) => ({ marketKey, extraLines: false }));

beforeEach(() => {
  vi.clearAllMocks();
  mockPredictForBestBet.mockImplementation(async (args) => ({
    kind: "pending",
    pending: pendingFor(args.marketKey!),
  }));
  mockNarrate.mockResolvedValue(NARRATION);
  mockPersist.mockImplementation(async (pending, args) =>
    resultFor(pending.marketKey, args.aiCallId)
  );
  mockPredict.mockImplementation(async (args) =>
    resultFor(args.marketKey!, `ac-${args.marketKey}`)
  );
});

describe("isCodeJevFanOutMarket / groupSlotUnits", () => {
  it("partition precificável é code_jev; placar exato e scorer não", () => {
    expect(
      isCodeJevFanOutMarket({ marketKey: "over_under", extraLines: true })
    ).toBe(true);
    expect(
      isCodeJevFanOutMarket({ marketKey: "match_result", extraLines: false })
    ).toBe(true);
    expect(
      isCodeJevFanOutMarket({ marketKey: "btts", extraLines: false })
    ).toBe(true);
    expect(
      isCodeJevFanOutMarket({ marketKey: "double_chance", extraLines: false })
    ).toBe(true);
    expect(
      isCodeJevFanOutMarket({ marketKey: "correct_score", extraLines: false })
    ).toBe(false);
    expect(
      isCodeJevFanOutMarket({ marketKey: "anytime_scorer", extraLines: false })
    ).toBe(false);
  });

  it("agrupados viram UMA unidade na posição do 1º; o resto, uma cada", () => {
    const isGroup = (k: string) => k.startsWith("g");
    expect(groupSlotUnits(["a", "g1", "b", "g2", "g3"], isGroup)).toEqual([
      ["a"],
      ["g1", "g2", "g3"],
      ["b"],
    ]);
    expect(groupSlotUnits(["a", "b"], () => false)).toEqual([["a"], ["b"]]);
    expect(groupSlotUnits(["g1", "g2"], isGroup)).toEqual([["g1", "g2"]]);
  });
});

describe("runCodeJevFanOut — 1 narração por best bet", () => {
  it("narra SÓ o mercado do topo (maior edge); os demais persistem templados apontando pra narração", async () => {
    const acquireSlot = vi.fn(async () => true);
    const out = await runCodeJevFanOut(
      base,
      markets("over_under", "match_result", "btts"),
      mapError,
      acquireSlot
    );

    expect(mockPredictForBestBet).toHaveBeenCalledTimes(3);
    for (const call of mockPredictForBestBet.mock.calls) {
      expect(call[1].engine).toBe("code_jev");
    }
    // O MESMO memo de julgamentos pro run inteiro (1 JEV por jogo).
    const memos = mockPredictForBestBet.mock.calls.map(
      (c) => c[1].judgmentsMemo
    );
    expect(new Set(memos).size).toBe(1);

    expect(mockNarrate).toHaveBeenCalledTimes(1);
    expect(mockNarrate.mock.calls[0][0].marketKey).toBe("over_under");
    // O escolhido persiste com a narração; os outros sem (→ templado), todos com a
    // row de ai_calls da narração.
    const persisted = mockPersist.mock.calls.map(([p, a]) => ({
      market: p.marketKey,
      aiCallId: a.aiCallId,
      narrated: a.narration !== undefined,
    }));
    expect(persisted).toEqual([
      { market: "over_under", aiCallId: "ac-narr", narrated: true },
      { market: "match_result", aiCallId: "ac-narr", narrated: false },
      { market: "btts", aiCallId: "ac-narr", narrated: false },
    ]);
    // Ordem-base preservada; só os não narrados compartilham a ai_call.
    expect(out.map((o) => [o.marketKey, o.ok, o.ok && o.sharesAiCall])).toEqual(
      [
        ["over_under", true, undefined],
        ["match_result", true, true],
        ["btts", true, true],
      ]
    );
    // O slot do grupo (cobrado pelo caller) paga a narração: nenhum slot extra.
    expect(acquireSlot).not.toHaveBeenCalled();
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("a escolha independe da ordem dos mercados", async () => {
    await runCodeJevFanOut(
      base,
      markets("btts", "match_result", "over_under"),
      mapError,
      async () => true
    );
    expect(mockNarrate.mock.calls[0][0].marketKey).toBe("over_under");
  });

  it("tudo pass → narra o card do topo (ordem estável por marketKey)", async () => {
    await runCodeJevFanOut(
      base,
      markets("double_chance", "btts"),
      mapError,
      async () => true
    );
    expect(mockNarrate).toHaveBeenCalledTimes(1);
    expect(mockNarrate.mock.calls[0][0].marketKey).toBe("btts");
  });

  it("mercado fora do code_jev (placar exato) roda o predict de sempre, sem o hook de slot", async () => {
    const acquireSlot = vi.fn(async () => true);
    const out = await runCodeJevFanOut(
      base,
      markets("over_under", "correct_score"),
      mapError,
      acquireSlot
    );
    expect(mockPredict).toHaveBeenCalledTimes(1);
    expect(mockPredict.mock.calls[0][0].marketKey).toBe("correct_score");
    expect(mockPredictForBestBet).toHaveBeenCalledTimes(1);
    expect(acquireSlot).not.toHaveBeenCalled();
    expect(out.map((o) => o.ok)).toEqual([true, true]);
  });

  it("λ indisponível (grupo cai no caminho LLM): a 1ª chamada usa o slot do grupo, as demais pedem slot; negado → não analisado", async () => {
    mockPredictForBestBet.mockImplementation(async (args, opts) => {
      await opts.beforeLlmPath?.();
      return { kind: "done", result: resultFor(args.marketKey!, "ac-llm") };
    });
    const acquireSlot = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);

    const out = await runCodeJevFanOut(
      base,
      markets("over_under", "match_result", "btts"),
      mapError,
      acquireSlot
    );

    // 1ª: slot do grupo; 2ª: slot novo concedido; 3ª: negado.
    expect(acquireSlot).toHaveBeenCalledTimes(2);
    expect(out).toEqual([
      expect.objectContaining({ marketKey: "over_under", ok: true }),
      expect.objectContaining({ marketKey: "match_result", ok: true }),
      { ok: false, marketKey: "btts", message: RATE_LIMITED_MARKET_MESSAGE },
    ]);
    expect(mockNarrate).not.toHaveBeenCalled();
  });

  it("slot do grupo gasto num caminho LLM e narração sem slot → pendentes viram não analisados, sem narrar", async () => {
    mockPredictForBestBet.mockImplementationOnce(async (args, opts) => {
      await opts.beforeLlmPath?.();
      return { kind: "done", result: resultFor(args.marketKey!, "ac-llm") };
    });
    const acquireSlot = vi.fn(async () => false);

    const out = await runCodeJevFanOut(
      base,
      markets("over_under", "match_result"),
      mapError,
      acquireSlot
    );

    expect(acquireSlot).toHaveBeenCalledTimes(1);
    expect(mockNarrate).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
    expect(out).toEqual([
      expect.objectContaining({ marketKey: "over_under", ok: true }),
      {
        ok: false,
        marketKey: "match_result",
        message: RATE_LIMITED_MARKET_MESSAGE,
      },
    ]);
  });

  it("falha ao registrar a narração → nenhum pendente persiste (sem ai_call pra referenciar)", async () => {
    mockNarrate.mockRejectedValue(new Error("failed to persist ai_call"));
    const out = await runCodeJevFanOut(
      base,
      markets("over_under", "match_result"),
      mapError,
      async () => true
    );
    expect(mockPersist).not.toHaveBeenCalled();
    expect(out).toEqual([
      {
        ok: false,
        marketKey: "over_under",
        message: "falhou: failed to persist ai_call",
      },
      {
        ok: false,
        marketKey: "match_result",
        message: "falhou: failed to persist ai_call",
      },
    ]);
  });

  it("falha na decisão ou na persistência de UM mercado não derruba os irmãos", async () => {
    mockPredictForBestBet.mockImplementation(async (args) => {
      if (args.marketKey === "btts") throw new Error("sem snapshot fresco");
      return { kind: "pending", pending: pendingFor(args.marketKey!) };
    });
    mockPersist.mockImplementation(async (pending, args) => {
      if (pending.marketKey === "match_result") throw new Error("insert");
      return resultFor(pending.marketKey, args.aiCallId);
    });
    const out = await runCodeJevFanOut(
      base,
      markets("over_under", "match_result", "btts"),
      mapError,
      async () => true
    );
    expect(out.map((o) => (o.ok ? "ok" : o.message))).toEqual([
      "ok",
      "falhou: insert",
      "falhou: sem snapshot fresco",
    ]);
  });
});
