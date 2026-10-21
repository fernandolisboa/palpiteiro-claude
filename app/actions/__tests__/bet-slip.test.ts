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
vi.mock("@/lib/bets/slip-model", () => ({
  resolveSlipModel: vi.fn(),
  resolveInPlaySlipModel: vi.fn(),
}));
// Modo ao vivo (#580): a flag e o estado lido no servidor. A lógica de
// loadActionLiveContext/matchPhase roda de verdade em cima destes dois.
vi.mock("@/lib/db/queries/ai-config", () => ({
  getEnableLiveMode: vi.fn(),
  getEnableBetSlipExplain: vi.fn(),
}));
vi.mock("@/lib/live/in-play-state", () => ({ getInPlayState: vi.fn() }));
// Guarda: nenhum caminho do registro (pré-jogo ou ao vivo) toca a The Odds API.
vi.mock("@/lib/providers/odds-api", () => {
  throw new Error("registerBetSlip não pode importar a The Odds API");
});
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
import { resolveInPlaySlipModel, resolveSlipModel } from "@/lib/bets/slip-model";
import { getEnableBetSlipExplain, getEnableLiveMode } from "@/lib/db/queries/ai-config";
import { getInPlayState, type InPlayState } from "@/lib/live/in-play-state";
import { readLiveStamp } from "@/lib/live/stamp";
import { inPlayScoreline } from "@/lib/quant/in-play";
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
const mockInPlayModel = vi.mocked(resolveInPlaySlipModel);
const mockLiveMode = vi.mocked(getEnableLiveMode);
const mockExplainFlag = vi.mocked(getEnableBetSlipExplain);
const mockInPlayState = vi.mocked(getInPlayState);

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

// A tabela ao vivo manda `gridLive: true`; a de pré-jogo, false (bet-slip-provider).
let gridLive = false;
function slip(over: Record<string, unknown> = {}) {
  return { matchId: MATCH_ID, mode: "simples", legs: [HOME], gridLive, ...over };
}

function inserted(): NewBetSlip[] {
  expect(mockInsert).toHaveBeenCalledTimes(1);
  return mockInsert.mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  gridLive = false;
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
  mockLiveMode.mockResolvedValue(true);
  mockExplainFlag.mockResolvedValue(true);
  mockInPlayState.mockResolvedValue(null);
  mockInPlayModel.mockResolvedValue(null);
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

describe("registerBetSlip — Explicar com IA (#562)", () => {
  it("devolve os ids gravados e explainable quando há perna avaliada e a flag está ligada", async () => {
    mockInsert.mockResolvedValue({ slipIds: ["s-1"] });
    const res = await registerBetSlip(null, form(slip()));
    expect(res).toMatchObject({ ok: true, slipIds: ["s-1"], explainable: true });
  });

  it("grava a base do jogo que avaliou as pernas; sem base, null", async () => {
    mockModel.mockResolvedValue({ ...MODEL, baseSnapshotId: "snap-9" });
    await registerBetSlip(null, form(slip()));
    expect(inserted()[0].modelSnapshotId).toBe("snap-9");
    mockInsert.mockClear();
    mockModel.mockResolvedValue(MODEL);
    await registerBetSlip(null, form(slip()));
    expect(inserted()[0].modelSnapshotId).toBeNull();
  });

  it("flag desligada → explainable false", async () => {
    mockExplainFlag.mockResolvedValue(false);
    const res = await registerBetSlip(null, form(slip()));
    expect(res).toMatchObject({ ok: true, explainable: false });
  });

  it("ler a flag falha depois do insert → registro ok, sem o botão", async () => {
    mockExplainFlag.mockRejectedValue(new Error("db down"));
    const res = await registerBetSlip(null, form(slip()));
    expect(res).toMatchObject({ ok: true, explainable: false });
  });

  it("nenhuma perna avaliada (sem modelo) → explainable false, sem ler a flag", async () => {
    mockModel.mockResolvedValue(null);
    const res = await registerBetSlip(null, form(slip()));
    expect(res).toMatchObject({ ok: true, explainable: false });
    expect(mockExplainFlag).not.toHaveBeenCalled();
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

// ── Ao vivo (#580, PLAN-580 §9.2) ────────────────────────────────────────────

const LIVE_KICKOFF = () => new Date(Date.now() - 60 * 60 * 1000);

function liveState(over: Partial<InPlayState> = {}): InPlayState {
  return {
    matchId: MATCH_ID,
    statusShort: "2H",
    elapsed: 63,
    extra: null,
    fetchedAt: new Date(Date.now() - 30_000),
    minuteLabel: "63'",
    score: { home: 1, away: 0 },
    red: { home: 0, away: 0 },
    ageMs: 30_000,
    ...over,
  };
}

function liveModel() {
  return inPlayScoreline(MODEL, {
    statusShort: "2H",
    elapsed: 63,
    extra: null,
    score: { home: 1, away: 0 },
    red: { home: 0, away: 0 },
  })!;
}

describe("registerBetSlip — ao vivo", () => {
  beforeEach(() => {
    gridLive = true;
    mockGetMatchById.mockResolvedValue(match("live", LIVE_KICKOFF()));
    mockInPlayState.mockResolvedValue(liveState());
    mockInPlayModel.mockResolvedValue(liveModel());
  });

  it("estado fresco: registra com o carimbo do SERVIDOR e o modelo em jogo", async () => {
    // O cliente tenta mandar minuto e placar: o payload só aceita as chaves do contrato.
    const res = await registerBetSlip(
      null,
      form(slip({ legs: [{ ...HOME, userOdd: "1.50" }, OVER] }))
    );
    expect(res.ok).toBe(true);
    // Relê o estado com a idade máxima de registro (2 min).
    expect(mockInPlayState).toHaveBeenCalledWith(
      expect.objectContaining({ id: MATCH_ID }),
      expect.objectContaining({ maxAgeMs: 120_000 })
    );
    // Sem referência (odd de antes do jogo), sem análise salva, sem modelo de pré-jogo.
    expect(mockRefs).not.toHaveBeenCalled();
    expect(mockHistory).not.toHaveBeenCalled();
    expect(mockModel).not.toHaveBeenCalled();
    const slips = inserted();
    expect(slips).toHaveLength(2);
    for (const s of slips) {
      expect(s.isLive).toBe(true);
      const stamp = readLiveStamp(s.liveState);
      expect(stamp).toMatchObject({
        source: "api_football",
        status: "2H",
        elapsed: 63,
        minuteLabel: "63'",
        score: { home: 1, away: 0 },
      });
      expect(stamp?.inPlay?.liveModelVersion).toBe("live_model_v1");
      // Sem stake sugerido ao vivo.
      expect(s.legs[0].suggestedStakeUnits ?? null).toBeNull();
      expect(s.legs[0].referenceOdd ?? null).toBeNull();
    }
    if (!res.ok) return;
    // Explicar com IA (#562) é só pré-jogo; o modelo em jogo não grava a base.
    expect(res.explainable).toBe(false);
    for (const s of slips) expect(s.modelSnapshotId ?? null).toBeNull();
    expect(res.evaluation.legs[0].suggestedStake).toBeNull();
    expect(res.evaluation.legs[0].sourceLabel).toBe("modelo ao vivo");
    expect(res.evaluation.legs[0].edgeNote).toBeNull();
  });

  it("sem modelo em jogo: registra sem avaliação, ainda carimbado", async () => {
    mockInPlayModel.mockResolvedValue(null);
    const res = await registerBetSlip(null, form(slip()));
    expect(res.ok).toBe(true);
    const [s] = inserted();
    expect(s.isLive).toBe(true);
    expect(s.legs[0]).toMatchObject({ gradeSource: "none", gradeStatus: "no_data" });
    expect(readLiveStamp(s.liveState)?.inPlay).toBeUndefined();
  });

  it("estado velho (> 2 min) que a busca não renovou → recusa com a copy do plano", async () => {
    mockInPlayState.mockResolvedValue(
      liveState({ fetchedAt: new Date(Date.now() - 3 * 60_000) })
    );
    const res = await registerBetSlip(null, form(slip()));
    expect(res).toEqual({
      ok: false,
      error: "Placar ao vivo indisponível agora. Tente em um minuto.",
      kind: "nao-analisavel",
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("sem estado nenhum → mesma recusa", async () => {
    mockInPlayState.mockResolvedValue(null);
    const res = await registerBetSlip(null, form(slip()));
    expect(res).toMatchObject({
      ok: false,
      error: "Placar ao vivo indisponível agora. Tente em um minuto.",
    });
  });

  it("atraso no apito (NS depois do horário, 0–0): registra no minuto 0", async () => {
    mockGetMatchById.mockResolvedValue(
      match("scheduled", new Date(Date.now() - 5 * 60_000))
    );
    // getInPlayState já entrega o 0–0 do atraso (inPlayScore, lib/live/in-play-state).
    mockInPlayState.mockResolvedValue(
      liveState({
        statusShort: "NS",
        elapsed: null,
        minuteLabel: "0'",
        score: { home: 0, away: 0 },
        red: null,
      })
    );
    const res = await registerBetSlip(null, form(slip()));
    expect(res.ok).toBe(true);
    const [s] = inserted();
    expect(s.isLive).toBe(true);
    expect(readLiveStamp(s.liveState)).toMatchObject({
      status: "NS",
      minuteLabel: "0'",
      score: { home: 0, away: 0 },
    });
  });

  it("estado sem placar → recusa", async () => {
    mockInPlayState.mockResolvedValue(liveState({ score: null }));
    const res = await registerBetSlip(null, form(slip()));
    expect(res).toMatchObject({ ok: false, kind: "nao-analisavel" });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("seleção já decidida pelo placar → 'Esse mercado já está decidido.'", async () => {
    mockInPlayState.mockResolvedValue(liveState({ score: { home: 2, away: 1 } }));
    const res = await registerBetSlip(null, form(slip({ legs: [OVER] })));
    expect(res).toEqual({
      ok: false,
      error: "Esse mercado já está decidido.",
      kind: "mercado-ao-vivo",
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("tipo fora da tabela ao vivo (1º tempo, quem marca primeiro) → recusa", async () => {
    for (const leg of [
      { kind: "first_to_score", params: { firstToScore: "home" } },
      { kind: "first_half_over_under", params: { selection: "over", line: 0.5 } },
    ]) {
      mockInsert.mockClear();
      const res = await registerBetSlip(null, form(slip({ legs: [leg] })));
      expect(res).toMatchObject({ ok: false, kind: "mercado-ao-vivo" });
      if (res.ok) continue;
      expect(res.error).toContain("Com o jogo rolando");
      expect(mockInsert).not.toHaveBeenCalled();
    }
  });

  it("prorrogação → recusa pelo motivo (mercados de 90' decididos)", async () => {
    mockInPlayState.mockResolvedValue(liveState({ statusShort: "ET", elapsed: 95 }));
    const res = await registerBetSlip(null, form(slip()));
    expect(res).toMatchObject({ ok: false, kind: "nao-analisavel" });
    if (res.ok) return;
    expect(res.error).toContain("prorrogação");
  });

  it("flag desligada → o gate de hoje, sem ler o estado", async () => {
    mockLiveMode.mockResolvedValue(false);
    const res = await registerBetSlip(null, form(slip()));
    expect(res).toMatchObject({ ok: false, kind: "nao-analisavel" });
    if (res.ok) return;
    expect(res.error).toContain("só antes do apito inicial");
    expect(mockInPlayState).not.toHaveBeenCalled();
  });

  it("página aberta antes do apito (tabela de pré-jogo) → recusa, pede pra atualizar", async () => {
    for (const payload of [slip({ gridLive: false }), slip({ gridLive: undefined })]) {
      mockInsert.mockClear();
      const res = await registerBetSlip(
        null,
        form({ ...payload, legs: [{ ...HOME, userOdd: "1.80" }] })
      );
      expect(res).toEqual({
        ok: false,
        error: "O jogo começou. Atualize a página para registrar ao vivo.",
        kind: "nao-analisavel",
      });
      expect(mockInsert).not.toHaveBeenCalled();
    }
  });

  it("tabela ao vivo e jogo ainda antes do apito no servidor: registra como pré-jogo", async () => {
    mockGetMatchById.mockResolvedValue(match());
    const res = await registerBetSlip(null, form(slip({ gridLive: true })));
    expect(res.ok).toBe(true);
    const [s] = inserted();
    expect(s.isLive).toBe(false);
    expect(mockInPlayState).not.toHaveBeenCalled();
  });

  it("pré-jogo não lê a flag nem o estado, e o slip sai sem carimbo", async () => {
    mockGetMatchById.mockResolvedValue(match());
    await registerBetSlip(null, form(slip()));
    expect(mockLiveMode).not.toHaveBeenCalled();
    expect(mockInPlayState).not.toHaveBeenCalled();
    const [s] = inserted();
    expect(s.isLive).toBe(false);
    expect(s.liveState).toBeNull();
  });
});
