import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "next-auth";

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
// O reader cache-first + getAiCallById. getLatestPredictionForPin é o ponto de
// fixação (lê a distribuição persistida); mockado pra controlar HIT/MISS sem DB.
vi.mock("@/lib/db/queries/predictions", () => ({
  getAiCallById: vi.fn(),
  getLatestPredictionForPin: vi.fn(),
}));
// marketsForAudience mockada (admin vê match_result; comum só over_under);
// marketsForLeague REAL (gate de cobertura, descriptor-driven).
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
vi.mock("@/lib/rate-limit", () => ({ checkAnalysisRateLimit: vi.fn() }));
vi.mock("@/lib/db/queries/ai-config", () => ({
  getEnableOverUnderExtraLines: vi.fn(),
}));
vi.mock("@/lib/server/request-timezone", () => ({
  getRequestTimeZone: vi.fn(async () => "America/Sao_Paulo"),
}));

import { gradeMyBet } from "@/app/actions/predictions";
import { auth } from "@/auth";
import { predict } from "@/lib/ai/predict";
import { getEnableOverUnderExtraLines } from "@/lib/db/queries/ai-config";
import { marketsForAudience } from "@/lib/db/queries/market-catalog";
import { getMatchById } from "@/lib/db/queries/matches";
import {
  getAiCallById,
  getLatestPredictionForPin,
} from "@/lib/db/queries/predictions";
import { getUserAccessState } from "@/lib/db/queries/users";
import { checkAnalysisRateLimit } from "@/lib/rate-limit";

const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const mockPredict = vi.mocked(predict);
const mockMarketsForAudience = vi.mocked(marketsForAudience);
const mockGetMatchById = vi.mocked(getMatchById);
const mockGetAccess = vi.mocked(getUserAccessState);
const mockGetLatestPin = vi.mocked(getLatestPredictionForPin);
const mockRateLimit = vi.mocked(checkAnalysisRateLimit);
const mockExtraLinesFlag = vi.mocked(getEnableOverUnderExtraLines);
vi.mocked(getAiCallById).mockResolvedValue(null);

const OVER_UNDER_MARKET = { key: "over_under", label: "Over/Under gols" };
const MATCH_RESULT_MARKET = { key: "match_result", label: "Resultado (1X2)" };
const BTTS_MARKET = { key: "btts", label: "Ambas marcam" };

const VALID_MATCH_ID = "550e8400-e29b-41d4-a716-446655440000";

function matchInLeague(league: string, status = "scheduled") {
  return {
    id: VALID_MATCH_ID,
    league,
    status,
    homeTeam: "Mexico",
    awayTeam: "South Africa",
    kickoffAt: new Date("2099-06-11T19:00:00.000Z"),
  } as unknown as Awaited<ReturnType<typeof getMatchById>>;
}

const ADMIN_SESSION = {
  user: { id: "u1", email: "a@b.com", role: "admin" },
  expires: "2099-01-01",
} as unknown as Session;
const USER_SESSION = {
  user: { id: "u2", email: "c@d.com", role: "user" },
  expires: "2099-01-01",
} as unknown as Session;

// PredictionWithAiCall stub — numeric cols são STRINGS (drizzle), `selections` já
// Number()'do (mapSelectionRow). O reader devolve esta forma.
function pinHit(over: {
  recommendation?: string;
  edgePct?: string | null;
  impliedProbPct?: string | null;
  stakeUnits?: string | null;
  line?: number | null;
  marketKey?: string;
  selections?: { key: string; modelProbPct: number; odd: number | null }[];
}) {
  return {
    prediction: {
      recommendation: over.recommendation ?? "over",
      edgePct: over.edgePct ?? "7.35",
      impliedProbPct: over.impliedProbPct ?? "50.65",
      stakeUnits: over.stakeUnits ?? "2.00",
      marketParams:
        over.line === undefined ? { line: 2.5 } : over.line === null ? null : { line: over.line },
      createdAt: new Date("2026-06-15T00:00:00.000Z"),
    },
    aiCall: null,
    marketKey: over.marketKey ?? "over_under",
    selections: over.selections ?? [
      { key: "over", modelProbPct: 58, odd: 1.92 },
      { key: "under", modelProbPct: 42, odd: 1.95 },
    ],
  } as unknown as Awaited<ReturnType<typeof getLatestPredictionForPin>>;
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

const OU_OVER = {
  matchId: VALID_MATCH_ID,
  marketKey: "over_under",
  selectionKey: "over",
  line: "2.5",
  odd: "2.0",
};

beforeEach(() => {
  mockAuth.mockReset();
  mockAuth.mockResolvedValue(USER_SESSION);
  mockPredict.mockReset();
  mockGetAccess.mockReset();
  mockGetAccess.mockResolvedValue({ role: "user", allowed: true });
  mockGetLatestPin.mockReset();
  mockRateLimit.mockReset();
  mockRateLimit.mockResolvedValue({ ok: true, limit: 20, remaining: 19, reset: 0 });
  mockExtraLinesFlag.mockReset();
  mockExtraLinesFlag.mockResolvedValue(false);
  mockMarketsForAudience.mockReset();
  mockMarketsForAudience.mockImplementation(async () => [
    OVER_UNDER_MARKET,
    MATCH_RESULT_MARKET,
    BTTS_MARKET,
  ]);
  mockGetMatchById.mockReset();
  mockGetMatchById.mockResolvedValue(matchInLeague("brasileirao_a"));
});

describe("gradeMyBet — gates de pré-spend (ordem load-bearing)", () => {
  it("não-autenticado → erro SEM predict/rate-limit/reader", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await gradeMyBet(null, form(OU_OVER));
    expect(res.ok).toBe(false);
    expect(mockGetLatestPin).not.toHaveBeenCalled();
    expect(mockPredict).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("matchId inválido → erro de identificador", async () => {
    const res = await gradeMyBet(null, form({ ...OU_OVER, matchId: "nope" }));
    expect(res).toEqual({ ok: false, error: "Identificador de jogo inválido." });
  });

  it("jogo não-analisável (live) → nao-analisavel verbatim, SEM reader/predict", async () => {
    mockGetMatchById.mockResolvedValue(matchInLeague("brasileirao_a", "live"));
    const res = await gradeMyBet(null, form(OU_OVER));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe("nao-analisavel");
    expect(mockGetLatestPin).not.toHaveBeenCalled();
    expect(mockPredict).not.toHaveBeenCalled();
  });
});

describe("gradeMyBet — Zod boundary (PT-BR + coerce, ANTES do reader)", () => {
  it("odd ≤ 1 ('0,99') → input-invalido ANTES de getLatestPredictionForPin", async () => {
    const res = await gradeMyBet(null, form({ ...OU_OVER, odd: "0,99" }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe("input-invalido");
    expect(mockGetLatestPin).not.toHaveBeenCalled();
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("odd não-numérica ('abc') → input-invalido", async () => {
    const res = await gradeMyBet(null, form({ ...OU_OVER, odd: "abc" }));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe("input-invalido");
  });

  it("odd PT-BR '1,85' aceita → segue pro reader (não input-invalido)", async () => {
    mockGetLatestPin.mockResolvedValue(pinHit({ recommendation: "over" }));
    const res = await gradeMyBet(null, form({ ...OU_OVER, odd: "1,85" }));
    expect(res.ok).toBe(true);
    expect(mockGetLatestPin).toHaveBeenCalled();
  });

  it("linha '2.5' (string FormData) coercida → HIT no cache numérico-2.5 SEM predict", async () => {
    mockGetLatestPin.mockResolvedValue(pinHit({ recommendation: "over", line: 2.5 }));
    const res = await gradeMyBet(null, form(OU_OVER));
    expect(res.ok).toBe(true);
    expect(mockPredict).not.toHaveBeenCalled();
    // line passada ao reader é o number 2.5 (coercido).
    expect(mockGetLatestPin).toHaveBeenCalledWith(
      VALID_MATCH_ID,
      "u2",
      "over_under",
      2.5,
    );
  });
});

describe("gradeMyBet — cache HIT zero-LLM + persisted Number() na fronteira", () => {
  it("HIT → NÃO chama predict NEM rate-limit; persisted edge='7.35'(str)→7.35(num)", async () => {
    mockGetLatestPin.mockResolvedValue(
      pinHit({ recommendation: "over", edgePct: "7.35", stakeUnits: "2.00" }),
    );
    const res = await gradeMyBet(null, form(OU_OVER));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    if (res.view.kind !== "grade-coberto") throw new Error(res.view.kind);
    expect(res.view.edge).toBe(7.35);
    expect(typeof res.view.edge).toBe("number");
    expect(res.view.stakeUnits).toBe(2); // persisted, Number()'d
    expect(mockPredict).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("cache 1X2 null-line HIT zero-LLM (pin 1X2 → reader recebe line=null)", async () => {
    mockAuth.mockResolvedValue(ADMIN_SESSION); // 1X2 é admin-only
    mockGetAccess.mockResolvedValue({ role: "admin", allowed: true });
    mockGetLatestPin.mockResolvedValue(
      pinHit({
        recommendation: "home",
        marketKey: "match_result",
        line: null,
        selections: [
          { key: "home", modelProbPct: 55, odd: 1.9 },
          { key: "draw", modelProbPct: 25, odd: 3.5 },
          { key: "away", modelProbPct: 20, odd: 4.2 },
        ],
      }),
    );
    const res = await gradeMyBet(
      null,
      form({
        matchId: VALID_MATCH_ID,
        marketKey: "match_result",
        selectionKey: "home",
        odd: "1.95",
      }),
    );
    expect(res.ok).toBe(true);
    expect(mockPredict).not.toHaveBeenCalled();
    expect(mockGetLatestPin).toHaveBeenCalledWith(
      VALID_MATCH_ID,
      "u1",
      "match_result",
      null,
    );
  });
});

describe("gradeMyBet — MISS → rate-limit → predict; degrada se rate-limited", () => {
  it("MISS modelável → rate-limit + predict, depois re-lê o reader", async () => {
    mockGetLatestPin
      .mockResolvedValueOnce(null) // 1º: MISS
      .mockResolvedValueOnce(pinHit({ recommendation: "over" })); // 2º: pós-predict
    mockPredict.mockResolvedValue({} as Awaited<ReturnType<typeof predict>>);
    const res = await gradeMyBet(null, form(OU_OVER));
    expect(res.ok).toBe(true);
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(mockPredict).toHaveBeenCalledTimes(1);
  });

  it("rate-limited (teto real) no MISS → rate-limited, SEM predict", async () => {
    mockGetLatestPin.mockResolvedValue(null);
    mockRateLimit.mockResolvedValue({ ok: false, limit: 20, remaining: 0, reset: 0 });
    const res = await gradeMyBet(null, form(OU_OVER));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.kind).toBe("rate-limited");
    expect(mockPredict).not.toHaveBeenCalled();
  });
});

describe("gradeMyBet — cobertura/no-coerção + linha-modelável (NÃO gasta)", () => {
  it("1X2 não-admin → nao-avalio SEM predict SEM rate-limit (NÃO coerce p/ over_under)", async () => {
    mockMarketsForAudience.mockImplementation(async () => [OVER_UNDER_MARKET]); // comum: só over_under
    const res = await gradeMyBet(
      null,
      form({
        matchId: VALID_MATCH_ID,
        marketKey: "match_result",
        selectionKey: "home",
        odd: "1.95",
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.view.kind).toBe("nao-avalio");
    expect(mockPredict).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockGetLatestPin).not.toHaveBeenCalled();
  });

  it("seleção ∉ selectionKeys → nao-avalio (POST forjado)", async () => {
    const res = await gradeMyBet(
      null,
      form({ ...OU_OVER, selectionKey: "ghost" }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.view.kind).toBe("nao-avalio");
    expect(mockGetLatestPin).not.toHaveBeenCalled();
  });

  it("over 3.5 em brasileirao → nao-avalio SEM rate-limit SEM predict (OVER_UNDER_ALT=world_cup)", async () => {
    const res = await gradeMyBet(null, form({ ...OU_OVER, line: "3.5" }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.view.kind).toBe("nao-avalio");
    expect(mockPredict).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockGetLatestPin).not.toHaveBeenCalled();
  });

  it("over 3.5 em world_cup com flag ON → modelável: chega ao reader (MISS→predict)", async () => {
    mockGetMatchById.mockResolvedValue(matchInLeague("world_cup"));
    mockExtraLinesFlag.mockResolvedValue(true);
    mockGetLatestPin
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(pinHit({ recommendation: "over", line: 3.5 }));
    mockPredict.mockResolvedValue({} as Awaited<ReturnType<typeof predict>>);
    const res = await gradeMyBet(null, form({ ...OU_OVER, line: "3.5" }));
    expect(res.ok).toBe(true);
    expect(mockGetLatestPin).toHaveBeenCalled();
    expect(mockPredict).toHaveBeenCalledTimes(1);
  });
});
