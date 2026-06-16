import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "next-auth";

// Espelha o harness de predictions-best-bet.test.ts. predict() é mockado (a fronteira do LLM);
// runFanOut roda DE VERDADE (serial, erro isolado). marketsForLeague fica REAL (gate de cobertura
// de liga), marketsForAudience mockado. Sem DB real (predict mockado → ambiente jsdom ok).
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
// Floor do env (#276): isEmailAllowed compõe com o gate de acesso. Default false nos testes →
// quem tem allowed=false e não está no floor é bloqueado (caso determinístico, não ambiente).
vi.mock("@/lib/auth/whitelist", () => ({ isEmailAllowed: vi.fn(() => false) }));
vi.mock("@/lib/rate-limit", () => ({ checkAnalysisRateLimit: vi.fn() }));
vi.mock("@/lib/db/queries/ai-config", () => ({
  getEnableOverUnderExtraLines: vi.fn(),
  getEnableBestBetFanOut: vi.fn(),
}));

import { analyzeMarkets } from "@/app/actions/predictions";
import { auth } from "@/auth";
import { predict } from "@/lib/ai/predict";
import { getEnableOverUnderExtraLines } from "@/lib/db/queries/ai-config";
import { marketsForAudience } from "@/lib/db/queries/market-catalog";
import { getMatchById } from "@/lib/db/queries/matches";
import { getUserAccessState } from "@/lib/db/queries/users";
import { ensureOddsSnapshotsFresh } from "@/lib/odds/fetch-and-snapshot";
import { checkAnalysisRateLimit } from "@/lib/rate-limit";

const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const mockPredict = vi.mocked(predict);
const mockMarketsForAudience = vi.mocked(marketsForAudience);
const mockGetMatchById = vi.mocked(getMatchById);
const mockEnsureOdds = vi.mocked(ensureOddsSnapshotsFresh);
const mockGetAccess = vi.mocked(getUserAccessState);
const mockRateLimit = vi.mocked(checkAnalysisRateLimit);
const mockExtraLinesFlag = vi.mocked(getEnableOverUnderExtraLines);

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

function resultFor(marketKey: string) {
  return {
    prediction: { aiCallId: `ac-${marketKey}`, marketParams: null },
    marketKey,
    selections: [],
  } as unknown as Awaited<ReturnType<typeof predict>>;
}

// Helper ESTENDIDO vs o de predictions-best-bet (Record<string,string> colapsa keys repetidas):
// aceita string[] e faz fd.append por elemento → getAll("marketKeys") devolve N entradas. A
// contagem de getAll dirige a contagem de predict() (pega regressão pra hidden-input único).
function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields))
    (Array.isArray(v) ? v : [v]).forEach((x) => fd.append(k, x));
  return fd;
}

beforeEach(() => {
  mockAuth.mockReset();
  mockAuth.mockResolvedValue(SESSION);
  mockPredict.mockReset();
  mockPredict.mockImplementation(async (args) => resultFor(args.marketKey!));
  mockGetAccess.mockReset();
  mockGetAccess.mockResolvedValue(ALLOWED_ADMIN);
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
});

describe("analyzeMarkets — fan-out multi-mercado (custo/rate-limit por N)", () => {
  it("2 mercados ok → predict 2×, rate-limit 2×, 2 summaries ok, revalidate, ok:true", async () => {
    const res = await analyzeMarkets(
      null,
      form({ matchId: VALID_MATCH_ID, marketKeys: ["over_under", "match_result"] }),
    );
    expect(mockPredict).toHaveBeenCalledTimes(2);
    expect(mockPredict.mock.calls.map((c) => c[0].marketKey)).toEqual([
      "over_under",
      "match_result",
    ]);
    expect(mockRateLimit).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.summaries).toEqual([
        { marketKey: "over_under", marketLabel: "Over/Under gols", status: "ok" },
        { marketKey: "match_result", marketLabel: "Resultado (1X2)", status: "ok" },
      ]);
    }
  });

  it("getAll dirige a contagem: 3 marketKeys → predict 3×, rate-limit 3×", async () => {
    const res = await analyzeMarkets(
      null,
      form({
        matchId: VALID_MATCH_ID,
        marketKeys: ["over_under", "match_result", "btts"],
      }),
    );
    expect(mockPredict).toHaveBeenCalledTimes(3);
    expect(mockRateLimit).toHaveBeenCalledTimes(3);
    expect(res.ok).toBe(true);
  });

  it("falha parcial: mercado 2 lança PredictError → [ok, failed]; predict 2×; ambos consumidos", async () => {
    const { PredictError } = await import("@/lib/ai/predict");
    mockPredict.mockImplementation(async (args) => {
      if (args.marketKey === "match_result")
        throw new PredictError("no matching odds", {});
      return resultFor(args.marketKey!);
    });
    const res = await analyzeMarkets(
      null,
      form({ matchId: VALID_MATCH_ID, marketKeys: ["over_under", "match_result"] }),
    );
    expect(mockPredict).toHaveBeenCalledTimes(2);
    expect(mockRateLimit).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.summaries[0]).toEqual({
        marketKey: "over_under",
        marketLabel: "Over/Under gols",
        status: "ok",
      });
      expect(res.summaries[1]).toMatchObject({
        marketKey: "match_result",
        status: "failed",
        message: "Sem odds publicadas para este jogo no momento.",
      });
    }
  });

  it("cap no meio: 3 escolhidos, rate-limit ok,ok,!ok(cap) → 2 rodam, 1 rate-limited; rate-limit 3×", async () => {
    mockRateLimit
      .mockResolvedValueOnce({ ok: true, limit: 20, remaining: 1, reset: 0 })
      .mockResolvedValueOnce({ ok: true, limit: 20, remaining: 0, reset: 0 })
      .mockResolvedValueOnce({ ok: false, limit: 20, remaining: 0, reset: 0 });
    const res = await analyzeMarkets(
      null,
      form({
        matchId: VALID_MATCH_ID,
        marketKeys: ["over_under", "match_result", "btts"],
      }),
    );
    expect(mockPredict).toHaveBeenCalledTimes(2);
    expect(mockPredict.mock.calls.map((c) => c[0].marketKey)).toEqual([
      "over_under",
      "match_result",
    ]);
    expect(mockRateLimit).toHaveBeenCalledTimes(3);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.summaries.map((s) => [s.marketKey, s.status])).toEqual([
        ["over_under", "ok"],
        ["match_result", "ok"],
        ["btts", "rate-limited"],
      ]);
    }
  });

  it("zero slots (1ª call cap) → ok:false copy de limite; predict 0×; rate-limit 1×", async () => {
    mockRateLimit.mockResolvedValue({ ok: false, limit: 7, remaining: 0, reset: 0 });
    const res = await analyzeMarkets(
      null,
      form({ matchId: VALID_MATCH_ID, marketKeys: ["over_under", "match_result"] }),
    );
    expect(res).toEqual({
      ok: false,
      error: "Você atingiu o limite de 7 análises por dia. Tente novamente amanhã.",
    });
    expect(mockPredict).not.toHaveBeenCalled();
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
  });

  it("fail-closed (1ª call) → ok:false copy de indisponível; predict 0×", async () => {
    mockRateLimit.mockResolvedValue({
      ok: false,
      limit: 0,
      remaining: 0,
      reset: 0,
      reason: "fail-closed",
    });
    const res = await analyzeMarkets(
      null,
      form({ matchId: VALID_MATCH_ID, marketKeys: ["over_under", "match_result"] }),
    );
    expect(res).toEqual({
      ok: false,
      error: "Análises temporariamente indisponíveis. Tente mais tarde.",
    });
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("all-fail → ok:true com sumários failed (slots gastos, detalhe por-mercado); revalidate AINDA chamado", async () => {
    const { revalidatePath } = await import("next/cache");
    const { PredictError } = await import("@/lib/ai/predict");
    mockPredict.mockImplementation(async (args) => {
      if (args.marketKey === "over_under")
        throw new PredictError("no matching odds", {});
      throw new PredictError("standings row missing", {});
    });
    const res = await analyzeMarkets(
      null,
      form({ matchId: VALID_MATCH_ID, marketKeys: ["over_under", "match_result"] }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.summaries.map((s) => [s.marketKey, s.status])).toEqual([
        ["over_under", "failed"],
        ["match_result", "failed"],
      ]);
      // mensagens distintas (mapeadas por friendlyMessage)
      expect(res.summaries[0].message).not.toBe(res.summaries[1].message);
    }
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(`/match/${VALID_MATCH_ID}`);
  });
});

describe("analyzeMarkets — seleção: dedupe, allowlist, paridade single", () => {
  it("dedupe: marketKeys=[over_under, over_under] → predict 1×, rate-limit 1×", async () => {
    const res = await analyzeMarkets(
      null,
      form({ matchId: VALID_MATCH_ID, marketKeys: ["over_under", "over_under"] }),
    );
    expect(mockPredict).toHaveBeenCalledTimes(1);
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.summaries).toHaveLength(1);
  });

  it("allowlist: marketKey forjado fora da cobertura (btts em brasileirao) é dropado; só os válidos rodam", async () => {
    mockGetMatchById.mockResolvedValue(matchInLeague("brasileirao_a"));
    const res = await analyzeMarkets(
      null,
      form({ matchId: VALID_MATCH_ID, marketKeys: ["over_under", "btts"] }),
    );
    // brasileirao cobre over_under + match_result, NÃO btts → btts dropado.
    expect(mockPredict.mock.calls.map((c) => c[0].marketKey)).toEqual(["over_under"]);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.summaries.map((s) => s.marketKey)).toEqual(["over_under"]);
  });

  it("NADA válido na seleção → ok:false 'nenhum mercado válido', SEM consumir slot (rate-limit 0×)", async () => {
    mockGetMatchById.mockResolvedValue(matchInLeague("brasileirao_a"));
    const res = await analyzeMarkets(
      null,
      form({ matchId: VALID_MATCH_ID, marketKeys: ["btts", "double_chance"] }),
    );
    expect(res).toEqual({ ok: false, error: "Nenhum mercado válido selecionado." });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("paridade single SUCESSO (AC4): over_under sozinho → predict 1×, rate-limit 1×, 1 summary ok", async () => {
    const res = await analyzeMarkets(
      null,
      form({ matchId: VALID_MATCH_ID, marketKeys: "over_under" }),
    );
    expect(mockPredict).toHaveBeenCalledTimes(1);
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
    if (res.ok)
      expect(res.summaries).toEqual([
        { marketKey: "over_under", marketLabel: "Over/Under gols", status: "ok" },
      ]);
  });

  it("paridade single FALHA (AC4): over_under sozinho lança → ok:true, 1 summary failed (UI roteia p/ AnalysisErrorCard)", async () => {
    const { PredictError } = await import("@/lib/ai/predict");
    mockPredict.mockRejectedValue(new PredictError("no matching odds", {}));
    const res = await analyzeMarkets(
      null,
      form({ matchId: VALID_MATCH_ID, marketKeys: "over_under" }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.summaries).toHaveLength(1);
      expect(res.summaries[0]).toMatchObject({
        marketKey: "over_under",
        status: "failed",
        message: "Sem odds publicadas para este jogo no momento.",
      });
    }
  });
});

describe("analyzeMarkets — admin sem KV + gate order (slots só após gates grátis)", () => {
  it("admin sem KV (fail-open Infinity) → todos os N concedidos; nenhum Infinity em copy", async () => {
    mockRateLimit.mockResolvedValue({
      ok: true,
      limit: Infinity,
      remaining: Infinity,
      reset: 0,
    });
    const res = await analyzeMarkets(
      null,
      form({
        matchId: VALID_MATCH_ID,
        marketKeys: ["over_under", "match_result", "btts", "double_chance"],
      }),
    );
    expect(mockPredict).toHaveBeenCalledTimes(4);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.summaries.every((s) => s.status === "ok")).toBe(true);
      expect(JSON.stringify(res.summaries)).not.toContain("Infinity");
    }
  });

  it("matchId inválido / sem login / bloqueado / encerrado → rate-limit 0×, predict 0×", async () => {
    expect(
      await analyzeMarkets(null, form({ marketKeys: "over_under" })),
    ).toEqual({ ok: false, error: "matchId ausente" });
    expect(
      await analyzeMarkets(null, form({ matchId: "foo", marketKeys: "over_under" })),
    ).toEqual({ ok: false, error: "Identificador de jogo inválido." });

    mockAuth.mockResolvedValue(null);
    expect(
      await analyzeMarkets(
        null,
        form({ matchId: VALID_MATCH_ID, marketKeys: "over_under" }),
      ),
    ).toMatchObject({ ok: false });
    mockAuth.mockResolvedValue(SESSION);

    mockGetAccess.mockResolvedValue({ role: "user", allowed: false });
    expect(
      await analyzeMarkets(
        null,
        form({ matchId: VALID_MATCH_ID, marketKeys: "over_under" }),
      ),
    ).toEqual({
      ok: false,
      error: "Seu acesso está bloqueado. Fale com o administrador.",
    });
    mockGetAccess.mockResolvedValue(ALLOWED_ADMIN);

    mockGetMatchById.mockResolvedValue(matchInLeague("world_cup", "finished"));
    expect(
      await analyzeMarkets(
        null,
        form({ matchId: VALID_MATCH_ID, marketKeys: "over_under" }),
      ),
    ).toEqual({ ok: false, error: "Este jogo já foi encerrado ou cancelado." });

    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockPredict).not.toHaveBeenCalled();
  });
});
