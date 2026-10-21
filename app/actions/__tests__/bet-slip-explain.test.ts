import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "next-auth";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/queries/matches", () => ({ getMatchById: vi.fn() }));
vi.mock("@/lib/db/queries/users", () => ({ getUserAccessState: vi.fn() }));
vi.mock("@/lib/db/queries/ai-config", () => ({
  getEnableBetSlipExplain: vi.fn(),
}));
vi.mock("@/lib/db/queries/user-bets", () => ({
  getUserBetSlipsByIds: vi.fn(),
}));
vi.mock("@/lib/db/queries/match-model-snapshots", () => ({
  getMatchModelSnapshotById: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ checkPalpitesRateLimit: vi.fn() }));
vi.mock("@/lib/server/request-timezone", () => ({
  getRequestTimeZone: vi.fn(async () => "America/Sao_Paulo"),
}));
vi.mock("@/lib/ai/bet-slip-explain/explain", () => ({
  explainBetSlipWithAI: vi.fn(),
}));
vi.mock("@/lib/auth/whitelist", () => ({ isEmailAllowed: vi.fn(() => false) }));

import { explainBetSlip } from "@/app/actions/bet-slip-explain";
import { auth } from "@/auth";
import { explainBetSlipWithAI } from "@/lib/ai/bet-slip-explain/explain";
import { templatedBetExplanation } from "@/lib/ai/bet-slip-explain/fallback";
import { ANALYSES_UNAVAILABLE_MESSAGE } from "@/lib/ai/best-bet";
import { getEnableBetSlipExplain } from "@/lib/db/queries/ai-config";
import { getMatchModelSnapshotById } from "@/lib/db/queries/match-model-snapshots";
import { getMatchById } from "@/lib/db/queries/matches";
import { getUserBetSlipsByIds } from "@/lib/db/queries/user-bets";
import { getUserAccessState } from "@/lib/db/queries/users";
import { checkPalpitesRateLimit } from "@/lib/rate-limit";
import {
  EXPLANATION_NOTE_LLM,
  EXPLANATION_NOTE_TEMPLATE,
} from "@/lib/view/bet-slip-explain";

import {
  leg,
  slipRow,
  snapshot,
} from "@/lib/ai/bet-slip-explain/__tests__/fixtures";

const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const mockAccess = vi.mocked(getUserAccessState);
const mockFlag = vi.mocked(getEnableBetSlipExplain);
const mockSlips = vi.mocked(getUserBetSlipsByIds);
const mockSnapshot = vi.mocked(getMatchModelSnapshotById);
const mockMatch = vi.mocked(getMatchById);
const mockRateLimit = vi.mocked(checkPalpitesRateLimit);
const mockExplain = vi.mocked(explainBetSlipWithAI);

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

const USER_SESSION = {
  user: { id: "u1", email: "a@b.com", role: "user" },
  expires: "2099-01-01",
} as unknown as Session;

const MATCH = {
  id: "m-1",
  league: "brasileirao_a",
  status: "scheduled",
  homeTeam: "Flamengo",
  awayTeam: "Palmeiras",
  kickoffAt: new Date("2099-06-11T19:00:00.000Z"),
  neutralVenue: false,
} as unknown as Awaited<ReturnType<typeof getMatchById>>;

function form(ids: unknown = [ID1, ID2]): FormData {
  const fd = new FormData();
  fd.set("slipIds", typeof ids === "string" ? ids : JSON.stringify(ids));
  return fd;
}

const SLIPS = [
  slipRow([leg()], { id: ID1 }),
  slipRow([leg({ id: "leg-2" })], { id: ID2 }),
];

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(USER_SESSION);
  mockAccess.mockResolvedValue({ role: "user", allowed: true } as Awaited<
    ReturnType<typeof getUserAccessState>
  >);
  mockFlag.mockResolvedValue(true);
  mockSlips.mockResolvedValue(SLIPS);
  mockSnapshot.mockResolvedValue(snapshot());
  mockMatch.mockResolvedValue(MATCH);
  mockRateLimit.mockResolvedValue({
    ok: true,
    limit: 50,
    remaining: 49,
    reset: 0,
  });
  mockExplain.mockImplementation(async ({ input }) => ({
    explanation: templatedBetExplanation(input),
    source: "llm",
    aiCallId: "call-1",
  }));
});

describe("explainBetSlip — portões grátis (sem cobrar)", () => {
  it.each([
    ["ids inválidos", () => form(["nao-uuid"]), "invalido"],
    ["ids repetidos", () => form([ID1, ID1]), "invalido"],
    ["JSON quebrado", () => form("{"), "invalido"],
    ["lista vazia", () => form([]), "invalido"],
  ] as const)("%s → %s, sem ler a sessão", async (_l, fd, kind) => {
    const res = await explainBetSlip(null, fd());
    expect(res).toMatchObject({ ok: false, kind });
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("sem login / acesso bloqueado → recusa sem cobrar", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect((await explainBetSlip(null, form())).ok).toBe(false);
    mockAccess.mockResolvedValueOnce({
      role: "user",
      allowed: false,
    } as Awaited<ReturnType<typeof getUserAccessState>>);
    expect((await explainBetSlip(null, form())).ok).toBe(false);
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("flag desligada → desligado", async () => {
    mockFlag.mockResolvedValue(false);
    expect(await explainBetSlip(null, form())).toMatchObject({
      ok: false,
      kind: "desligado",
    });
    expect(mockSlips).not.toHaveBeenCalled();
  });

  it("busca os slips com o userId da SESSÃO; faltou algum (de outro usuário) → não encontrado", async () => {
    mockSlips.mockResolvedValue([SLIPS[0]]);
    const res = await explainBetSlip(null, form());
    expect(mockSlips).toHaveBeenCalledWith("u1", [ID1, ID2]);
    expect(res).toMatchObject({
      ok: false,
      kind: "nao-encontrado",
      slipIds: [ID1, ID2],
    });
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("ids inválidos ecoam na recusa (o painel casa o erro com o registro)", async () => {
    const res = await explainBetSlip(null, form([ID1, "x"]));
    expect(res).toMatchObject({
      ok: false,
      kind: "invalido",
      slipIds: [ID1, "x"],
    });
  });

  it("slips de registros diferentes (instante ou base) → não encontrado", async () => {
    mockSlips.mockResolvedValue([
      SLIPS[0],
      { ...SLIPS[1], createdAt: new Date("2026-10-21T19:00:00Z") },
    ]);
    expect(await explainBetSlip(null, form())).toMatchObject({
      kind: "nao-encontrado",
    });
    mockSlips.mockResolvedValue([
      SLIPS[0],
      { ...SLIPS[1], modelSnapshotId: "snap-2" },
    ]);
    expect(await explainBetSlip(null, form())).toMatchObject({
      kind: "nao-encontrado",
    });
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("slips de jogos diferentes ou combinada misturada → não encontrado", async () => {
    mockSlips.mockResolvedValue([SLIPS[0], { ...SLIPS[1], matchId: "m-2" }]);
    expect(await explainBetSlip(null, form())).toMatchObject({
      kind: "nao-encontrado",
    });
    mockSlips.mockResolvedValue([SLIPS[0], { ...SLIPS[1], mode: "combinada" }]);
    expect(await explainBetSlip(null, form())).toMatchObject({
      kind: "nao-encontrado",
    });
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("registro ao vivo → ao-vivo", async () => {
    mockSlips.mockResolvedValue([{ ...SLIPS[0], isLive: true }, SLIPS[1]]);
    expect(await explainBetSlip(null, form())).toMatchObject({
      ok: false,
      kind: "ao-vivo",
    });
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("nenhuma perna com número → sem-avaliacao", async () => {
    mockSlips.mockResolvedValue([
      slipRow([leg({ gradeStatus: "no_data", modelProbPct: null })], {
        id: ID1,
      }),
    ]);
    expect(await explainBetSlip(null, form([ID1]))).toMatchObject({
      ok: false,
      kind: "sem-avaliacao",
    });
    expect(mockRateLimit).not.toHaveBeenCalled();
  });
});

describe("explainBetSlip — cobrança e resultado", () => {
  it("cobra 1 do limite de palpites (fail-closed fora do admin) e devolve a explicação", async () => {
    const res = await explainBetSlip(null, form());
    expect(mockRateLimit).toHaveBeenCalledWith("u1", { failClosed: true });
    expect(mockSnapshot).toHaveBeenCalledWith("snap-1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.slipIds).toEqual([ID1, ID2]);
    expect(res.explanation.source).toBe("llm");
    expect(res.explanation.note).toBe(EXPLANATION_NOTE_LLM);
    expect(res.explanation.legs.map((l) => l.label)).toEqual([
      "Mais de 2,5 gols",
      "Mais de 2,5 gols",
    ]);
    const call = mockExplain.mock.calls[0][0];
    expect(call).toMatchObject({
      userId: "u1",
      matchId: "m-1",
      isAdmin: false,
    });
    expect(call.input.jev?.kind).toBe("applied");
  });

  it("sem base gravada: não lê snapshot, a entrada diz no_base", async () => {
    mockSlips.mockResolvedValue(
      SLIPS.map((s) => ({ ...s, modelSnapshotId: null }))
    );
    await explainBetSlip(null, form());
    expect(mockSnapshot).not.toHaveBeenCalled();
    expect(mockExplain.mock.calls[0][0].input.jev).toEqual({ kind: "no_base" });
  });

  it("admin cobra fail-open", async () => {
    mockAuth.mockResolvedValue({
      ...USER_SESSION,
      user: { ...USER_SESSION.user, role: "admin" },
    } as Session);
    await explainBetSlip(null, form());
    expect(mockRateLimit).toHaveBeenCalledWith("u1", { failClosed: false });
  });

  it("limite estourado → limite, sem chamar a IA", async () => {
    mockRateLimit.mockResolvedValue({
      ok: false,
      limit: 50,
      remaining: 0,
      reset: 0,
    });
    const res = await explainBetSlip(null, form());
    expect(res).toMatchObject({ ok: false, kind: "limite" });
    if (!res.ok) expect(res.error).toContain("50");
    expect(mockExplain).not.toHaveBeenCalled();
  });

  it("KV fora (fail-closed) → copy de indisponível", async () => {
    mockRateLimit.mockResolvedValue({
      ok: false,
      limit: 0,
      remaining: 0,
      reset: 0,
      reason: "fail-closed",
    });
    const res = await explainBetSlip(null, form());
    expect(res).toMatchObject({
      ok: false,
      error: ANALYSES_UNAVAILABLE_MESSAGE,
    });
  });

  it("depois da cobrança nunca falha: exceção vira o template", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockExplain.mockRejectedValue(new Error("boom"));
    const res = await explainBetSlip(null, form());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.explanation.source).toBe("template");
    expect(res.explanation.note).toBe(EXPLANATION_NOTE_TEMPLATE);
  });
});
