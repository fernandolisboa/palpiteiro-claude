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
vi.mock("@/lib/db/queries/users", () => ({ userExists: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkAnalysisRateLimit: vi.fn() }));
vi.mock("@/lib/view/analysis", () => ({ toAnalysisView: vi.fn(() => ({})) }));

import { analyzeMatch } from "@/app/actions/predictions";
import { auth } from "@/auth";
import { predict } from "@/lib/ai/predict";
import { getAiCallById } from "@/lib/db/queries/predictions";
import { userExists } from "@/lib/db/queries/users";
import { checkAnalysisRateLimit } from "@/lib/rate-limit";

// `auth` é sobrecarregado; estreitamos pro uso como `auth()`.
const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const mockPredict = vi.mocked(predict);
const mockUserExists = vi.mocked(userExists);
const mockGetAiCall = vi.mocked(getAiCallById);
const mockRateLimit = vi.mocked(checkAnalysisRateLimit);

const SESSION = {
  user: { id: "u1", email: "a@b.com", role: "admin" },
  expires: "2099-01-01",
} as unknown as Session;

const USER_SESSION = {
  user: { id: "u2", email: "c@d.com", role: "user" },
  expires: "2099-01-01",
} as unknown as Session;

// Predição mínima pra o caminho de sucesso resolver sem estourar no view.
const PREDICTION = {
  aiCallId: "ac1",
  recommendation: "over",
  confidencePct: "60.00",
  rationale: "r",
  keyFactors: ["a", "b"],
  minimumOdd: "1.800",
  edgePct: "5.00",
  modelVersion: "claude-opus-4-8",
  promptVersion: "over_under_v1.2",
  createdAt: new Date("2026-05-01T00:00:00.000Z"),
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
  // Gate transparente por padrão (ok) pra que os testes existentes sigam verdes;
  // os testes específicos do rate-limit sobrescrevem.
  mockRateLimit.mockReset();
  mockRateLimit.mockResolvedValue({
    ok: true,
    limit: 20,
    remaining: 19,
    reset: 0,
  });
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
    mockRateLimit.mockResolvedValue({
      ok: false,
      limit: 20,
      remaining: 0,
      reset: 0,
    });
    const res = await analyzeMatch(null, form({ matchId: VALID_MATCH_ID }));
    expect(res).toEqual({
      ok: false,
      error: "Você atingiu o limite de 20 análises por dia. Tente novamente amanhã.",
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
});

describe("analyzeMatch — model override gating", () => {
  beforeEach(() => {
    mockUserExists.mockResolvedValue(true);
    mockPredict.mockResolvedValue(PREDICTION);
    mockGetAiCall.mockResolvedValue({ costUsd: "0.01" } as never);
  });

  it("admin override is forwarded to predict", async () => {
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
      modelOverride: "claude-sonnet-4-5-20250929",
    });
  });

  it("non-admin override is IGNORED (falls through to global default)", async () => {
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
      modelOverride: undefined,
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
      modelOverride: undefined,
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
      modelOverride: undefined,
    });
  });
});
