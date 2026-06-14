import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "next-auth";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/ai/predict", () => ({
  predict: vi.fn(),
  // PredictError precisa ser uma classe pro `instanceof` na action.
  PredictError: class PredictError extends Error {
    context: unknown;
    constructor(message: string, context?: unknown) {
      super(message);
      this.context = context;
    }
  },
}));
vi.mock("@/lib/db/queries/predictions", () => ({
  getAiCallById: vi.fn(),
}));
// marketsForAudience é a fonte do gate de mercado re-validado na action. Mockada
// pra refletir o comportamento real (admin vê match_result; comum só over_under)
// sem tocar no DB.
vi.mock("@/lib/db/queries/market-catalog", () => ({
  marketsForAudience: vi.fn(),
}));
vi.mock("@/lib/db/queries/users", () => ({ userExists: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkAnalysisRateLimit: vi.fn() }));
vi.mock("@/lib/view/analysis", () => ({ toAnalysisView: vi.fn(() => ({})) }));

import { analyzeMatch } from "@/app/actions/predictions";
import { auth } from "@/auth";
import { predict } from "@/lib/ai/predict";
import { marketsForAudience } from "@/lib/db/queries/market-catalog";
import { getAiCallById } from "@/lib/db/queries/predictions";
import { userExists } from "@/lib/db/queries/users";
import { checkAnalysisRateLimit } from "@/lib/rate-limit";
import { toAnalysisView } from "@/lib/view/analysis";

// `auth` é sobrecarregado; estreitamos pro uso como `auth()`.
const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const mockPredict = vi.mocked(predict);
const mockMarketsForAudience = vi.mocked(marketsForAudience);
const mockUserExists = vi.mocked(userExists);
const mockGetAiCall = vi.mocked(getAiCallById);
const mockRateLimit = vi.mocked(checkAnalysisRateLimit);
const mockToAnalysisView = vi.mocked(toAnalysisView);

const OVER_UNDER_MARKET = { key: "over_under", label: "Over/Under gols" };
const MATCH_RESULT_MARKET = { key: "match_result", label: "Resultado (1X2)" };

const SESSION = {
  user: { id: "u1", email: "a@b.com", role: "admin" },
  expires: "2099-01-01",
} as unknown as Session;

const USER_SESSION = {
  user: { id: "u2", email: "c@d.com", role: "user" },
  expires: "2099-01-01",
} as unknown as Session;

// Carrier N-vias retornado por predict() (#173): { prediction, marketKey, selections }.
// A action destrutura isto e monta a view via toAnalysisView — o mock precisa do
// shape novo (não o flat antigo), senão o caminho de sucesso/destructure não é
// exercitado (prediction.aiCallId estouraria e a action cairia no catch).
const PREDICTION = {
  prediction: {
    aiCallId: "ac1",
    recommendation: "over",
    confidencePct: "60.00",
    rationale: "r",
    keyFactors: ["a", "b"],
    minimumOdd: "1.800",
    oddAtRecommendation: "1.850",
    bookmaker: "BetX",
    impliedProbPct: "54.05",
    edgePct: "5.00",
    overOddAtPrediction: "1.850",
    underOddAtPrediction: "2.000",
    marketParams: { line: 2.5 },
    stakeUnits: "1.00",
    modelVersion: "claude-opus-4-8",
    promptVersion: "over_under_v1.2",
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
  },
  marketKey: "over_under",
  selections: [
    { key: "over", modelProbPct: 60, odd: 1.85 },
    { key: "under", modelProbPct: 40, odd: 2.0 },
  ],
} as unknown as Awaited<ReturnType<typeof predict>>;

const VALID_MATCH_ID = "550e8400-e29b-41d4-a716-446655440000";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  mockAuth.mockReset();
  mockPredict.mockReset();
  mockUserExists.mockReset();
  mockGetAiCall.mockReset();
  // Só limpa o histórico de chamadas (mantém o `() => ({})` do vi.mock) pra os
  // testes que inspecionam os args com que toAnalysisView foi chamada.
  mockToAnalysisView.mockClear();
  // Gate transparente por padrão (ok) pra que os testes existentes sigam verdes;
  // os testes específicos do rate-limit sobrescrevem.
  mockRateLimit.mockReset();
  mockRateLimit.mockResolvedValue({
    ok: true,
    limit: 20,
    remaining: 19,
    reset: 0,
  });
  // Gate de mercado audiência-aware (espelha o resolver real): admin vê
  // over_under + match_result; comum só over_under.
  mockMarketsForAudience.mockReset();
  mockMarketsForAudience.mockImplementation(async (isAdmin: boolean) =>
    isAdmin
      ? [OVER_UNDER_MARKET, MATCH_RESULT_MARKET]
      : [OVER_UNDER_MARKET],
  );
});

describe("analyzeMatch", () => {
  it("rejects an unauthenticated request without calling predict (no Anthropic cost)", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await analyzeMatch(null, form({ matchId: VALID_MATCH_ID }));
    expect(res).toMatchObject({ ok: false });
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("rejects a missing matchId before touching auth", async () => {
    const res = await analyzeMatch(null, form({}));
    expect(res).toEqual({ ok: false, error: "matchId ausente" });
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("rejects a malformed (non-UUID) matchId without calling predict (no DB round-trip)", async () => {
    const res = await analyzeMatch(null, form({ matchId: "foo" }));
    expect(res).toEqual({
      ok: false,
      error: "Identificador de jogo inválido.",
    });
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("bounces a session whose user row no longer exists, without calling predict (no Anthropic cost)", async () => {
    mockAuth.mockResolvedValue(SESSION);
    mockUserExists.mockResolvedValue(false);
    const res = await analyzeMatch(null, form({ matchId: VALID_MATCH_ID }));
    expect(res).toEqual({
      ok: false,
      error: "Sua sessão expirou. Faça login novamente.",
    });
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("rejects a rate-limited request without calling predict (no Anthropic cost)", async () => {
    mockAuth.mockResolvedValue(SESSION);
    mockUserExists.mockResolvedValue(true);
    // limit:7 (não o default 20) prova que a mensagem é interpolada do limite
    // retornado pelo gate, não um "20" hardcoded.
    mockRateLimit.mockResolvedValue({
      ok: false,
      limit: 7,
      remaining: 0,
      reset: 0,
    });
    const res = await analyzeMatch(null, form({ matchId: VALID_MATCH_ID }));
    expect(res).toEqual({
      ok: false,
      error: "Você atingiu o limite de 7 análises por dia. Tente novamente amanhã.",
    });
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("passes the user id and role to the rate-limit gate before predicting", async () => {
    mockAuth.mockResolvedValue(USER_SESSION);
    mockUserExists.mockResolvedValue(true);
    mockPredict.mockResolvedValue(PREDICTION);
    mockGetAiCall.mockResolvedValue({ costUsd: "0.01" } as never);
    await analyzeMatch(null, form({ matchId: VALID_MATCH_ID }));
    expect(mockRateLimit).toHaveBeenCalledWith("u2", "user");
    expect(mockPredict).toHaveBeenCalled();
  });

  it("forwards an admin session's role to the rate-limit gate (admin tier)", async () => {
    mockAuth.mockResolvedValue(SESSION);
    mockUserExists.mockResolvedValue(true);
    mockPredict.mockResolvedValue(PREDICTION);
    mockGetAiCall.mockResolvedValue({ costUsd: "0.01" } as never);
    await analyzeMatch(null, form({ matchId: VALID_MATCH_ID }));
    expect(mockRateLimit).toHaveBeenCalledWith("u1", "admin");
    expect(mockPredict).toHaveBeenCalled();
  });
});

describe("analyzeMatch — model override gating", () => {
  beforeEach(() => {
    mockUserExists.mockResolvedValue(true);
    mockPredict.mockResolvedValue(PREDICTION);
    mockGetAiCall.mockResolvedValue({ costUsd: "0.01" } as never);
  });

  it("regular user + userSelectable override (Haiku) is forwarded to predict", async () => {
    mockAuth.mockResolvedValue(USER_SESSION);
    await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, modelOverride: "claude-haiku-4-5" }),
    );
    expect(mockPredict).toHaveBeenCalledWith({
      matchId: VALID_MATCH_ID,
      userId: "u2",
      isAdmin: false,
      modelOverride: "claude-haiku-4-5",
      marketKey: "over_under",
    });
  });

  it("regular user + admin-only override (Fable) is IGNORED (out of audience)", async () => {
    mockAuth.mockResolvedValue(USER_SESSION);
    await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, modelOverride: "claude-fable-5" }),
    );
    expect(mockPredict).toHaveBeenCalledWith({
      matchId: VALID_MATCH_ID,
      userId: "u2",
      isAdmin: false,
      modelOverride: undefined,
      marketKey: "over_under",
    });
  });

  it("admin + admin-only override (Fable) is forwarded to predict", async () => {
    mockAuth.mockResolvedValue(SESSION);
    await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, modelOverride: "claude-fable-5" }),
    );
    expect(mockPredict).toHaveBeenCalledWith({
      matchId: VALID_MATCH_ID,
      userId: "u1",
      isAdmin: true,
      modelOverride: "claude-fable-5",
      marketKey: "over_under",
    });
  });

  it("admin + userSelectable override (Sonnet 4.5 valid id) is forwarded", async () => {
    mockAuth.mockResolvedValue(SESSION);
    await analyzeMatch(
      null,
      form({
        matchId: VALID_MATCH_ID,
        modelOverride: "claude-sonnet-4-5-20250929",
      }),
    );
    expect(mockPredict).toHaveBeenCalledWith({
      matchId: VALID_MATCH_ID,
      userId: "u1",
      isAdmin: true,
      modelOverride: "claude-sonnet-4-5-20250929",
      marketKey: "over_under",
    });
  });

  it("non-admin override of a non-userSelectable id (Sonnet 4.5) is IGNORED", async () => {
    mockAuth.mockResolvedValue(USER_SESSION);
    await analyzeMatch(
      null,
      form({
        matchId: VALID_MATCH_ID,
        modelOverride: "claude-sonnet-4-5-20250929",
      }),
    );
    expect(mockPredict).toHaveBeenCalledWith({
      matchId: VALID_MATCH_ID,
      userId: "u2",
      isAdmin: false,
      modelOverride: undefined,
      marketKey: "over_under",
    });
  });

  it("admin + invalid model id → override ignored", async () => {
    mockAuth.mockResolvedValue(SESSION);
    await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, modelOverride: "gpt-4" }),
    );
    expect(mockPredict).toHaveBeenCalledWith({
      matchId: VALID_MATCH_ID,
      userId: "u1",
      isAdmin: true,
      modelOverride: undefined,
      marketKey: "over_under",
    });
  });

  it('"default" sentinel → override undefined (use global default)', async () => {
    mockAuth.mockResolvedValue(SESSION);
    await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, modelOverride: "default" }),
    );
    expect(mockPredict).toHaveBeenCalledWith({
      matchId: VALID_MATCH_ID,
      userId: "u1",
      isAdmin: true,
      modelOverride: undefined,
      marketKey: "over_under",
    });
  });
});

describe("analyzeMatch — market audience gating", () => {
  beforeEach(() => {
    mockUserExists.mockResolvedValue(true);
    mockPredict.mockResolvedValue(PREDICTION);
    mockGetAiCall.mockResolvedValue({ costUsd: "0.01" } as never);
  });

  it("admin selecting match_result (in-audience) threads it to predict", async () => {
    mockAuth.mockResolvedValue(SESSION);
    await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, marketKey: "match_result" }),
    );
    expect(mockPredict).toHaveBeenCalledWith({
      matchId: VALID_MATCH_ID,
      userId: "u1",
      isAdmin: true,
      modelOverride: undefined,
      marketKey: "match_result",
    });
  });

  it("non-admin POSTing marketKey=match_result (out of audience) is COERCED to over_under", async () => {
    mockAuth.mockResolvedValue(USER_SESSION);
    await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, marketKey: "match_result" }),
    );
    // Defesa em profundidade: o resolver de audiência não devolve match_result pro
    // usuário comum, então a action coerce o POST forjado pro default over_under —
    // NUNCA chama predict com o mercado proibido.
    expect(mockPredict).toHaveBeenCalledWith({
      matchId: VALID_MATCH_ID,
      userId: "u2",
      isAdmin: false,
      modelOverride: undefined,
      marketKey: "over_under",
    });
  });

  it("an unknown marketKey is coerced to over_under (admin)", async () => {
    mockAuth.mockResolvedValue(SESSION);
    await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, marketKey: "asian_handicap" }),
    );
    expect(mockPredict).toHaveBeenCalledWith({
      matchId: VALID_MATCH_ID,
      userId: "u1",
      isAdmin: true,
      modelOverride: undefined,
      marketKey: "over_under",
    });
  });
});

// Caminho de SUCESSO: o carrier N-vias de predict() (#173) é destruturado e
// threadeado em toAnalysisView (marketKey RESOLVIDO + candidate set), e a action
// devolve { ok: true, view }. Sem o mock no shape novo, este caminho nem rodaria.
describe("analyzeMatch — success path view wiring", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockUserExists.mockResolvedValue(true);
    mockPredict.mockResolvedValue(PREDICTION);
    mockGetAiCall.mockResolvedValue({ costUsd: "0.01" } as never);
  });

  it("thread o marketKey resolvido + selections do carrier pra toAnalysisView e devolve { ok: true, view }", async () => {
    const res = await analyzeMatch(null, form({ matchId: VALID_MATCH_ID }));

    expect(res).toEqual({ ok: true, view: {} });
    expect(mockToAnalysisView).toHaveBeenCalledTimes(1);

    const [predictionArg, aiCallArg] = mockToAnalysisView.mock.calls[0];
    // marketKey RESOLVIDO pelo carrier (não o literal 'over_under' hardcoded).
    expect(predictionArg.marketKey).toBe("over_under");
    // candidate set N-vias do carrier flui pra view (grade de cenários).
    expect(predictionArg.selections).toEqual([
      { key: "over", modelProbPct: 60, odd: 1.85 },
      { key: "under", modelProbPct: 40, odd: 2.0 },
    ]);
    // campos da prediction destruturados do carrier.prediction.
    expect(predictionArg.recommendation).toBe("over");
    expect(predictionArg.stakeUnits).toBe("1.00");
    expect(predictionArg.line).toBe(2.5);
    // custo vem do getAiCallById(prediction.aiCallId).
    expect(aiCallArg).toEqual({ costUsd: "0.01" });
  });

  it("admin analisando match_result: o marketKey 1X2 do carrier chega na view", async () => {
    mockPredict.mockResolvedValue({
      prediction: {
        ...PREDICTION.prediction,
        recommendation: "home",
        marketParams: null,
        overOddAtPrediction: null,
        underOddAtPrediction: null,
        promptVersion: "match_result_v1",
      },
      marketKey: "match_result",
      selections: [
        { key: "home", modelProbPct: 52, odd: 2.1 },
        { key: "draw", modelProbPct: 27, odd: 3.4 },
        { key: "away", modelProbPct: 21, odd: 3.6 },
      ],
    } as unknown as Awaited<ReturnType<typeof predict>>);

    const res = await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, marketKey: "match_result" }),
    );

    expect(res).toEqual({ ok: true, view: {} });
    const [predictionArg] = mockToAnalysisView.mock.calls[0];
    expect(predictionArg.marketKey).toBe("match_result");
    expect(predictionArg.selections).toHaveLength(3);
    expect(predictionArg.line).toBeNull();
  });
});
