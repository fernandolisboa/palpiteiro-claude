import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { DEADLINE_MARKET_MESSAGE } from "@/lib/ai/deadline";
import {
  RATE_LIMITED_MARKET_MESSAGE,
  groupSlotUnits,
  isCodeJevFanOutMarket,
  runCodeJevFanOut,
  ANALYSES_UNAVAILABLE_MESSAGE,
  type FanOutMarket,
  type SlotGrant,
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
    // O narrador confere o prazo pelo modo de thinking do modelo resolvido.
    model: { thinkingMode: "temperature" },
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
  // Como o predict real: cobra o slot (hook) logo antes da chamada paga.
  mockPredict.mockImplementation(async (args, opts) => {
    await opts?.beforeLlmPath?.();
    return resultFor(args.marketKey!, `ac-${args.marketKey}`);
  });
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
    const acquireSlot = vi.fn(async () => ({ ok: true }));
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
    const memos = mockPredictForBestBet.mock.calls.map((c) => c[1].runMemo);
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
    // 1 chamada paga (a narração) = 1 slot, cobrado logo antes dela.
    expect(acquireSlot).toHaveBeenCalledTimes(1);
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("a escolha independe da ordem dos mercados", async () => {
    await runCodeJevFanOut(
      base,
      markets("btts", "match_result", "over_under"),
      mapError,
      async () => ({ ok: true })
    );
    expect(mockNarrate.mock.calls[0][0].marketKey).toBe("over_under");
  });

  it("tudo pass → narra o card do topo (ordem estável por marketKey)", async () => {
    await runCodeJevFanOut(
      base,
      markets("double_chance", "btts"),
      mapError,
      async () => ({ ok: true })
    );
    expect(mockNarrate).toHaveBeenCalledTimes(1);
    expect(mockNarrate.mock.calls[0][0].marketKey).toBe("btts");
  });

  it("mercado fora do code_jev (placar exato) roda o predict de sempre, cobrando o próprio slot", async () => {
    const acquireSlot = vi.fn(async () => ({ ok: true }));
    const out = await runCodeJevFanOut(
      base,
      markets("over_under", "correct_score"),
      mapError,
      acquireSlot
    );
    expect(mockPredict).toHaveBeenCalledTimes(1);
    expect(mockPredict.mock.calls[0][0].marketKey).toBe("correct_score");
    expect(mockPredictForBestBet).toHaveBeenCalledTimes(1);
    // Narração + placar exato = 2 chamadas pagas = 2 slots.
    expect(acquireSlot).toHaveBeenCalledTimes(2);
    expect(out.map((o) => o.ok)).toEqual([true, true]);
  });

  it("ordem: o grupo e a narração ANTES dos mercados fora do grupo; a saída mantém a ordem-base", async () => {
    const log: string[] = [];
    mockPredictForBestBet.mockImplementation(async (args) => {
      log.push(`decide:${args.marketKey}`);
      return { kind: "pending", pending: pendingFor(args.marketKey!) };
    });
    mockNarrate.mockImplementation(async (pending) => {
      log.push(`narra:${pending.marketKey}`);
      return NARRATION;
    });
    mockPredict.mockImplementation(async (args) => {
      log.push(`predict:${args.marketKey}`);
      return resultFor(args.marketKey!, `ac-${args.marketKey}`);
    });
    const out = await runCodeJevFanOut(
      base,
      markets("correct_score", "over_under", "match_result"),
      mapError,
      async () => ({ ok: true })
    );
    expect(log).toEqual([
      "decide:over_under",
      "decide:match_result",
      "narra:over_under",
      "predict:correct_score",
    ]);
    expect(out.map((o) => o.marketKey)).toEqual([
      "correct_score",
      "over_under",
      "match_result",
    ]);
  });

  it("λ indisponível (grupo cai no caminho LLM): cada chamada paga pede o próprio slot; negado → não analisado", async () => {
    mockPredictForBestBet.mockImplementation(async (args, opts) => {
      await opts.beforeLlmPath?.();
      return { kind: "done", result: resultFor(args.marketKey!, "ac-llm") };
    });
    const acquireSlot = vi
      .fn<() => Promise<SlotGrant>>()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValue({ ok: false });

    const out = await runCodeJevFanOut(
      base,
      markets("over_under", "match_result", "btts"),
      mapError,
      acquireSlot
    );

    // 1ª e 2ª concedidas; 3ª negada.
    expect(acquireSlot).toHaveBeenCalledTimes(3);
    expect(out).toEqual([
      expect.objectContaining({ marketKey: "over_under", ok: true }),
      expect.objectContaining({ marketKey: "match_result", ok: true }),
      {
        ok: false,
        marketKey: "btts",
        message: RATE_LIMITED_MARKET_MESSAGE,
        notRun: "rate-limited",
      },
    ]);
    expect(mockNarrate).not.toHaveBeenCalled();
  });

  it("limiter fail-closed no meio do run → 'indisponível', não 'limite atingido'", async () => {
    mockPredictForBestBet.mockImplementation(async (args, opts) => {
      await opts.beforeLlmPath?.();
      return { kind: "done", result: resultFor(args.marketKey!, "ac-llm") };
    });
    const out = await runCodeJevFanOut(
      base,
      markets("over_under", "match_result"),
      mapError,
      async () => ({ ok: false, reason: "fail-closed" })
    );
    expect(out[1]).toEqual({
      ok: false,
      marketKey: "match_result",
      message: ANALYSES_UNAVAILABLE_MESSAGE,
      notRun: "unavailable",
    });
  });

  it("um mercado do grupo no caminho LLM e narração sem slot → pendentes viram não analisados, sem narrar", async () => {
    mockPredictForBestBet.mockImplementationOnce(async (args, opts) => {
      await opts.beforeLlmPath?.();
      return { kind: "done", result: resultFor(args.marketKey!, "ac-llm") };
    });
    const acquireSlot = vi
      .fn<() => Promise<SlotGrant>>()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValue({ ok: false });

    const out = await runCodeJevFanOut(
      base,
      markets("over_under", "match_result"),
      mapError,
      acquireSlot
    );

    expect(acquireSlot).toHaveBeenCalledTimes(2);
    expect(mockNarrate).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
    expect(out).toEqual([
      expect.objectContaining({ marketKey: "over_under", ok: true }),
      {
        ok: false,
        marketKey: "match_result",
        message: RATE_LIMITED_MARKET_MESSAGE,
        notRun: "rate-limited",
      },
    ]);
  });

  it("falha ao registrar a narração → nenhum pendente persiste (sem ai_call pra referenciar)", async () => {
    mockNarrate.mockRejectedValue(new Error("failed to persist ai_call"));
    const out = await runCodeJevFanOut(
      base,
      markets("over_under", "match_result"),
      mapError,
      async () => ({ ok: true })
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
      async () => ({ ok: true })
    );
    expect(out.map((o) => (o.ok ? "ok" : o.message))).toEqual([
      "ok",
      "falhou: insert",
      "falhou: sem snapshot fresco",
    ]);
  });
});

describe("runCodeJevFanOut — prazo do run (#524 review)", () => {
  let clock: number;
  beforeEach(() => {
    clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prazo já esgotado → nada roda, nenhum slot, todos 'Tempo esgotado'", async () => {
    const acquireSlot = vi.fn(async () => ({ ok: true }));
    const out = await runCodeJevFanOut(
      base,
      markets("over_under", "correct_score"),
      mapError,
      acquireSlot,
      { deadlineAt: clock + 10_000 }
    );
    expect(mockPredictForBestBet).not.toHaveBeenCalled();
    expect(mockPredict).not.toHaveBeenCalled();
    expect(acquireSlot).not.toHaveBeenCalled();
    expect(out).toEqual([
      {
        ok: false,
        marketKey: "over_under",
        message: DEADLINE_MARKET_MESSAGE,
        notRun: "deadline",
      },
      {
        ok: false,
        marketKey: "correct_score",
        message: DEADLINE_MARKET_MESSAGE,
        notRun: "deadline",
      },
    ]);
  });

  it("provider lento: o grupo narra, o mercado avulso que não cabe é pulado SEM slot", async () => {
    // Decisões levam 30s cada, a narração outros 30s: em t=90s sobram 10s (< 20s do piso).
    mockPredictForBestBet.mockImplementation(async (args) => {
      clock += 30_000;
      return { kind: "pending", pending: pendingFor(args.marketKey!) };
    });
    mockNarrate.mockImplementation(async () => {
      clock += 30_000;
      return NARRATION;
    });
    const acquireSlot = vi.fn(async () => ({ ok: true }));
    const deadlineAt = clock + 100_000;
    const out = await runCodeJevFanOut(
      base,
      markets("over_under", "correct_score", "match_result"),
      mapError,
      acquireSlot,
      { deadlineAt }
    );
    // O prazo chega ao predict de cada mercado.
    for (const call of mockPredictForBestBet.mock.calls) {
      expect(call[0].deadlineAt).toBe(deadlineAt);
    }
    expect(mockNarrate).toHaveBeenCalledTimes(1);
    expect(mockPredict).not.toHaveBeenCalled();
    // Só a narração foi paga → 1 slot.
    expect(acquireSlot).toHaveBeenCalledTimes(1);
    expect(out.map((o) => [o.marketKey, o.ok ? "ok" : o.message])).toEqual([
      ["over_under", "ok"],
      ["correct_score", DEADLINE_MARKET_MESSAGE],
      ["match_result", "ok"],
    ]);
  });

  it("narração não cabe no prazo → pendentes viram 'Tempo esgotado', sem slot nem chamada", async () => {
    mockPredictForBestBet.mockImplementation(async (args) => {
      clock += 45_000;
      return { kind: "pending", pending: pendingFor(args.marketKey!) };
    });
    const acquireSlot = vi.fn(async () => ({ ok: true }));
    const out = await runCodeJevFanOut(
      base,
      markets("over_under", "match_result"),
      mapError,
      acquireSlot,
      { deadlineAt: clock + 100_000 }
    );
    // t=90s: sobram 10s → a narração não começa.
    expect(mockNarrate).not.toHaveBeenCalled();
    expect(acquireSlot).not.toHaveBeenCalled();
    expect(mockPersist).not.toHaveBeenCalled();
    expect(out.every((o) => !o.ok && o.notRun === "deadline")).toBe(true);
  });
});
