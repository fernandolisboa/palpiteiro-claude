import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
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
// checkAnalysisRateLimit CONSOME: a action cobra o 1º slot antes de qualquer gasto; os
// demais vêm do hook beforeLlmPath que o predict mockado chama (#524 review).
vi.mock("@/lib/rate-limit", () => ({ checkAnalysisRateLimit: vi.fn() }));
// toAnalysisView mockado → {} (a corretude da view N-vias é coberta por best-bet.test).
vi.mock("@/lib/view/analysis", () => ({ toAnalysisView: vi.fn(() => ({})) }));
vi.mock("@/lib/db/queries/ai-config", () => ({
  getEnableOverUnderExtraLines: vi.fn(),
  getEnableBestBetFanOut: vi.fn(),
}));
// Passo de síntese (#353): generatePalpites é a porta da síntese (Haiku) — mockada
// aqui (a corretude do gerador é coberta por generate-palpites.test). summarize roda
// REAL (lê os outcomes do fan-out). toPalpiteHeadlineView roda REAL (puro).
vi.mock("@/lib/ai/palpites", () => ({ generatePalpites: vi.fn() }));
// Motor (ADR 0041 §5): default 'llm' (o fan-out de hoje). O fan-out code_jev (#512) é
// mockado aqui — a orquestração real é coberta em best-bet-code-jev.test e
// predict.code-jev.test; aqui trava a cobrança de slots e o repasse.
vi.mock("@/lib/ai/engine/analysis-engine-flag", () => ({
  readAnalysisEngine: vi.fn(),
}));
vi.mock("@/lib/ai/best-bet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/best-bet")>();
  return { ...actual, runCodeJevFanOut: vi.fn() };
});

import { analyzeBestBet } from "@/app/actions/predictions";
import { runCodeJevFanOut } from "@/lib/ai/best-bet";
import { readAnalysisEngine } from "@/lib/ai/engine/analysis-engine-flag";
import { generatePalpites } from "@/lib/ai/palpites";
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
const mockEngine = vi.mocked(readAnalysisEngine);
const mockCodeJevFanOut = vi.mocked(runCodeJevFanOut);

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
    // Kickoff no FUTURO: o gate de analisabilidade (#385) exige scheduled E
    // kickoff > now; data passada cairia em "em andamento" e quebraria o sucesso.
    kickoffAt: new Date("2099-06-11T19:00:00.000Z"),
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
      id: `pred-${marketKey}`,
      aiCallId: `ac-${marketKey}`,
      recommendation: spec.recommendation,
      confidencePct: "55.00",
      oddAtRecommendation: "1.90",
      edgePct: "8.00",
      rationale: `racional ${marketKey}`,
      marketParams: null,
    },
    marketKey,
    selections: spec.selections,
  } as unknown as Awaited<ReturnType<typeof predict>>;
}

const mockGeneratePalpites = vi.mocked(generatePalpites);

// Resultado padrão do gerador de síntese: set com headline + 1 linha exact_score
// pendente (badge null no retorno fresco).
function palpiteResult() {
  return {
    palpiteSet: {
      id: "set-1",
      headline: {
        verdict: "Vai dar a casa",
        confidence: "media" as const,
        narrative: "O mandante leva.",
        citedMarkets: ["Resultado (1X2)"],
        sourcePredictionIds: ["pred-match_result"],
      },
    },
    palpites: [
      {
        type: "exact_score",
        params: { home: 2, away: 1 },
        text: "Placar provável: 2–1",
        settleable: true,
      },
      {
        type: "first_to_score",
        params: { firstToScore: "home" },
        text: "Mandante marca primeiro",
        settleable: true,
      },
    ],
    aiCall: { id: "ac-palpite" },
  } as unknown as Awaited<ReturnType<typeof generatePalpites>>;
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
  // Como o predict real: cobra o slot (hook) logo antes da chamada paga.
  mockPredict.mockImplementation(async (args, opts) => {
    await opts?.beforeLlmPath?.();
    return resultFor(args.marketKey!);
  });
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
  mockGeneratePalpites.mockReset();
  mockGeneratePalpites.mockResolvedValue(palpiteResult());
  mockEngine.mockReset();
  mockEngine.mockResolvedValue("llm");
  mockCodeJevFanOut.mockReset();
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

describe("analyzeBestBet — rate-limit POR MERCADO (#492, Report 01 #3)", () => {
  const ok = { ok: true, limit: 20, remaining: 19, reset: 0 };
  const capped = { ok: false, limit: 7, remaining: 0, reset: 0 };

  it("WC (4 mercados) → EXATAMENTE 4 slots consumidos == 4 predict()", async () => {
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(mockRateLimit).toHaveBeenCalledTimes(4);
    for (const call of mockRateLimit.mock.calls) {
      expect(call).toEqual(["u1", "admin"]);
    }
    expect(mockPredict).toHaveBeenCalledTimes(4);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.view.unavailableMarkets).toBe(0);
  });

  it("non-WC (2 mercados) → 2 slots, não 4", async () => {
    mockGetMatchById.mockResolvedValue(matchInLeague("premier_league"));
    await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(mockRateLimit).toHaveBeenCalledTimes(2);
    expect(mockPredict).toHaveBeenCalledTimes(2);
  });

  it("extra-lines ON NÃO cobra slot extra (linhas extras ≠ mercado extra)", async () => {
    mockExtraLinesFlag.mockResolvedValue(true);
    await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(mockRateLimit).toHaveBeenCalledTimes(4);
    expect(mockPredict).toHaveBeenCalledTimes(4);
  });

  it("budget esgotado ANTES do início → {ok:false}, 1 tentativa de slot, ZERO spend", async () => {
    mockRateLimit.mockResolvedValue(capped);
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(res).toEqual({
      ok: false,
      error: "Você atingiu o limite de 7 análises por dia. Tente novamente amanhã.",
    });
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(mockPredict).not.toHaveBeenCalled();
    expect(mockEnsureOdds).not.toHaveBeenCalled();
    expect(mockGeneratePalpites).not.toHaveBeenCalled();
  });

  it("budget PARCIAL (2 slots) → roda só o prefixo; cauda vira 'indisponível' SEM spend", async () => {
    // O 1º slot (cobrado antes do run) deixa 1 restante → 2 unidades no total.
    mockRateLimit.mockResolvedValueOnce({ ok: true, limit: 20, remaining: 1, reset: 0 });
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    // 1 slot antes do run + 1 sob demanda == 2 chamadas pagas.
    expect(mockRateLimit).toHaveBeenCalledTimes(2);
    // Prefixo Tier-1 (over/under + 1X2) roda; btts/dc NÃO → sem predict nem crédito de odds.
    expect(mockPredict.mock.calls.map((c) => c[0].marketKey)).toEqual([
      "over_under",
      "match_result",
    ]);
    expect(mockEnsureOdds).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.view.entries.map((e) => e.marketKey)).toEqual([
        "over_under",
        "match_result",
      ]);
      expect(res.view.llmCalls).toBe(2);
      // O "melhor" fica explicitamente limitado: os não analisados aparecem com o motivo.
      expect(res.view.errors).toEqual([
        {
          marketKey: "btts",
          marketLabel: expect.any(String),
          message: "Limite diário atingido — não analisado.",
        },
        {
          marketKey: "double_chance",
          marketLabel: expect.any(String),
          message: "Limite diário atingido — não analisado.",
        },
      ]);
      expect(res.view.unavailableMarkets).toBe(2);
    }
    // A síntese vê só as análises que rodaram.
    expect(mockGeneratePalpites.mock.calls[0][0].analyses).toHaveLength(2);
  });

  it("slot negado NO MEIO do run (corrida com outra aba) → o mercado e a cauda viram 'não analisado'", async () => {
    mockRateLimit
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce(ok)
      .mockResolvedValue(capped);
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    // 1º antes do run, 2º sob demanda, 3º negado; o 4º nem tenta (o run parou).
    expect(mockRateLimit).toHaveBeenCalledTimes(3);
    expect(mockPredict).toHaveBeenCalledTimes(3);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.view.entries.map((e) => e.marketKey)).toEqual([
        "over_under",
        "match_result",
      ]);
      expect(res.view.errors.map((e) => [e.marketKey, e.message])).toEqual([
        ["btts", "Limite diário atingido — não analisado."],
        ["double_chance", "Limite diário atingido — não analisado."],
      ]);
    }
  });

  it("mercado que falha ANTES do LLM não pede slot (o 1º, pré-cobrado, vai pra 1ª chamada paga)", async () => {
    const { PredictError } = await import("@/lib/ai/predict");
    mockPredict.mockImplementation(async (args, opts) => {
      if (args.marketKey === "btts")
        throw new PredictError("additional 'btts' sem snapshot fresco", {});
      await opts?.beforeLlmPath?.();
      return resultFor(args.marketKey!);
    });
    await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(mockPredict).toHaveBeenCalledTimes(4);
    // 3 chamadas pagas: a 1ª usa o slot pré-cobrado, as outras 2 cobram o seu.
    expect(mockRateLimit).toHaveBeenCalledTimes(3);
  });

  it("budget parcial + TODOS os concedidos falham → errors[0] é a falha real, não o aviso de teto", async () => {
    mockRateLimit.mockResolvedValueOnce({ ok: true, limit: 20, remaining: 0, reset: 0 });
    const { PredictError } = await import("@/lib/ai/predict");
    mockPredict.mockRejectedValue(new PredictError("sem snapshot fresco", {}));
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(mockPredict).toHaveBeenCalledTimes(1);
    // Só o slot do início do run (a trava contra repetir runs que falham antes do LLM).
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(res).toEqual({
      ok: false,
      error: "Nenhum bookmaker oferece este mercado para o jogo no momento.",
    });
  });

  it("fail-closed (KV ausente p/ não-admin) → copy de indisponibilidade, ZERO spend", async () => {
    mockRateLimit.mockResolvedValue({
      ok: false,
      limit: 0,
      remaining: 0,
      reset: 0,
      reason: "fail-closed",
    });
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(res).toEqual({
      ok: false,
      error: "Análises temporariamente indisponíveis. Tente mais tarde.",
    });
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(mockPredict).not.toHaveBeenCalled();
    expect(mockEnsureOdds).not.toHaveBeenCalled();
  });

  it("fail-closed no MEIO do run → o mercado e a cauda viram 'indisponível', sem spend neles", async () => {
    mockRateLimit.mockResolvedValueOnce(ok).mockResolvedValue({
      ok: false,
      limit: 0,
      remaining: 0,
      reset: 0,
      reason: "fail-closed",
    });
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(mockRateLimit).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.view.entries.map((e) => e.marketKey)).toEqual(["over_under"]);
      expect(new Set(res.view.errors.map((e) => e.message))).toEqual(
        new Set(["Análises temporariamente indisponíveis. Tente mais tarde."]),
      );
    }
  });
});

describe("analyzeBestBet — cota de terceiros só com slot cobrado (#524 re-review)", () => {
  it("N runs concorrentes com 1 slot restante → só UM pré-aquece odds e busca dados", async () => {
    // Limiter atômico de verdade: 1 slot no dia, compartilhado entre os POSTs.
    let left = 1;
    mockRateLimit.mockImplementation(async () => {
      const ok = left > 0;
      if (ok) left--;
      return { ok, limit: 20, remaining: Math.max(0, left), reset: 0 };
    });
    // 1º mercado additional (btts) → o run concedido pré-aquece a odd dele.
    mockMarketsForAudience.mockResolvedValue([BTTS_MARKET]);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        analyzeBestBet(null, form({ matchId: VALID_MATCH_ID })),
      ),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      results.filter(
        (r) =>
          !r.ok &&
          r.error ===
            "Você atingiu o limite de 20 análises por dia. Tente novamente amanhã.",
      ),
    ).toHaveLength(4);
    // Um único pré-warm (crédito da The Odds API) e um único predict (busca de dados).
    expect(mockEnsureOdds).toHaveBeenCalledTimes(1);
    expect(mockPredict).toHaveBeenCalledTimes(1);
    expect(mockRateLimit).toHaveBeenCalledTimes(5);
  });

  it("Upstash em timeout no 1º slot (fail-open, remaining:0) → libera TODOS os mercados, não 1", async () => {
    mockRateLimit.mockResolvedValueOnce({
      ok: true,
      limit: 20,
      remaining: 0,
      reset: 0,
      reason: "timeout",
    });
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(mockPredict).toHaveBeenCalledTimes(4);
    // 1º pré-cobrado + 3 cobrados de forma atômica sob demanda.
    expect(mockRateLimit).toHaveBeenCalledTimes(4);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.view.entries).toHaveLength(4);
      expect(res.view.errors).toEqual([]);
    }
  });

  it("run que falha INTEIRO antes do LLM ainda consome o slot do início (não é repetível de graça)", async () => {
    const { PredictError } = await import("@/lib/ai/predict");
    mockPredict.mockRejectedValue(new PredictError("sem snapshot fresco", {}));
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(res.ok).toBe(false);
    expect(mockPredict).toHaveBeenCalledTimes(4);
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
  });
});

describe("analyzeBestBet — prazo do run (#524 review, maxDuration 300)", () => {
  let clock: number;
  beforeEach(() => {
    clock = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("provider lento estoura o prazo: os mercados restantes são pulados SEM slot, e a síntese roda com o que terminou", async () => {
    // Cada chamada leva 120s. Prazo do fan-out = início + 270s − 25s de reserva = +245s.
    mockPredict.mockImplementation(async (args, opts) => {
      await opts?.beforeLlmPath?.();
      clock += 120_000;
      return resultFor(args.marketKey!);
    });
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    // t=0 e t=120 cabem; em t=240 sobram 5s (< 20s do piso) → para.
    expect(mockPredict.mock.calls.map((c) => c[0].marketKey)).toEqual([
      "over_under",
      "match_result",
    ]);
    expect(mockPredict.mock.calls[0][0].deadlineAt).toBe(1_000_000 + 245_000);
    // Slots == chamadas pagas: os pulados não cobram.
    expect(mockRateLimit).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.view.entries.map((e) => e.marketKey)).toEqual([
        "over_under",
        "match_result",
      ]);
      expect(res.view.errors.map((e) => [e.marketKey, e.message])).toEqual([
        ["btts", "Tempo esgotado — não analisado."],
        ["double_chance", "Tempo esgotado — não analisado."],
      ]);
    }
    // A síntese roda sobre as 2 análises, com o prazo do run inteiro.
    expect(mockGeneratePalpites).toHaveBeenCalledTimes(1);
    const synth = mockGeneratePalpites.mock.calls[0][0];
    expect(synth.analyses).toHaveLength(2);
    expect(synth.deadlineAt).toBe(1_000_000 + 270_000);
  });

  it("sem tempo pra síntese → pula o gerador (sem row falsa em ai_calls), fan-out volta sem manchete", async () => {
    // 2 chamadas de 127,5s: o fan-out para em t=255 (> 245) e sobram 15s (< 20s) do run.
    mockPredict.mockImplementation(async (args, opts) => {
      await opts?.beforeLlmPath?.();
      clock += 127_500;
      return resultFor(args.marketKey!);
    });
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(mockPredict).toHaveBeenCalledTimes(2);
    expect(mockGeneratePalpites).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.view.entries).toHaveLength(2);
      expect(res.palpite).toBeNull();
    }
  });

  it("predict lança o erro de prazo (modelo adaptive não cabe) → 'Tempo esgotado' e o run para", async () => {
    const { AnalysisDeadlineError } = await import("@/lib/ai/deadline");
    mockPredict.mockImplementation(async (args, opts) => {
      if (args.marketKey === "match_result") throw new AnalysisDeadlineError();
      await opts?.beforeLlmPath?.();
      return resultFor(args.marketKey!);
    });
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(mockPredict).toHaveBeenCalledTimes(2);
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.view.errors.map((e) => e.message)).toEqual([
        "Tempo esgotado — não analisado.",
        "Tempo esgotado — não analisado.",
        "Tempo esgotado — não analisado.",
      ]);
    }
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

  it("non-WC (premier_league) → só over_under + match_result (2), SEM pré-warm additional", async () => {
    mockGetMatchById.mockResolvedValue(matchInLeague("premier_league"));
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

  it("extra-lines ON mas liga SEM cobertura (premier_league) → over_under extraLines:false (resolveExtraLines parity)", async () => {
    mockExtraLinesFlag.mockResolvedValue(true);
    mockGetMatchById.mockResolvedValue(matchInLeague("premier_league"));
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

describe("analyzeBestBet — passo de síntese (#353, palpite-first)", () => {
  it("happy: síntese chamada 1× com Haiku + as análises; retorna palpite (manchete)", async () => {
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(mockGeneratePalpites).toHaveBeenCalledTimes(1);
    const args = mockGeneratePalpites.mock.calls[0][0];
    expect(args.matchId).toBe(VALID_MATCH_ID);
    expect(args.userId).toBe("u1");
    expect(args.modelOverride).toBe("claude-haiku-4-5");
    expect(args.deadlineAt).toEqual(expect.any(Number));
    // As análises projetadas alimentam a síntese (1 por mercado WC = 4).
    expect(args.analyses).toHaveLength(4);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.palpite).toEqual({
        verdict: "Vai dar a casa",
        probableScore: { home: 2, away: 1 },
        confidence: "media",
        narrative: "O mandante leva.",
        citedMarkets: ["Resultado (1X2)"],
        badge: null, // fresco → pendente
        // #354: a dimensão first_to_score do set fresco vira chip pendente; exact_score
        // fica na manchete (fora de dimensions).
        dimensions: [{ label: "Mandante marca primeiro", badge: null }],
      });
    }
  });

  it("a manchete retornada NÃO contém número de valor (firewall na fronteira do action)", async () => {
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(res.ok).toBe(true);
    if (res.ok && res.palpite) {
      const serialized = JSON.stringify(res.palpite);
      for (const k of ["edgePct", "evPerUnit", "stakeUnits", "oddAtRecommendation"]) {
        expect(serialized).not.toContain(k);
      }
    }
  });

  it("síntese THROWA → view sobrevive (fan-out pago não descartado), palpite null", async () => {
    mockGeneratePalpites.mockRejectedValue(new Error("haiku timeout"));
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.view.entries).toHaveLength(4); // fan-out intacto
      expect(res.palpite).toBeNull();
    }
  });

  it("síntese NÃO roda quando todos os mercados falham (sem entries, ok:false antes)", async () => {
    const { PredictError } = await import("@/lib/ai/predict");
    mockPredict.mockRejectedValue(new PredictError("sem snapshot fresco", {}));
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(res.ok).toBe(false);
    expect(mockGeneratePalpites).not.toHaveBeenCalled();
  });
});

describe("analyzeBestBet — motor code_jev (#512): 1 slot pelo grupo narrado", () => {
  const capped = { ok: false, limit: 7, remaining: 0, reset: 0 };
  const CORRECT_SCORE_MARKET = { key: "correct_score", label: "Placar exato" };

  beforeEach(() => {
    mockEngine.mockResolvedValue("code_jev");
    // Só o 1º mercado foi narrado; os demais compartilham a ai_call dele.
    mockCodeJevFanOut.mockImplementation(async (_base, markets) =>
      markets.map((m, i) => ({
        ok: true as const,
        marketKey: m.marketKey,
        result: resultFor(m.marketKey),
        ...(i === 0 ? {} : { sharesAiCall: true as const }),
      })),
    );
  });

  it("WC (4 mercados code_jev) → fan-out code_jev com os 4 e o prazo, custo só no narrado", async () => {
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    // A action cobra só o 1º slot (antes do run); o resto é do fan-out (mockado aqui).
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(mockPredict).not.toHaveBeenCalled();
    expect(mockCodeJevFanOut).toHaveBeenCalledTimes(1);
    const [base, markets, , , opts] = mockCodeJevFanOut.mock.calls[0];
    expect(opts).toEqual({ deadlineAt: expect.any(Number) });
    expect(base).toMatchObject({ matchId: VALID_MATCH_ID, userId: "u1", isAdmin: true });
    expect(markets.map((m) => m.marketKey)).toEqual([
      "over_under",
      "match_result",
      "btts",
      "double_chance",
    ]);
    // Custo lido só da ai_call do narrado; os outros cards ficam sem custo próprio.
    expect(mockGetAiCall).toHaveBeenCalledTimes(1);
    expect(mockGetAiCall).toHaveBeenCalledWith("ac-over_under");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.view.entries).toHaveLength(4);
  });

  it("o acquireSlot do run serve o slot pré-cobrado e depois cobra slots reais do mesmo usuário", async () => {
    await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    const acquireSlot = mockCodeJevFanOut.mock.calls[0][3];
    mockRateLimit.mockClear();
    // 1º pedido: o slot já cobrado antes do run (sem nova cobrança).
    expect(await acquireSlot()).toEqual({ ok: true });
    expect(mockRateLimit).not.toHaveBeenCalled();
    mockRateLimit.mockResolvedValueOnce(capped);
    expect(await acquireSlot()).toEqual({ ok: false, reason: undefined });
    expect(mockRateLimit).toHaveBeenCalledWith("u1", "admin");
  });

  it("mercado fora do code_jev (placar exato) cobra o próprio slot; sem budget → não analisado", async () => {
    mockGetMatchById.mockResolvedValue(matchInLeague("brasileirao_a"));
    mockMarketsForAudience.mockResolvedValue([
      OVER_UNDER_MARKET,
      CORRECT_SCORE_MARKET,
      MATCH_RESULT_MARKET,
    ]);
    mockRateLimit.mockResolvedValueOnce({ ok: true, limit: 20, remaining: 0, reset: 0 });

    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));

    // Unidades: [over_under + match_result] (grupo), [correct_score]; só o 1º slot → só o grupo.
    expect(
      mockCodeJevFanOut.mock.calls[0][1].map((m) => m.marketKey),
    ).toEqual(["over_under", "match_result"]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.view.errors).toEqual([
        {
          marketKey: "correct_score",
          marketLabel: expect.any(String),
          message: "Limite diário atingido — não analisado.",
        },
      ]);
    }
  });

  it("budget esgotado → {ok:false}, ZERO spend", async () => {
    mockRateLimit.mockResolvedValue(capped);
    const res = await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(res.ok).toBe(false);
    expect(mockCodeJevFanOut).not.toHaveBeenCalled();
    expect(mockEnsureOdds).not.toHaveBeenCalled();
  });

  it("motor 'llm' → fan-out de hoje (1 slot por mercado), code_jev nunca chamado", async () => {
    mockEngine.mockResolvedValue("llm");
    await analyzeBestBet(null, form({ matchId: VALID_MATCH_ID }));
    expect(mockRateLimit).toHaveBeenCalledTimes(4);
    expect(mockPredict).toHaveBeenCalledTimes(4);
    expect(mockCodeJevFanOut).not.toHaveBeenCalled();
  });
});
