import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "next-auth";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/queries/matches", () => ({ getMatchById: vi.fn() }));
vi.mock("@/lib/db/queries/users", () => ({ getUserAccessState: vi.fn() }));
vi.mock("@/lib/db/queries/ai-config", () => ({
  getEnableUnderdogView: vi.fn(),
}));
vi.mock("@/lib/db/queries/match-model-snapshots", () => ({
  getLatestMatchModelSnapshotWithKickoff: vi.fn(),
}));
vi.mock("@/lib/db/queries/palpites", () => ({
  getPalpiteSetsForMatch: vi.fn(),
}));
vi.mock("@/lib/db/queries/underdog-views", () => ({
  findUnderdogViewForSnapshot: vi.fn(),
  getLatestUnderdogView: vi.fn(),
  insertUnderdogView: vi.fn(),
  replaceUnderdogView: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ checkPalpitesRateLimit: vi.fn() }));
vi.mock("@/lib/server/request-timezone", () => ({
  getRequestTimeZone: vi.fn(async () => "America/Sao_Paulo"),
}));
vi.mock("@/lib/ai/underdog/generate", () => ({
  generateUnderdogCase: vi.fn(),
}));
vi.mock("@/lib/underdog/fetch-signals", () => ({
  fetchUnderdogSignals: vi.fn(),
}));
vi.mock("@/lib/view/palpites-headline", () => ({
  toPalpiteHeadlineViewFromSet: vi.fn(),
}));
vi.mock("@/lib/auth/whitelist", () => ({ isEmailAllowed: vi.fn(() => false) }));

import { openUnderdogView } from "@/app/actions/underdog";
import { auth } from "@/auth";
import { ANALYSES_UNAVAILABLE_MESSAGE } from "@/lib/ai/best-bet";
import { templatedNarrative } from "@/lib/ai/underdog/fallback";
import { generateUnderdogCase } from "@/lib/ai/underdog/generate";
import { getEnableUnderdogView } from "@/lib/db/queries/ai-config";
import { getLatestMatchModelSnapshotWithKickoff } from "@/lib/db/queries/match-model-snapshots";
import { getMatchById } from "@/lib/db/queries/matches";
import { getPalpiteSetsForMatch } from "@/lib/db/queries/palpites";
import {
  findUnderdogViewForSnapshot,
  getLatestUnderdogView,
  insertUnderdogView,
  replaceUnderdogView,
  type UnderdogViewRecord,
} from "@/lib/db/queries/underdog-views";
import { getUserAccessState } from "@/lib/db/queries/users";
import { checkPalpitesRateLimit } from "@/lib/rate-limit";
import {
  computeUnderdogFacts,
  underdogBaseFromSnapshot,
} from "@/lib/underdog/compute";
import { fetchUnderdogSignals } from "@/lib/underdog/fetch-signals";
import { toPalpiteHeadlineViewFromSet } from "@/lib/view/palpites-headline";
import { snapshot } from "@/lib/underdog/__tests__/fixtures";

const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const mockAccess = vi.mocked(getUserAccessState);
const mockFlag = vi.mocked(getEnableUnderdogView);
const mockMatch = vi.mocked(getMatchById);
const mockSnap = vi.mocked(getLatestMatchModelSnapshotWithKickoff);
const mockSets = vi.mocked(getPalpiteSetsForMatch);
const mockHeadline = vi.mocked(toPalpiteHeadlineViewFromSet);
const mockStored = vi.mocked(getLatestUnderdogView);
const mockInsert = vi.mocked(insertUnderdogView);
const mockFind = vi.mocked(findUnderdogViewForSnapshot);
const mockReplace = vi.mocked(replaceUnderdogView);
const mockRateLimit = vi.mocked(checkPalpitesRateLimit);
const mockGenerate = vi.mocked(generateUnderdogCase);
const mockSignals = vi.mocked(fetchUnderdogSignals);

const MATCH_ID = "11111111-1111-4111-8111-111111111111";
const SESSION = {
  user: { id: "u1", email: "a@b.com", role: "user" },
  expires: "2099-01-01",
} as unknown as Session;

// Kickoff no futuro e base fresca relativa ao relógio real (a action usa new Date()).
const kickoffAt = () => new Date(Date.now() + 6 * 3_600_000);
const freshSnap = () =>
  snapshot({ computedAt: new Date(), checkedAt: new Date() });

const MATCH = () =>
  ({
    id: MATCH_ID,
    league: "brasileirao_a",
    status: "scheduled",
    homeTeam: "SE Palmeiras",
    awayTeam: "CR Flamengo",
    kickoffAt: kickoffAt(),
  }) as unknown as Awaited<ReturnType<typeof getMatchById>>;

function form(id: unknown = MATCH_ID): FormData {
  const fd = new FormData();
  fd.set("matchId", String(id));
  return fd;
}

function storedRow(over: Partial<UnderdogViewRecord> = {}): UnderdogViewRecord {
  const base = underdogBaseFromSnapshot(freshSnap(), kickoffAt(), new Date())!;
  const facts = computeUnderdogFacts(base);
  return {
    id: "row-1",
    matchId: MATCH_ID,
    modelSnapshotId: "snap-0",
    createdAt: new Date(),
    side: facts.side,
    facts,
    narrative: templatedNarrative(facts, {
      home: "Palmeiras",
      away: "Flamengo",
    }),
    narrativeSource: "template",
    versions: { calc: "c", advocate: "a", review: "r", matchModel: "m" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(SESSION);
  mockAccess.mockResolvedValue({ role: "user", allowed: true } as Awaited<
    ReturnType<typeof getUserAccessState>
  >);
  mockFlag.mockResolvedValue(true);
  mockMatch.mockResolvedValue(MATCH());
  mockSnap.mockResolvedValue({ snapshot: freshSnap(), kickoffAt: kickoffAt() });
  mockSets.mockResolvedValue([{}] as Awaited<
    ReturnType<typeof getPalpiteSetsForMatch>
  >);
  mockHeadline.mockReturnValue({
    probableScore: { home: 1, away: 0 },
  } as ReturnType<typeof toPalpiteHeadlineViewFromSet>);
  mockStored.mockResolvedValue(null);
  mockFind.mockResolvedValue(null);
  mockInsert.mockImplementation(async (row) =>
    storedRow({ id: "row-new", narrative: row.narrative })
  );
  mockReplace.mockImplementation(async (row) =>
    storedRow({ id: "row-replaced", narrative: row.narrative })
  );
  mockRateLimit.mockResolvedValue({
    ok: true,
    limit: 50,
    remaining: 49,
    reset: 0,
  });
  mockSignals.mockResolvedValue([
    { kind: "h2h", games: 5, underdogWins: 3, favoriteWins: 1 },
  ]);
  mockGenerate.mockImplementation(async ({ facts, teams }) => ({
    narrative: {
      ...templatedNarrative(facts, teams),
      advocateFamily: "Sonnet",
    },
    source: "llm",
    failure: "none",
    persist: true,
    advocateAiCallId: "a-1",
    reviewerAiCallId: "r-1",
  }));
});

describe("openUnderdogView: portões grátis (sem cobrar)", () => {
  it("matchId inválido → invalido, sem ler a sessão", async () => {
    expect(await openUnderdogView(null, form("nao-uuid"))).toMatchObject({
      ok: false,
      kind: "invalido",
    });
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("sem sessão / acesso bloqueado → recusa", async () => {
    mockAuth.mockResolvedValueOnce(null);
    expect((await openUnderdogView(null, form())).ok).toBe(false);
    mockAccess.mockResolvedValueOnce({
      role: "user",
      allowed: false,
    } as Awaited<ReturnType<typeof getUserAccessState>>);
    expect((await openUnderdogView(null, form())).ok).toBe(false);
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("flag desligada → desligado", async () => {
    mockFlag.mockResolvedValue(false);
    expect(await openUnderdogView(null, form())).toMatchObject({
      kind: "desligado",
    });
    expect(mockMatch).not.toHaveBeenCalled();
  });

  it.each([
    ["jogo começado", { kickoffAt: new Date(Date.now() - 60_000) }],
    ["ao vivo", { status: "live" }],
    ["encerrado", { status: "finished" }],
  ])("%s → fechado", async (_l, over) => {
    mockMatch.mockResolvedValue({ ...MATCH(), ...over } as Awaited<
      ReturnType<typeof getMatchById>
    >);
    expect(await openUnderdogView(null, form())).toMatchObject({
      kind: "fechado",
    });
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it.each([
    ["sem base", null],
    [
      "sem azarão claro",
      {
        snapshot: { ...freshSnap(), lambdaHome: 1.2, lambdaAway: 1.18 },
        kickoffAt: kickoffAt(),
      },
    ],
  ])("%s → sem-azarao, sem cobrar", async (_l, found) => {
    mockSnap.mockResolvedValue(
      found as Awaited<
        ReturnType<typeof getLatestMatchModelSnapshotWithKickoff>
      >
    );
    expect(await openUnderdogView(null, form())).toMatchObject({
      kind: "sem-azarao",
    });
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("palpite crava a vitória do azarão → coerencia, com texto próprio", async () => {
    mockHeadline.mockReturnValue({
      probableScore: { home: 0, away: 1 },
    } as ReturnType<typeof toPalpiteHeadlineViewFromSet>);
    const res = await openUnderdogView(null, form());
    expect(res).toMatchObject({ ok: false, kind: "coerencia" });
    expect(!res.ok && res.error).toContain("dá a vitória a Flamengo");
    expect(!res.ok && res.error).not.toContain("não vê azarão");
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("sem palpite da IA → sem-palpite, sem cobrar", async () => {
    mockSets.mockResolvedValue([]);
    expect(await openUnderdogView(null, form())).toMatchObject({
      ok: false,
      kind: "sem-palpite",
    });
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("row guardada que ainda vale → devolve sem cobrar", async () => {
    mockStored.mockResolvedValue(storedRow());
    const res = await openUnderdogView(null, form());
    expect(res).toMatchObject({ ok: true, charged: false });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("row guardada de base materialmente diferente → cobra e gera de novo", async () => {
    const old = storedRow();
    mockStored.mockResolvedValue({
      ...old,
      facts: {
        ...old.facts,
        chances: {
          ...old.facts.chances,
          underdog: old.facts.chances.underdog + 3,
        },
      },
    });
    expect(await openUnderdogView(null, form())).toMatchObject({
      ok: true,
      charged: true,
    });
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
  });

  it("row desta base que ainda vale (não é a mais recente) → sem cobrar", async () => {
    mockFind.mockResolvedValue({
      record: storedRow({ modelSnapshotId: "snap-1" }),
    });
    const res = await openUnderdogView(null, form());
    expect(res).toMatchObject({ ok: true, charged: false });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("row desta base velha (cálculo mudou) → cobra uma vez e TROCA a row", async () => {
    const old = storedRow({ modelSnapshotId: "snap-1" });
    mockFind.mockResolvedValue({
      record: {
        ...old,
        facts: {
          ...old.facts,
          chances: {
            ...old.facts.chances,
            underdog: old.facts.chances.underdog + 5,
          },
        },
      },
    });
    const res = await openUnderdogView(null, form());
    expect(res).toMatchObject({ ok: true, charged: true });
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(
      expect.objectContaining({ modelSnapshotId: "snap-1" })
    );
    expect(mockInsert).not.toHaveBeenCalled();
    if (res.ok) expect(res.view.narrative.family).toBe("Sonnet");
  });

  it("row desta base que falha no Zod → troca (a próxima abertura não cobra de novo)", async () => {
    mockFind.mockResolvedValueOnce({ record: null });
    await openUnderdogView(null, form());
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockInsert).not.toHaveBeenCalled();
    // Depois da troca a row vale: reabrir devolve sem cobrar.
    mockFind.mockResolvedValueOnce({
      record: storedRow({ modelSnapshotId: "snap-1" }),
    });
    expect(await openUnderdogView(null, form())).toMatchObject({
      ok: true,
      charged: false,
    });
    expect(mockRateLimit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["flag", () => mockFlag.mockRejectedValueOnce(new Error("db down"))],
    ["jogo", () => mockMatch.mockRejectedValueOnce(new Error("db down"))],
    ["base", () => mockSnap.mockRejectedValueOnce(new Error("db down"))],
    [
      "row guardada",
      () => mockStored.mockRejectedValueOnce(new Error("db down")),
    ],
    ["row da base", () => mockFind.mockRejectedValueOnce(new Error("db down"))],
    ["palpites", () => mockSets.mockRejectedValueOnce(new Error("db down"))],
    [
      "limite (KV)",
      () => mockRateLimit.mockRejectedValueOnce(new Error("kv down")),
    ],
  ])(
    "falha de %s antes da cobrança → recusa inline, sem lançar",
    async (_l, arrange) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      arrange();
      await expect(openUnderdogView(null, form())).resolves.toEqual({
        ok: false,
        error: ANALYSES_UNAVAILABLE_MESSAGE,
      });
      expect(mockGenerate).not.toHaveBeenCalled();
    }
  );

  it("limite estourado → limite, sem chamar a IA", async () => {
    mockRateLimit.mockResolvedValue({
      ok: false,
      limit: 50,
      remaining: 0,
      reset: 0,
    });
    const res = await openUnderdogView(null, form());
    expect(res).toMatchObject({ ok: false, kind: "limite" });
    expect(!res.ok && res.error).toContain("chances do azarão");
    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it("fail-closed (sem KV, não-admin) → indisponível", async () => {
    mockRateLimit.mockResolvedValue({
      ok: false,
      limit: 0,
      remaining: 0,
      reset: 0,
      reason: "fail-closed",
    });
    expect(await openUnderdogView(null, form())).toEqual({
      ok: false,
      error: ANALYSES_UNAVAILABLE_MESSAGE,
    });
    expect(mockRateLimit).toHaveBeenCalledWith("u1", { failClosed: true });
  });
});

describe("openUnderdogView: depois da cobrança", () => {
  it("caminho ok: sinais + IA, grava e devolve a row gravada", async () => {
    const res = await openUnderdogView(null, form());
    expect(res).toMatchObject({ ok: true, charged: true });
    expect(mockSignals).toHaveBeenCalledWith(
      expect.objectContaining({ side: "away" })
    );
    const call = mockGenerate.mock.calls[0][0];
    expect(call.facts.signals[0]).toMatchObject({ kind: "h2h" });
    expect(call.block.text).toContain("Flamengo");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        matchId: MATCH_ID,
        modelSnapshotId: "snap-1",
        underdogSide: "away",
        advocateAiCallId: "a-1",
        reviewerAiCallId: "r-1",
        versions: expect.objectContaining({ calc: "underdog_calc_v1" }),
      })
    );
    if (res.ok) expect(res.view.underdogName).toBe("Flamengo");
  });

  it("template de infraestrutura NÃO grava", async () => {
    mockGenerate.mockImplementationOnce(async ({ facts, teams }) => ({
      narrative: templatedNarrative(facts, teams),
      source: "template",
      failure: "infra",
      persist: false,
      advocateAiCallId: null,
      reviewerAiCallId: null,
    }));
    const res = await openUnderdogView(null, form());
    expect(res).toMatchObject({ ok: true, charged: true });
    expect(mockInsert).not.toHaveBeenCalled();
    if (res.ok) expect(res.view.narrative.source).toBe("template");
  });

  it("template de guardas grava", async () => {
    mockGenerate.mockImplementationOnce(async ({ facts, teams }) => ({
      narrative: templatedNarrative(facts, teams, 4),
      source: "template",
      failure: "guards",
      persist: true,
      advocateAiCallId: "a-1",
      reviewerAiCallId: null,
    }));
    await openUnderdogView(null, form());
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ narrativeSource: "template" })
    );
  });

  it("falha do banco no insert → devolve o texto sem gravar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockInsert.mockRejectedValueOnce(new Error("db down"));
    const res = await openUnderdogView(null, form());
    expect(res).toMatchObject({ ok: true, charged: true });
    if (res.ok) expect(res.view.narrative.family).toBe("Sonnet");
  });

  it("exceção inesperada → texto padrão, sempre ok", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockGenerate.mockRejectedValueOnce(new Error("boom"));
    const res = await openUnderdogView(null, form());
    expect(res).toMatchObject({ ok: true, charged: true });
    if (res.ok) expect(res.view.narrative.source).toBe("template");
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
