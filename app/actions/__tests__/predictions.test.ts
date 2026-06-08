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

import { analyzeMatch } from "@/app/actions/predictions";
import { auth } from "@/auth";
import { predict } from "@/lib/ai/predict";
import { userExists } from "@/lib/db/queries/users";

// `auth` é sobrecarregado; estreitamos pro uso como `auth()`.
const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const mockPredict = vi.mocked(predict);
const mockUserExists = vi.mocked(userExists);

const SESSION = {
  user: { id: "u1", email: "a@b.com", role: "admin" },
  expires: "2099-01-01",
} as unknown as Session;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

beforeEach(() => {
  mockAuth.mockReset();
  mockPredict.mockReset();
  mockUserExists.mockReset();
});

describe("analyzeMatch", () => {
  it("rejects an unauthenticated request without calling predict (no Anthropic cost)", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await analyzeMatch(null, form({ matchId: "m1" }));
    expect(res).toMatchObject({ ok: false });
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("rejects a missing matchId before touching auth", async () => {
    const res = await analyzeMatch(null, form({}));
    expect(res).toEqual({ ok: false, error: "matchId ausente" });
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("bounces a session whose user row no longer exists, without calling predict (no Anthropic cost)", async () => {
    mockAuth.mockResolvedValue(SESSION);
    mockUserExists.mockResolvedValue(false);
    const res = await analyzeMatch(null, form({ matchId: "m1" }));
    expect(res).toEqual({
      ok: false,
      error: "Sua sessão expirou. Faça login novamente.",
    });
    expect(mockPredict).not.toHaveBeenCalled();
  });
});
