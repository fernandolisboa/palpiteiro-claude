import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "next-auth";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/queries/matches", () => ({ getMatchById: vi.fn() }));
vi.mock("@/lib/db/queries/users", () => ({ getUserAccessState: vi.fn() }));
vi.mock("@/lib/db/queries/predictions", () => ({
  getPredictionHistoryForMatch: vi.fn(),
}));
vi.mock("@/lib/db/queries/reference-odds", () => ({
  getReferenceOddsForMatch: vi.fn(),
}));
vi.mock("@/lib/db/queries/user-bets", () => ({ insertBetSlipsBatch: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkBetSlipsRateLimit: vi.fn() }));
vi.mock("@/lib/bets/slip-model", () => ({ resolveSlipModel: vi.fn() }));
// Lookup do parseAiCallId (db.select().from().where().limit()): as linhas que a query
// devolve são controladas por `aiCallRows`.
const aiCallRows: { id: string }[] = [];
const dbLimit = vi.fn(async () => aiCallRows);
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: dbLimit })),
      })),
    })),
  },
}));

import { registerBetSlip } from "@/app/actions/bet-slip";
import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { resolveSlipModel } from "@/lib/bets/slip-model";
import { db } from "@/lib/db";
import { getMatchById } from "@/lib/db/queries/matches";
import { getPredictionHistoryForMatch } from "@/lib/db/queries/predictions";
import { getReferenceOddsForMatch } from "@/lib/db/queries/reference-odds";
import {
  insertBetSlipsBatch,
  type NewBetSlip,
} from "@/lib/db/queries/user-bets";
import { getUserAccessState } from "@/lib/db/queries/users";
import type { ModelScoreline } from "@/lib/quant/match-model";
import { p1X2, scorelineMatrix } from "@/lib/quant/scoreline-model";
import { checkBetSlipsRateLimit } from "@/lib/rate-limit";

const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const mockGetMatchById = vi.mocked(getMatchById);
const mockGetAccess = vi.mocked(getUserAccessState);
const mockHistory = vi.mocked(getPredictionHistoryForMatch);
const mockRefs = vi.mocked(getReferenceOddsForMatch);
const mockInsert = vi.mocked(insertBetSlipsBatch);
const mockRateLimit = vi.mocked(checkBetSlipsRateLimit);
const mockModel = vi.mocked(resolveSlipModel);

const MATCH_ID = "550e8400-e29b-41d4-a716-446655440000";
const AI_CALL_ID = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";

const MODEL: ModelScoreline = {
  source: "dixon_coles",
  degraded: false,
  lambdaHome: 1.6,
  lambdaAway: 1.0,
  matrix: scorelineMatrix(1.6, 1.0),
};

const USER_SESSION = {
  user: { id: "u2", email: "c@d.com", role: "user" },
  expires: "2099-01-01",
} as unknown as Session;

function match(
  status = "scheduled",
  kickoffAt = new Date("2099-06-11T19:00:00.000Z")
) {
  return {
    id: MATCH_ID,
    league: "brasileirao_a",
    status,
    homeTeam: "Flamengo",
    awayTeam: "Palmeiras",
    kickoffAt,
  } as unknown as Awaited<ReturnType<typeof getMatchById>>;
}

const HOME = { kind: "match_result", params: { selection: "home" } };
const OVER = { kind: "over_under", params: { selection: "over", line: 2.5 } };
const BTTS = { kind: "btts", params: { selection: "yes" } };

function form(slip: unknown): FormData {
  const fd = new FormData();
  fd.append("slip", typeof slip === "string" ? slip : JSON.stringify(slip));
  return fd;
}

function slip(over: Record<string, unknown> = {}) {
  return { matchId: MATCH_ID, mode: "simples", legs: [HOME], ...over };
}

function inserted(): NewBetSlip[] {
  expect(mockInsert).toHaveBeenCalledTimes(1);
  return mockInsert.mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  aiCallRows.length = 0;
  mockAuth.mockResolvedValue(USER_SESSION);
  mockGetAccess.mockResolvedValue({ role: "user", allowed: true } as Awaited<
    ReturnType<typeof getUserAccessState>
  >);
  mockGetMatchById.mockResolvedValue(match());
  mockRateLimit.mockResolvedValue({
    ok: true,
    limit: 50,
    remaining: 49,
    reset: 0,
  } as Awaited<ReturnType<typeof checkBetSlipsRateLimit>>);
  mockModel.mockResolvedValue(MODEL);
  mockRefs.mockResolvedValue(new Map());
  mockHistory.mockResolvedValue([]);
  mockInsert.mockResolvedValue({ slipIds: [] });
});

describe("registerBetSlip — contrato e gates", () => {
  it("JSON inválido → slip-invalido, sem auth nem insert", async () => {
    const res = await registerBetSlip(null, form("{nope"));
    expect(res).toMatchObject({ ok: false, kind: "slip-invalido" });
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("campo slip ausente → slip-invalido", async () => {
    const res = await registerBetSlip(null, new FormData());
    expect(res).toMatchObject({ ok: false, kind: "slip-invalido" });
  });

  it("payload que falha o Zod → slip-invalido com a copy do erro", async () => {
    const res = await registerBetSlip(null, form(slip({ mode: "combinada" })));
    expect(res).toEqual({
      ok: false,
      error: "A combinada precisa de pelo menos 2 seleções.",
      kind: "slip-invalido",
    });
  });

  it("não logado → erro de login, sem rate-limit nem insert", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await registerBetSlip(null, form(slip()));
    expect(res).toEqual({
      ok: false,
      error: "Faça login para registrar apostas.",
    });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("sessão sem estado de acesso → sessão expirada", async () => {
    mockGetAccess.mockResolvedValue(null);
    const res = await registerBetSlip(null, form(slip()));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("sessão expirou");
  });

  it("acesso bloqueado (fora da whitelist) → bloqueado", async () => {
    mockGetAccess.mockResolvedValue({ role: "user", allowed: false } as Awaited<
      ReturnType<typeof getUserAccessState>
    >);
    const res = await registerBetSlip(null, form(slip()));
    expect(res).toEqual({
      ok: false,
      error: "Seu acesso está bloqueado. Fale com o administrador.",
    });
    expect(mockGetMatchById).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("jogo não encontrado", async () => {
    mockGetMatchById.mockResolvedValue(
      null as unknown as Awaited<ReturnType<typeof getMatchById>>
    );
    const res = await registerBetSlip(null, form(slip()));
    expect(res).toEqual({ ok: false, error: "Jogo não encontrado." });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("jogo já começou → nao-analisavel, sem rate-limit nem insert", async () => {
    mockGetMatchById.mockResolvedValue(match("live"));
    const res = await registerBetSlip(null, form(slip()));
    expect(res).toMatchObject({ ok: false, kind: "nao-analisavel" });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("scheduled com kickoff no passado → nao-analisavel", async () => {
    mockGetMatchById.mockResolvedValue(
      match("scheduled", new Date("2020-01-01T00:00:00Z"))
    );
    const res = await registerBetSlip(null, form(slip()));
    expect(res).toMatchObject({ ok: false, kind: "nao-analisavel" });
  });
});

describe("registerBetSlip — rate limit conta slips criados", () => {
  it("simples com 3 pernas → count 3", async () => {
    await registerBetSlip(null, form(slip({ legs: [HOME, OVER, BTTS] })));
    expect(mockRateLimit).toHaveBeenCalledWith("u2", "user", 3);
  });

  it("combinada com 3 pernas → count 1", async () => {
    await registerBetSlip(
      null,
      form(slip({ mode: "combinada", legs: [HOME, OVER, BTTS] }))
    );
    expect(mockRateLimit).toHaveBeenCalledWith("u2", "user", 1);
  });

  it("limite estourado → limite-de-slips, sem modelo nem insert", async () => {
    mockRateLimit.mockResolvedValue({
      ok: false,
      reason: "limit",
    } as unknown as Awaited<ReturnType<typeof checkBetSlipsRateLimit>>);
    const res = await registerBetSlip(null, form(slip()));
    expect(res).toMatchObject({ ok: false, kind: "limite-de-slips" });
    if (res.ok) return;
    expect(res.error).toContain("limite diário");
    expect(mockModel).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("pedido maior que o saldo → diz quantas ainda cabem hoje", async () => {
    mockRateLimit.mockResolvedValue({
      ok: false,
      limit: 30,
      remaining: 2,
      reset: 0,
    } as unknown as Awaited<ReturnType<typeof checkBetSlipsRateLimit>>);
    const res = await registerBetSlip(null, form(slip()));
    expect(res).toMatchObject({ ok: false, kind: "limite-de-slips" });
    if (res.ok) return;
    expect(res.error).toContain("ainda pode registrar 2 apostas");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rate limit fail-closed → copy de indisponível", async () => {
    mockRateLimit.mockResolvedValue({
      ok: false,
      reason: "fail-closed",
    } as unknown as Awaited<ReturnType<typeof checkBetSlipsRateLimit>>);
    const res = await registerBetSlip(null, form(slip()));
    expect(res).toMatchObject({ ok: false, kind: "limite-de-slips" });
    if (res.ok) return;
    expect(res.error).toContain("indisponível");
  });
});

describe("registerBetSlip — persistência", () => {
  it("insert que falha → erro amigável, sem lançar", async () => {
    mockInsert.mockRejectedValueOnce(new Error("numeric field overflow"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await registerBetSlip(null, form(slip()));
    expect(res).toMatchObject({ ok: false, kind: "falha-ao-salvar" });
    spy.mockRestore();
  });

  it("a avaliação devolvida usa o nome curto do time (#578)", async () => {
    mockGetMatchById.mockResolvedValue({
      ...match(),
      homeTeam: "CR Flamengo",
      awayTeam: "SE Palmeiras",
    } as unknown as Awaited<ReturnType<typeof getMatchById>>);
    const res = await registerBetSlip(
      null,
      form(slip({ legs: [{ ...HOME, userOdd: "2,10", stakeUnits: "1" }] })),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.evaluation.legs[0].label).toBe("Vitória do Flamengo");
  });

  it("simples → um slip por perna, cada um com 1 perna", async () => {
    const res = await registerBetSlip(
      null,
      form(
        slip({
          legs: [{ ...HOME, userOdd: "2,10", stakeUnits: "1" }, OVER, BTTS],
        })
      )
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.registered).toBe(3);
    expect(res.evaluation.mode).toBe("simples");
    expect(res.evaluation.legs).toHaveLength(3);

    const slips = inserted();
    expect(slips).toHaveLength(3);
    for (const s of slips) {
      expect(s.legs).toHaveLength(1);
      expect(s).toMatchObject({
        matchId: MATCH_ID,
        userId: "u2",
        mode: "simples",
        comboUserOdd: null,
        jointProbPct: null,
        stakeUnits: null,
        rawInput: null,
        parseAiCallId: null,
      });
    }
    expect(slips.map((s) => s.legs[0].kind)).toEqual([
      "match_result",
      "over_under",
      "btts",
    ]);
    expect(slips[0].legs[0]).toMatchObject({
      userOdd: 2.1,
      stakeUnits: 1,
      settleable: true,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/match/${MATCH_ID}`);
    expect(revalidatePath).toHaveBeenCalledWith("/apostas");
  });

  it("combinada → um slip com todas as pernas e a conjunta da matriz", async () => {
    const res = await registerBetSlip(
      null,
      form(
        slip({
          mode: "combinada",
          legs: [HOME, OVER],
          comboUserOdd: "3,80",
          comboStakeUnits: "2",
        })
      )
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.registered).toBe(1);
    expect(res.evaluation.combo?.status).toBe("graded");

    const slips = inserted();
    expect(slips).toHaveLength(1);
    const [s] = slips;
    expect(s.mode).toBe("combinada");
    expect(s.legs).toHaveLength(2);
    expect(s.comboUserOdd).toBe(3.8);
    expect(s.stakeUnits).toBe(2);
    expect(s.jointProbPct).not.toBeNull();
    expect(s.jointProbPct!).toBeGreaterThan(0);
    expect(s.jointProbPct!).toBeLessThanOrEqual(p1X2(MODEL.matrix).home * 100);
  });

  it("combinada sem modelo → jointProbPct null", async () => {
    mockModel.mockResolvedValue(null);
    const res = await registerBetSlip(
      null,
      form(slip({ mode: "combinada", legs: [HOME, OVER] }))
    );
    expect(res.ok).toBe(true);
    const [s] = inserted();
    expect(s.jointProbPct).toBeNull();
    expect(s.legs.map((l) => l.gradeStatus)).toEqual(["no_data", "no_data"]);
    expect(
      s.legs.every((l) => l.gradeSource === "none" && l.modelProbPct === null)
    ).toBe(true);
  });

  it("perna pelo modelo → scoreline_model com o motor gravado", async () => {
    await registerBetSlip(null, form(slip()));
    const [leg] = inserted()[0].legs;
    expect(leg).toMatchObject({
      gradeSource: "scoreline_model",
      gradeStatus: "graded",
      modelSource: "dixon_coles",
      pinnedPredictionId: null,
    });
    expect(leg.modelProbPct).toBeCloseTo(p1X2(MODEL.matrix).home * 100, 10);
  });

  it("perna pela análise → cartridge com pinnedPredictionId e modelSource null", async () => {
    mockHistory.mockResolvedValue([
      {
        marketKey: "match_result",
        prediction: {
          id: "pred-77",
          createdAt: new Date("2026-10-12T10:00:00Z"),
          marketParams: null,
        },
        selections: [
          { key: "home", modelProbPct: 58 },
          { key: "draw", modelProbPct: 24 },
          { key: "away", modelProbPct: 18 },
        ],
      },
    ] as unknown as Awaited<ReturnType<typeof getPredictionHistoryForMatch>>);
    mockRefs.mockResolvedValue(
      new Map([
        [
          "match_result",
          {
            bookmaker: "pinnacle",
            capturedAt: new Date("2026-10-12T12:00:00Z"),
            odds: { home: 2.0, draw: 3.4, away: 4.0 },
          },
        ],
      ])
    );
    await registerBetSlip(
      null,
      form(slip({ legs: [{ ...HOME, userOdd: "2,0" }] }))
    );
    expect(mockHistory).toHaveBeenCalledWith(MATCH_ID, "u2");
    expect(mockRefs).toHaveBeenCalledWith(MATCH_ID);
    const [leg] = inserted()[0].legs;
    expect(leg).toMatchObject({
      gradeSource: "cartridge",
      gradeStatus: "graded",
      pinnedPredictionId: "pred-77",
      modelSource: null,
      modelProbPct: 58,
      referenceOdd: 2.0,
    });
    expect(leg.marketImpliedPct).toBeGreaterThan(0);
    expect(leg.marketImpliedPct).toBeLessThan(50); // de-vigado, nunca 1/odd cru
    // edge ≈ 58 − 47.9 ≈ 10pp com prob ≥ 50% → banda de 2u.
    expect(leg.suggestedStakeUnits).toBe(2);
  });

  it("cartões → not_covered, não settleable, gradeSource none", async () => {
    await registerBetSlip(
      null,
      form(
        slip({
          legs: [{ kind: "cards", params: { selection: "over", line: 4.5 } }],
        })
      )
    );
    const [leg] = inserted()[0].legs;
    expect(leg).toMatchObject({
      kind: "cards",
      gradeSource: "none",
      gradeStatus: "not_covered",
      modelProbPct: null,
      settleable: false,
    });
  });
});

describe("registerBetSlip — parseAiCallId", () => {
  it("chamada do próprio usuário → mantida", async () => {
    aiCallRows.push({ id: AI_CALL_ID });
    await registerBetSlip(
      null,
      form(slip({ rawInput: "fla vence", parseAiCallId: AI_CALL_ID }))
    );
    expect(db.select).toHaveBeenCalledTimes(1);
    const [s] = inserted();
    expect(s.parseAiCallId).toBe(AI_CALL_ID);
    expect(s.rawInput).toBe("fla vence");
  });

  it("chamada de outro usuário (query vazia) → descartada (null)", async () => {
    await registerBetSlip(
      null,
      form(slip({ rawInput: "fla vence", parseAiCallId: AI_CALL_ID }))
    );
    expect(dbLimit).toHaveBeenCalledTimes(1);
    const [s] = inserted();
    expect(s.parseAiCallId).toBeNull();
    expect(s.rawInput).toBe("fla vence");
  });

  it("sem parseAiCallId → nenhuma query ao DB", async () => {
    await registerBetSlip(null, form(slip()));
    expect(db.select).not.toHaveBeenCalled();
    expect(inserted()[0].parseAiCallId).toBeNull();
  });
});
