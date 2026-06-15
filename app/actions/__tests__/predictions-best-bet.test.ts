import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "next-auth";

// Espelha o harness de predictions.test.ts. predict() é mockado (a fronteira do LLM):
// runFanOut + toBestBetView rodam DE VERDADE (toAnalysisView mockado → {} pra não
// precisar de stubs completos de prediction). marketsForLeague fica REAL (gate de
// cobertura de liga), marketsForAudience mockado.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ai/predict", () => ({
  predict: vi.fn(),
  PredictError: class PredictError extends Error {
    context: unknown;
    constructor(message: string, context?: unknown) {
      super(message);
      this.context = context;
    }
  },
}));
vi.mock("@/lib/db/queries/predictions", () => ({ getAiCallById: vi.fn() }));
vi.mock("@/lib/db/queries/market-catalog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/db/queries/market-catalog")>();
  return { ...actual, marketsForAudience: vi.fn() };
});
vi.mock("@/lib/db/queries/matches", () => ({ getMatchById: vi.fn() }));
vi.mock("@/lib/odds/fetch-and-snapshot", () => ({
  ensureOddsSnapshotsFresh: vi.fn(),
}));
vi.mock("@/lib/db/queries/users", () => ({ getUserAccessState: vi.fn() }));
// Floor do env (#276): isEmailAllowed compõe com o gate de acesso. Default false nos
// testes → quem tem allowed=false e não está no floor é bloqueado.
vi.mock("@/lib/auth/whitelist", () => ({ isEmailAllowed: vi.fn(() => false) }));
vi.mock("@/lib/rate-limit", () => ({ checkAnalysisRateLimit: vi.fn() }));
// toAnalysisView mockado → {} (a corretude da view N-vias é coberta por best-bet.test).
vi.mock("@/lib/view/analysis", () => ({ toAnalysisView: vi.fn(() => ({})) }));
vi.mock("@/lib/db/queries/ai-config", () => ({
  getEnableOverUnderExtraLines: vi.fn(),
  getEnableBestBetFanOut: vi.fn(),
}));

import { analyzeBestBet } from "@/app/actions/predictions";
import { auth } from "@/auth";
import { predict } from "@/lib/ai/predict";
import {
  getEnableBestBetFanOut,
  getEnableOverUnderExtraLines,
} from "@/lib/db/queries/ai-config";
import { marketsForAudience } from "@/lib/db/queries/market-catalog";
import { getMatchById } from "@/lib/db/queries/matches";
import { getAiCallById } from "@/lib/db/queries/predictions";
import { getUserAccessState } from "@/lib/db/queries/users";
import { ensureOddsSnapshotsFresh } from "@/lib/odds/fetch-and-snapshot";
import { checkAnalysisRateLimit } from "@/lib/rate-limit";

const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const mockPredict = vi.mocked(predict);
const mockMarketsForAudience = vi.mocked(marketsForAudience);
const mockGetMatchById = vi.mocked(getMatchById);
const mockEnsureOdds = vi.mocked(ensureOddsSnapshotsFresh);
const mockGetAccess = vi.mocked(getUserAccessState);
const mockGetAiCall = vi.mocked(getAiCallById);
const mockRateLimit = vi.mocked(checkAnalysisRateLimit);
const mockExtraLinesFlag = vi.mocked(getEnableOverUnderExtraLines);
const mockBestBetFlag = vi.mocked(getEnableBestBetFanOut);

const ALLOWED_ADMIN = { role: "admin" as const, allowed: true };

const OVER_UNDER_MARKET = { key: "over_under", label: "Over/Under gols" };
const MATCH_RESULT_MARKET = { key: "match_result", label: "Resultado (1X2)" };
const BTTS_MARKET = { key: "btts", label: "Ambas marcam" };
const DOUBLE_CHANCE_MARKET = { key: "double_chance", label: "Dupla chance" };

const VALID_MATCH_ID = "550e8400-e29b-41d4-a716-446655440000";

function matchInLeague(league: string, status = "scheduled") {
  return {
    id: VALID_MATCH_ID,
    league,
    status,
    homeTeam: "Mexico",
    awayTeam: "South Africa",
    kickoffAt: new Date("2026-06-11T19:00:00.000Z"),
  } as unknown as Awaited<ReturnType<typeof getMatchById>>;
}

const SESSION = {
  user: { id: "u1", email: "a@b.com", role: "admin" },
  expires: "2099-01-01",
} as unknown as Session;

// Selections + recommendation plausíveis por mercado pro computeRank rodar.
const SELECTIONS: Record<
  string,
  { recommendation: string; selections: { key: string; modelProbPct: number; odd: number | null }[] }
> = {
  over_under: {
    recommendation: "over",
    selections: [
      { key: "over", modelProbPct: 58, odd: 1.9 },
      { key: "under", modelProbPct: 42, odd: 2.0 },
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
    recommendation: "yes",
    selections: [
      { key: "yes", modelProbPct: 55, odd: 1.8 },
      { key: "no", modelProbPct: 45, odd: 2.0 },
    ],
  },
  double_chance: {
    recommendation: "home_or_draw",
    selections: [
      { key: "home_or_draw", modelProbPct: 72, odd: 1.25 },
      { key: "home_or_away", modelProbPct: 65, odd: 1.45 },
      { key: "away_or_draw", modelProbPct: 60, odd: 1.6 },
    ],
  },
};

function resultFor(marketKey: string) {
  const spec = SELECTIONS[marketKey];
  return {
    prediction: {
      aiCallId: `ac-${marketKey}`,
      recommendation: spec.recommendation,
      confidencePct: "55.00",
      oddAtRecommendation: "1.90",
      marketParams: null,
    },
    marketKey,
    selections: spec.selections,
  } as unknown as Awaited<ReturnType<typeof predict>>;
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  mockAuth.mockReset();
  mockAuth.mockResolvedValue(SESSION);
  mockPredict.mockReset();
  mockPredict.mockImplementation(async (args) => resultFor(args.marketKey!));
  mockGetAccess.mockReset();
  mockGetAccess.mockResolvedValue(ALLOWED_ADMIN);
  mockGetAiCall.mockReset();
  mockGetAiCall.mockResolvedValue({ costUsd: "0.01" } as never);
  mockRateLimit.mockReset();
  mockRateLimit.mockResolvedValue({ ok: true, limit: 20, remaining: 19, reset: 0 });
  mockMarketsForAudience.mockReset();
  mockMarketsForAudience.mockResolvedValue([
    OVER_UNDER_MARKET,
    MATCH_RESULT_MARKET,
    BTTS_MARKET,
    DOUBLE_CHANCE_MARKET,
  ]);
  mockGetMatchById.mockReset();
  mockGetMatchById.mockResolvedValue(matchInLeague("world_cup"));
  mockEnsureOdds.mockReset();
  mockEnsureOdds.mockResolvedValue(null);
  mockExtraLinesFlag.mockReset();
  mockExtraLinesFlag.mockResolvedValue(false);
  mockBestBetFlag.mockReset();
  mockBestBetFlag.mockResolvedValue(true);
});

describe("analyzeBestBet — gate order (rate-limit é o ÚLTIMO antes do spend)", () => {
  it("flag OFF → {ok:false}, SEM rate-limit, SEM predict", async () => {
    mockBestBetFlag.mockResolvedValue(false);
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(res).toEqual({ ok: false, error: "Recurso indisponível." });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("candidatos vazios → {ok:false}, SEM rate-limit, SEM predict", async () => {
    mockMarketsForAudience.mockResolvedValue([]);
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(res).toEqual({
      ok: false,
      error: "Nenhum mercado disponível para este jogo.",
    });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("não-autenticado → {ok:false} sem rate-limit nem predict", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(res).toMatchObject({ ok: false });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("happy path WC → rate-limit chamado EXATAMENTE 1× pra N mercados", async () => {
    await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(mockRateLimit).toHaveBeenCalledWith("u1", "admin");
  });

  it("rate-limit atingido → {ok:false}, SEM predict", async () => {
    mockRateLimit.mockResolvedValue({ ok: false, limit: 7, remaining: 0, reset: 0 });
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(res).toEqual({
      ok: false,
      error: "Você atingiu o limite de 7 análises por dia. Tente novamente amanhã.",
    });
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("matchId ausente / inválido → {ok:false} antes de qualquer gate", async () => {
    expect(await analyzeBestBet(null, form({}))).toEqual({
      ok: false,
      error: "matchId ausente",
    });
    expect(await analyzeBestBet(null, form({ matchId: "foo" }))).toEqual({
      ok: false,
      error: "Identificador de jogo inválido.",
    });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("sessão órfã (getUserAccessState → null) → {ok:false}, SEM rate-limit nem predict", async () => {
    mockGetAccess.mockResolvedValue(null);
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(res).toEqual({
      ok: false,
      error: "Sua sessão expirou. Faça login novamente.",
    });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("acesso bloqueado (allowed=false, e-mail fora do floor) → {ok:false}, SEM spend", async () => {
    mockGetAccess.mockResolvedValue({ role: "user", allowed: false });
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(res).toEqual({
      ok: false,
      error: "Seu acesso está bloqueado. Fale com o administrador.",
    });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("jogo encerrado → {ok:false}, SEM pré-warm de odds nem predict (guarda de custo)", async () => {
    mockGetMatchById.mockResolvedValue(matchInLeague("world_cup", "finished"));
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(res).toEqual({
      ok: false,
      error: "Este jogo já foi encerrado ou cancelado.",
    });
    expect(mockEnsureOdds).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockPredict).not.toHaveBeenCalled();
  });
});

describe("analyzeBestBet — candidate set por liga (marketsForLeague REAL)", () => {
  it("WC → 4 mercados, predict 4×, {ok:true} com 4 entries", async () => {
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(mockPredict).toHaveBeenCalledTimes(4);
    expect(mockPredict.mock.calls.map((c) => c[0].marketKey)).toEqual([
      "over_under",
      "match_result",
      "btts",
      "double_chance",
    ]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.view.entries).toHaveLength(4);
      expect(res.view.llmCalls).toBe(4);
      expect(res.view.unavailableMarkets).toBe(0);
    }
  });

  it("non-WC (brasileirao) → só over_under + match_result (2), SEM pré-warm additional", async () => {
    mockGetMatchById.mockResolvedValue(matchInLeague("brasileirao_a"));
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(mockPredict.mock.calls.map((c) => c[0].marketKey)).toEqual([
      "over_under",
      "match_result",
    ]);
    expect(mockEnsureOdds).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
  });

  it("base passa matchId/userId/isAdmin/modelOverride pra cada predict", async () => {
    await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    for (const call of mockPredict.mock.calls) {
      expect(call[0]).toMatchObject({
        matchId: VALID_MATCH_ID,
        userId: "u1",
        isAdmin: true,
        modelOverride: undefined,
      });
    }
  });
});

describe("analyzeBestBet — pré-warm additional flag-conditional (#175)", () => {
  it("extra-lines OFF → pré-warm [btts, double_chance] (SEM alternate_totals); over_under fica featured", async () => {
    await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    const providerKeys = mockEnsureOdds.mock.calls.map(
      (c) => c[1]?.markets?.[0]?.providerMarketKey,
    );
    expect(providerKeys).toEqual(["btts", "double_chance"]);
    // over_under extraLines:false → predict recebe extraLines:false.
    const ouCall = mockPredict.mock.calls.find((c) => c[0].marketKey === "over_under");
    expect(ouCall?.[0].extraLines).toBe(false);
  });

  it("extra-lines ON (WC) → pré-warm [alternate_totals, btts, double_chance]; over_under extraLines:true", async () => {
    mockExtraLinesFlag.mockResolvedValue(true);
    await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    const providerKeys = mockEnsureOdds.mock.calls.map(
      (c) => c[1]?.markets?.[0]?.providerMarketKey,
    );
    expect(providerKeys).toEqual(["alternate_totals", "btts", "double_chance"]);
    const ouCall = mockPredict.mock.calls.find((c) => c[0].marketKey === "over_under");
    expect(ouCall?.[0].extraLines).toBe(true);
    // 1X2/btts/dc nunca recebem extraLines (sem variante multi-linha).
    for (const mk of ["match_result", "btts", "double_chance"]) {
      const call = mockPredict.mock.calls.find((c) => c[0].marketKey === mk);
      expect(call?.[0].extraLines).toBe(false);
    }
  });

  it("extra-lines ON mas liga SEM cobertura (brasileirao) → over_under extraLines:false (resolveExtraLines parity)", async () => {
    mockExtraLinesFlag.mockResolvedValue(true);
    mockGetMatchById.mockResolvedValue(matchInLeague("brasileirao_a"));
    await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    const ouCall = mockPredict.mock.calls.find((c) => c[0].marketKey === "over_under");
    expect(ouCall?.[0].extraLines).toBe(false);
    expect(mockEnsureOdds).not.toHaveBeenCalled();
  });
});

describe("analyzeBestBet — best-of-successful / all-fail", () => {
  it("pré-warm throw em UM additional não aborta os outros (best-of-successful)", async () => {
    // btts falha no pré-warm; double_chance segue. btts predict também falha (sem snapshot).
    mockEnsureOdds.mockImplementation(async (_match, opts) => {
      if (opts?.markets?.[0]?.providerMarketKey === "btts")
        throw new Error("seed faltante");
      return null;
    });
    const { PredictError } = await import("@/lib/ai/predict");
    mockPredict.mockImplementation(async (args) => {
      if (args.marketKey === "btts")
        throw new PredictError("additional 'btts' sem snapshot fresco", {});
      return resultFor(args.marketKey!);
    });
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    // pré-warm dos 2 additionais rodou (não abortou no btts).
    expect(mockEnsureOdds).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.view.entries.map((e) => e.marketKey)).toEqual([
        "over_under",
        "match_result",
        "double_chance",
      ]);
      expect(res.view.errors.map((e) => e.marketKey)).toEqual(["btts"]);
      expect(res.view.unavailableMarkets).toBe(1);
    }
  });

  it("falha parcial expõe entries[] + errors[]", async () => {
    const { PredictError } = await import("@/lib/ai/predict");
    mockPredict.mockImplementation(async (args) => {
      if (args.marketKey === "double_chance")
        throw new PredictError("additional 'double_chance' sem snapshot fresco", {});
      return resultFor(args.marketKey!);
    });
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.view.entries).toHaveLength(3);
      expect(res.view.errors.map((e) => e.marketKey)).toEqual(["double_chance"]);
    }
  });

  it("TODOS falham → {ok:false} com a 1ª mensagem (não sucesso vazio)", async () => {
    const { PredictError } = await import("@/lib/ai/predict");
    mockPredict.mockRejectedValue(
      new PredictError("sem snapshot fresco", {}),
    );
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe(
        "Nenhum bookmaker oferece este mercado para o jogo no momento.",
      );
    }
  });
});
