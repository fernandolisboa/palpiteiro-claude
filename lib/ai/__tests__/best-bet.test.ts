import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// predict() is the ONLY door to the LLM; runFanOut must call it once per market and
// never touch the Anthropic SDK. We mock predict so no real LLM/DB is touched and we
// can assert call order/args + per-market error capture.
vi.mock("@/lib/ai/predict", () => ({
  predict: vi.fn(),
  PredictError: class PredictError extends Error {},
}));

import { predict } from "@/lib/ai/predict";
import {
  runFanOut,
  type FanOutMarket,
  type SlotGrant,
} from "@/lib/ai/best-bet";
import {
  AnalysisDeadlineError,
  DEADLINE_MARKET_MESSAGE,
} from "@/lib/ai/deadline";

const mockPredict = vi.mocked(predict);
const base = { matchId: "m1", userId: "u1", isAdmin: false };
const mapError = (err: unknown): string =>
  err instanceof Error ? err.message : "erro";

// Minimal PredictResult stub keyed by marketKey so we can assert pass-through.
const okResult = (marketKey: string) =>
  ({
    prediction: { id: `pred-${marketKey}` },
    marketKey,
    selections: [],
  }) as unknown as Awaited<ReturnType<typeof predict>>;

beforeEach(() => {
  mockPredict.mockReset();
});

describe("runFanOut — serial fan-out, best-of-successful (#178)", () => {
  it("chama predict() uma vez por mercado, NA ORDEM, com o {marketKey, extraLines} certo", async () => {
    mockPredict.mockImplementation(async (args) => okResult(args.marketKey!));
    const markets: FanOutMarket[] = [
      { marketKey: "over_under", extraLines: true },
      { marketKey: "match_result", extraLines: false },
      { marketKey: "btts", extraLines: false },
    ];

    const out = await runFanOut(base, markets, mapError);

    expect(mockPredict).toHaveBeenCalledTimes(3);
    // Ordem + args (a iteração é sobre o ARRAY de candidatos — guarda contra o
    // self-shadow bug que passaria a função no lugar da lista).
    expect(mockPredict.mock.calls.map((c) => c[0].marketKey)).toEqual([
      "over_under",
      "match_result",
      "btts",
    ]);
    expect(mockPredict.mock.calls[0][0]).toMatchObject({
      matchId: "m1",
      userId: "u1",
      isAdmin: false,
      marketKey: "over_under",
      extraLines: true,
    });
    expect(out.map((o) => o.ok)).toEqual([true, true, true]);
  });

  it("PredictError no mercado 2 de 3 → ok:false só pra ele; 1 e 3 surgem ok:true", async () => {
    mockPredict.mockImplementation(async (args) => {
      if (args.marketKey === "match_result")
        throw new Error("sem snapshot fresco");
      return okResult(args.marketKey!);
    });
    const markets: FanOutMarket[] = [
      { marketKey: "over_under", extraLines: false },
      { marketKey: "match_result", extraLines: false },
      { marketKey: "btts", extraLines: false },
    ];

    const out = await runFanOut(base, markets, mapError);

    expect(out).toEqual([
      { ok: true, marketKey: "over_under", result: expect.anything() },
      { ok: false, marketKey: "match_result", message: "sem snapshot fresco" },
      { ok: true, marketKey: "btts", result: expect.anything() },
    ]);
  });

  it("erro NÃO-Predict (inesperado) no mercado 3 não descarta os irmãos 1 e 2 já pagos", async () => {
    mockPredict.mockImplementation(async (args) => {
      if (args.marketKey === "btts")
        throw new TypeError("db connection exploded");
      return okResult(args.marketKey!);
    });
    const markets: FanOutMarket[] = [
      { marketKey: "over_under", extraLines: false },
      { marketKey: "match_result", extraLines: false },
      { marketKey: "btts", extraLines: false },
    ];

    const out = await runFanOut(base, markets, mapError);

    expect(out.filter((o) => o.ok).map((o) => o.marketKey)).toEqual([
      "over_under",
      "match_result",
    ]);
    expect(out[2]).toEqual({
      ok: false,
      marketKey: "btts",
      message: "db connection exploded",
    });
  });

  it("lista vazia → nenhum predict(), zero outcomes", async () => {
    const out = await runFanOut(base, [], mapError);
    expect(mockPredict).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });
});

describe("runFanOut — prazo do run e slot sob demanda (#524 review)", () => {
  const three: FanOutMarket[] = [
    { marketKey: "over_under", extraLines: false },
    { marketKey: "match_result", extraLines: false },
    { marketKey: "btts", extraLines: false },
  ];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("provider lento: ao estourar o prazo os restantes viram 'Tempo esgotado' sem predict nem slot", async () => {
    let clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    // Cada chamada paga leva 100s; prazo = +150s. Em t=100 sobram 50s (cabe), em t=200 não.
    mockPredict.mockImplementation(async (args, opts) => {
      await opts?.beforeLlmPath?.();
      clock += 100_000;
      return okResult(args.marketKey!);
    });
    const acquireSlot = vi.fn(async () => ({ ok: true }));
    const deadlineAt = clock + 150_000;

    const out = await runFanOut(base, three, mapError, {
      deadlineAt,
      acquireSlot,
    });

    expect(mockPredict).toHaveBeenCalledTimes(2);
    expect(mockPredict.mock.calls[0][0].deadlineAt).toBe(deadlineAt);
    // Slots cobrados == chamadas pagas.
    expect(acquireSlot).toHaveBeenCalledTimes(2);
    expect(out[2]).toEqual({
      ok: false,
      marketKey: "btts",
      message: DEADLINE_MARKET_MESSAGE,
      notRun: "deadline",
    });
  });

  it("predict lança AnalysisDeadlineError → o mercado e os seguintes não rodam", async () => {
    mockPredict.mockImplementation(async (args, opts) => {
      if (args.marketKey === "match_result") throw new AnalysisDeadlineError();
      await opts?.beforeLlmPath?.();
      return okResult(args.marketKey!);
    });
    const acquireSlot = vi.fn(async () => ({ ok: true }));
    const out = await runFanOut(base, three, mapError, { acquireSlot });
    expect(mockPredict).toHaveBeenCalledTimes(2);
    expect(acquireSlot).toHaveBeenCalledTimes(1);
    expect(out.map((o) => (o.ok ? "ok" : o.notRun))).toEqual([
      "ok",
      "deadline",
      "deadline",
    ]);
  });

  it("slot cobrado só antes da chamada paga: falha antes do LLM não cobra; negado para o run", async () => {
    mockPredict.mockImplementation(async (args, opts) => {
      if (args.marketKey === "over_under") throw new Error("sem snapshot fresco");
      await opts?.beforeLlmPath?.();
      return okResult(args.marketKey!);
    });
    const acquireSlot = vi
      .fn<() => Promise<SlotGrant>>()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValue({ ok: false });

    const out = await runFanOut(
      base,
      [...three, { marketKey: "double_chance", extraLines: false }],
      mapError,
      { acquireSlot },
    );

    // over_under falhou antes (sem slot); match_result pagou 1; btts negado → para.
    expect(acquireSlot).toHaveBeenCalledTimes(2);
    expect(mockPredict).toHaveBeenCalledTimes(3);
    expect(out.map((o) => (o.ok ? "ok" : (o.notRun ?? o.message)))).toEqual([
      "sem snapshot fresco",
      "ok",
      "rate-limited",
      "rate-limited",
    ]);
  });
});
