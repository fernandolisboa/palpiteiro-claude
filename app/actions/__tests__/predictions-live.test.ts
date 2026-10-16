import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "next-auth";

// "Analisar com IA" ao vivo (#594, PLAN-580 §8.2). predictInPlay e predict são a
// fronteira do LLM (mockados); loadActionLiveContext, matchPhase e o gate rodam de
// verdade sobre o estado mockado. Nenhuma busca de odds, nenhuma notícia.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ai/predict", () => ({
  IN_PLAY_MARKETS: ["match_result", "double_chance", "btts", "over_under"],
  predict: vi.fn(),
  predictInPlay: vi.fn(),
  PredictError: class PredictError extends Error {
    context: Record<string, unknown>;
    constructor(message: string, context: Record<string, unknown> = {}) {
      super(message);
      this.context = context;
    }
  },
}));
vi.mock("@/lib/bets/slip-model", () => ({ resolveInPlaySlipModel: vi.fn() }));
vi.mock("@/lib/live/in-play-state", () => ({ getInPlayState: vi.fn() }));
vi.mock("@/lib/db/queries/predictions", () => ({
  getAiCallById: vi.fn(),
  getPredictionHistoryForMatch: vi.fn(),
}));
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
vi.mock("@/lib/auth/whitelist", () => ({ isEmailAllowed: vi.fn(() => false) }));
vi.mock("@/lib/rate-limit", () => ({
  checkAnalysisRateLimit: vi.fn(),
  checkPalpitesRateLimit: vi.fn(),
}));
vi.mock("@/lib/view/analysis", () => ({ toAnalysisView: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/palpites", () => ({
  generateLivePalpites: vi.fn(),
  generatePalpites: vi.fn(),
  startNewsFetch: vi.fn(),
}));
vi.mock("@/lib/ai/engine/analysis-engine-flag", () => ({
  readAnalysisEngine: vi.fn(),
}));
vi.mock("@/lib/ai/user-palpite/analysis-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/user-palpite/analysis-context")>()),
  startAnalysisContextExtraction: vi.fn(),
}));
vi.mock("@/lib/db/queries/ai-config", () => ({
  getEnableBestBetFanOut: vi.fn(),
  getEnableLiveMode: vi.fn(),
  getEnableOverUnderExtraLines: vi.fn(),
  getEnableParallelFanOut: vi.fn(),
  getEnableUserContext: vi.fn(),
}));

import { revalidatePath } from "next/cache";

import { analyzeBestBet, generatePalpiteFromAnalyses } from "@/app/actions/predictions";
import { auth } from "@/auth";
import { PredictError, predict, predictInPlay } from "@/lib/ai/predict";
import {
  generateLivePalpites,
  generatePalpites,
  startNewsFetch,
} from "@/lib/ai/palpites";
import { readAnalysisEngine } from "@/lib/ai/engine/analysis-engine-flag";
import { startAnalysisContextExtraction } from "@/lib/ai/user-palpite/analysis-context";
import { resolveInPlaySlipModel } from "@/lib/bets/slip-model";
import {
  getEnableBestBetFanOut,
  getEnableLiveMode,
  getEnableUserContext,
} from "@/lib/db/queries/ai-config";
import { marketsForAudience } from "@/lib/db/queries/market-catalog";
import { getMatchById } from "@/lib/db/queries/matches";
import {
  getAiCallById,
  getPredictionHistoryForMatch,
} from "@/lib/db/queries/predictions";
import { getUserAccessState } from "@/lib/db/queries/users";
import { getInPlayState } from "@/lib/live/in-play-state";
import { ensureOddsSnapshotsFresh } from "@/lib/odds/fetch-and-snapshot";
import { liveColumns, liveStampFromState } from "@/lib/live/stamp";
import { checkAnalysisRateLimit, checkPalpitesRateLimit } from "@/lib/rate-limit";

const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const MATCH_ID = "550e8400-e29b-41d4-a716-446655440000";
const NOW = Date.now();

const SESSION = {
  user: { id: "u1", email: "a@b.com", role: "user" },
  expires: "2099-01-01",
} as unknown as Session;

function liveMatch(kickoffAt = new Date(NOW - 63 * 60_000)) {
  return {
    id: MATCH_ID,
    league: "brasileirao_a",
    status: "live",
    homeTeam: "CR Flamengo",
    awayTeam: "Fluminense FC",
    kickoffAt,
    neutralVenue: false,
  } as unknown as Awaited<ReturnType<typeof getMatchById>>;
}

function freshState() {
  return {
    matchId: MATCH_ID,
    statusShort: "2H",
    elapsed: 63,
    extra: null,
    minuteLabel: "63'",
    score: { home: 1, away: 0 },
    red: { home: 0, away: 0 },
    fetchedAt: new Date(NOW - 10_000),
    ageMs: 10_000,
  };
}

const MODEL = {
  matrix: { cells: [[0, 0], [0.6, 0.4]] },
  inPlay: { liveModelVersion: "live_model_v1", minuteLabel: "63'", score: { home: 1, away: 0 } },
};

// O set que a síntese ao vivo devolve (o selo vem do carimbo).
function liveSet(stampState = freshState()) {
  const cols = liveColumns(liveStampFromState(stampState, new Date(NOW)));
  return {
    palpiteSet: {
      id: "set-live",
      headline: {
        verdict: "O Flamengo segura",
        confidence: "media",
        narrative: "Aos 63', 1 a 0.",
        citedMarkets: [],
        sourcePredictionIds: [],
      },
      ...cols,
    },
    palpites: [
      { id: "l-1", type: "exact_score", text: "Placar 2–0", params: { home: 2, away: 0 }, settleable: true },
    ],
    aiCall: { id: "ac-s" },
  };
}

// Uma prediction ao vivo do histórico, gravada com o estado dado.
function liveHistoryRow(stampState = freshState(), recordedAt = new Date(NOW)) {
  const cols = liveColumns(liveStampFromState(stampState, recordedAt));
  return {
    marketKey: "match_result",
    prediction: {
      id: "pred-live-1",
      recommendation: "pass",
      confidencePct: "70.00",
      edgePct: null,
      oddAtRecommendation: null,
      rationale: "Leitura ao vivo.",
      marketParams: null,
      createdAt: recordedAt,
      ...cols,
    },
    selections: [
      { key: "home", modelProbPct: "70.00" },
      { key: "draw", modelProbPct: "20.00" },
      { key: "away", modelProbPct: "10.00" },
    ],
  };
}

function liveResult(marketKey: string, narrated: boolean) {
  return {
    marketKey,
    narrated,
    result: {
      prediction: {
        id: `pred-${marketKey}`,
        aiCallId: "ac-1",
        recommendation: "pass",
        confidencePct: "60.00",
        oddAtRecommendation: null,
        edgePct: null,
        rationale: "r",
        marketParams: null,
        isLive: true,
      },
      marketKey,
      selections: [],
    },
  } as unknown as Awaited<ReturnType<typeof predictInPlay>>[number];
}

function form(extra: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("matchId", MATCH_ID);
  // A página foi montada ao vivo (o hero manda pageLive=1).
  fd.set("pageLive", "1");
  for (const [k, v] of Object.entries(extra)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(SESSION);
  vi.mocked(getUserAccessState).mockResolvedValue({ role: "user", allowed: true } as never);
  vi.mocked(getEnableBestBetFanOut).mockResolvedValue(true);
  vi.mocked(getEnableLiveMode).mockResolvedValue(true);
  vi.mocked(getEnableUserContext).mockResolvedValue(true);
  vi.mocked(readAnalysisEngine).mockResolvedValue("code_jev");
  vi.mocked(getMatchById).mockResolvedValue(liveMatch());
  vi.mocked(getInPlayState).mockResolvedValue(freshState() as never);
  vi.mocked(resolveInPlaySlipModel).mockResolvedValue(MODEL as never);
  vi.mocked(marketsForAudience).mockResolvedValue([
    { key: "over_under", label: "Total de gols" },
    { key: "match_result", label: "Resultado" },
    { key: "btts", label: "Ambas marcam" },
    { key: "double_chance", label: "Dupla chance" },
    { key: "correct_score", label: "Placar exato" },
  ] as never);
  vi.mocked(checkAnalysisRateLimit).mockResolvedValue({
    ok: true,
    limit: 10,
    remaining: 5,
    reason: undefined,
  } as never);
  vi.mocked(getAiCallById).mockResolvedValue({ costUsd: "0.004000" } as never);
  vi.mocked(predictInPlay).mockResolvedValue([
    liveResult("over_under", false),
    liveResult("match_result", true),
    liveResult("btts", false),
    liveResult("double_chance", false),
  ]);
  vi.mocked(generateLivePalpites).mockResolvedValue(liveSet() as never);
  vi.mocked(checkPalpitesRateLimit).mockResolvedValue({
    ok: true,
    limit: 10,
    remaining: 5,
    reason: undefined,
  } as never);
  vi.mocked(getPredictionHistoryForMatch).mockResolvedValue([liveHistoryRow()] as never);
});

describe("analyzeBestBet ao vivo", () => {
  it("lê o jogo ao vivo: 1 unidade do dia, só os mercados da leitura, sem odds nem notícias nem contexto", async () => {
    const res = await analyzeBestBet(
      null,
      form({ userContext: "O camisa 10 está machucado e não joga hoje." }),
    );
    expect(res.ok).toBe(true);
    expect(checkAnalysisRateLimit).toHaveBeenCalledTimes(1);
    expect(predictInPlay).toHaveBeenCalledTimes(1);
    const call = vi.mocked(predictInPlay).mock.calls[0][0];
    expect(call.marketKeys).toEqual(["over_under", "match_result", "btts", "double_chance"]);
    expect(call.state).toMatchObject({ statusShort: "2H", score: { home: 1, away: 0 } });
    expect(call.scoreline).toBe(MODEL);
    // O estado foi relido no servidor (até 2 min).
    expect(vi.mocked(getInPlayState).mock.calls[0][1]).toMatchObject({ maxAgeMs: 120_000 });
    expect(predict).not.toHaveBeenCalled();
    expect(ensureOddsSnapshotsFresh).not.toHaveBeenCalled();
    expect(startNewsFetch).not.toHaveBeenCalled();
    // "Contexto extra" não vale ao vivo: o texto é descartado.
    expect(startAnalysisContextExtraction).not.toHaveBeenCalled();
    if (res.ok) {
      expect(res.contextNotice).toBeUndefined();
      expect(res.view.entries).toHaveLength(4);
    }
  });

  it("a manchete sai do palpites_live_v1 com o momento do jogo; nunca do pré-jogo", async () => {
    const res = await analyzeBestBet(null, form());
    expect(generatePalpites).not.toHaveBeenCalled();
    expect(generateLivePalpites).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(generateLivePalpites).mock.calls[0][0];
    expect(arg.live.moment).toBe("aos 63'");
    expect(arg.live.state.score).toEqual({ home: 1, away: 0 });
    expect(arg.live.scoreline).toBe(MODEL);
    if (res.ok) {
      expect(res.palpite?.liveLabel).toBe("palpite aos 63' (1–0)");
    }
  });

  it("página de pré-jogo (pageLive ausente/0): pede para atualizar, sem cobrar", async () => {
    for (const fd of [form({ pageLive: "0" }), (() => {
      const f = form();
      f.delete("pageLive");
      return f;
    })()]) {
      const res = await analyzeBestBet(null, fd);
      expect(res).toEqual({
        ok: false,
        error: "O jogo começou. Atualize a página para a leitura ao vivo.",
      });
    }
    expect(checkAnalysisRateLimit).not.toHaveBeenCalled();
    expect(predictInPlay).not.toHaveBeenCalled();
    // Portão grátis: nem o modelo em jogo é resolvido.
    expect(resolveInPlaySlipModel).not.toHaveBeenCalled();
  });

  it("flag desligada: a copy de antes, sem cobrar nem ler o estado", async () => {
    vi.mocked(getEnableLiveMode).mockResolvedValue(false);
    const res = await analyzeBestBet(null, form());
    expect(res).toEqual({
      ok: false,
      error: "Jogo em andamento — a análise fica disponível só antes do apito inicial.",
    });
    expect(getInPlayState).not.toHaveBeenCalled();
    expect(checkAnalysisRateLimit).not.toHaveBeenCalled();
    expect(predictInPlay).not.toHaveBeenCalled();
  });

  it("sem modelo em jogo: 'Sem modelo para a leitura ao vivo', sem cobrar", async () => {
    vi.mocked(resolveInPlaySlipModel).mockResolvedValue(null);
    const res = await analyzeBestBet(null, form());
    expect(res).toEqual({ ok: false, error: "Sem modelo para a leitura ao vivo deste jogo." });
    expect(checkAnalysisRateLimit).not.toHaveBeenCalled();
  });

  it("sem estado utilizável: 'Placar ao vivo indisponível', sem cobrar nem calcular o modelo", async () => {
    vi.mocked(getInPlayState).mockResolvedValue(null);
    const res = await analyzeBestBet(null, form());
    expect(res).toEqual({
      ok: false,
      error: "Placar ao vivo indisponível agora. Tente em um minuto.",
    });
    expect(resolveInPlaySlipModel).not.toHaveBeenCalled();
    expect(checkAnalysisRateLimit).not.toHaveBeenCalled();
  });

  it("prorrogação: mercados de 90' decididos, sem leitura", async () => {
    vi.mocked(getInPlayState).mockResolvedValue({
      ...freshState(),
      statusShort: "ET",
      elapsed: 95,
    } as never);
    const res = await analyzeBestBet(null, form());
    expect(res.ok).toBe(false);
    expect(checkAnalysisRateLimit).not.toHaveBeenCalled();
  });

  it("limite do dia: recusa antes do predictInPlay", async () => {
    vi.mocked(checkAnalysisRateLimit).mockResolvedValue({
      ok: false,
      limit: 10,
      remaining: 0,
    } as never);
    const res = await analyzeBestBet(null, form());
    expect(res).toEqual({
      ok: false,
      error: "Você atingiu o limite de 10 análises por dia. Tente novamente amanhã.",
    });
    expect(predictInPlay).not.toHaveBeenCalled();
  });

  // A rechecagem em si (relógio de agora) é testada em lib/ai/__tests__/predict.in-play;
  // aqui, a recusa dela vira a copy certa e a página é revalidada.
  it("predictInPlay recusa (o estado envelheceu) → copy do placar indisponível", async () => {
    vi.mocked(predictInPlay).mockRejectedValue(
      new PredictError("match is not analyzable live", {}),
    );
    const res = await analyzeBestBet(null, form());
    expect(res).toEqual({
      ok: false,
      error: "Placar ao vivo indisponível agora. Tente em um minuto.",
    });
    // Leituras gravadas antes da falha aparecem na página.
    expect(revalidatePath).toHaveBeenCalledWith(`/match/${MATCH_ID}`);
  });
});

describe("corrida no pré-jogo (o jogo apitou durante o run)", () => {
  beforeEach(() => {
    vi.mocked(readAnalysisEngine).mockResolvedValue("llm");
    // A action vê o jogo antes do apito; o predict (mockado) já o vê começado.
    vi.mocked(getMatchById).mockResolvedValue({
      ...liveMatch(new Date(NOW + 60 * 60_000)),
      status: "scheduled",
    } as never);
    vi.mocked(marketsForAudience).mockResolvedValue([
      { key: "match_result", label: "Resultado" },
    ] as never);
    vi.mocked(predict).mockRejectedValue(
      new PredictError("match is not analyzable", {
        status: "scheduled",
        kickoffMs: NOW - 60_000,
      }),
    );
  });

  it("modo ao vivo ligado: convida pra leitura ao vivo", async () => {
    const res = await analyzeBestBet(null, form());
    expect(res).toEqual({
      ok: false,
      error: "O jogo começou. Atualize a página para a leitura ao vivo.",
    });
    expect(generatePalpites).not.toHaveBeenCalled();
  });

  it("modo ao vivo desligado: a copy de hoje", async () => {
    vi.mocked(getEnableLiveMode).mockResolvedValue(false);
    const res = await analyzeBestBet(null, form());
    expect(res).toEqual({
      ok: false,
      error: "Jogo em andamento — a análise fica disponível só antes do apito inicial.",
    });
  });
});

describe("Gerar só o palpite ao vivo", () => {
  it("sintetiza sobre as leituras ao vivo do mesmo momento, mesma cota de palpites", async () => {
    const res = await generatePalpiteFromAnalyses(null, form());
    expect(res.ok).toBe(true);
    expect(checkPalpitesRateLimit).toHaveBeenCalledTimes(1);
    expect(generatePalpites).not.toHaveBeenCalled();
    const arg = vi.mocked(generateLivePalpites).mock.calls[0][0];
    expect(arg.analyses.map((a) => a.predictionId)).toEqual(["pred-live-1"]);
    expect(arg.live.moment).toBe("aos 63'");
    expect(vi.mocked(getInPlayState).mock.calls[0][1]).toMatchObject({ maxAgeMs: 120_000 });
    if (res.ok) expect(res.palpite?.liveLabel).toBe("palpite aos 63' (1–0)");
  });

  it("sem leitura ao vivo (só análises de pré-jogo): manda pro Analisar com IA", async () => {
    const pre = liveHistoryRow();
    vi.mocked(getPredictionHistoryForMatch).mockResolvedValue([
      { ...pre, prediction: { ...pre.prediction, isLive: false, liveState: null } },
    ] as never);
    const res = await generatePalpiteFromAnalyses(null, form());
    expect(res).toEqual({
      ok: false,
      error: 'Ainda não há leitura ao vivo deste jogo. Use "Analisar com IA".',
    });
    expect(checkPalpitesRateLimit).not.toHaveBeenCalled();
    expect(generateLivePalpites).not.toHaveBeenCalled();
  });

  it("o placar mudou desde a leitura: pede uma leitura nova", async () => {
    vi.mocked(getPredictionHistoryForMatch).mockResolvedValue([
      liveHistoryRow({ ...freshState(), score: { home: 0, away: 0 } }),
    ] as never);
    const res = await generatePalpiteFromAnalyses(null, form());
    expect(res).toEqual({
      ok: false,
      error: "O jogo mudou desde a última leitura. Use Analisar com IA.",
    });
    expect(checkPalpitesRateLimit).not.toHaveBeenCalled();
  });

  it("leitura com mais de 10 min: também pede uma leitura nova", async () => {
    vi.mocked(getPredictionHistoryForMatch).mockResolvedValue([
      liveHistoryRow(freshState(), new Date(NOW - 11 * 60_000)),
    ] as never);
    const res = await generatePalpiteFromAnalyses(null, form());
    expect(res).toEqual({
      ok: false,
      error: "O jogo mudou desde a última leitura. Use Analisar com IA.",
    });
  });

  it("flag desligada: o gate de hoje, sem ler o estado", async () => {
    vi.mocked(getEnableLiveMode).mockResolvedValue(false);
    const res = await generatePalpiteFromAnalyses(null, form());
    expect(res).toEqual({
      ok: false,
      error: "Jogo em andamento — a análise fica disponível só antes do apito inicial.",
    });
    expect(getInPlayState).not.toHaveBeenCalled();
    expect(generateLivePalpites).not.toHaveBeenCalled();
  });

  it("página de pré-jogo: pede para atualizar, sem cobrar nem resolver o modelo", async () => {
    const res = await generatePalpiteFromAnalyses(null, form({ pageLive: "0" }));
    expect(res).toEqual({
      ok: false,
      error: "O jogo começou. Atualize a página para a leitura ao vivo.",
    });
    expect(checkPalpitesRateLimit).not.toHaveBeenCalled();
    expect(resolveInPlaySlipModel).not.toHaveBeenCalled();
  });

  it("sem modelo em jogo: recusa sem cobrar", async () => {
    vi.mocked(resolveInPlaySlipModel).mockResolvedValue(null);
    const res = await generatePalpiteFromAnalyses(null, form());
    expect(res).toEqual({ ok: false, error: "Sem modelo para a leitura ao vivo deste jogo." });
    expect(checkPalpitesRateLimit).not.toHaveBeenCalled();
  });
});
