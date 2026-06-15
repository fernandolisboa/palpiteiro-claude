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
// marketsForAudience é a fonte do gate de AUDIÊNCIA re-validado na action (mockada
// pra refletir admin vê match_result; comum só over_under). marketsForLeague (gate
// de COBERTURA de liga, #158) fica REAL — pura, descriptor-driven — pra exercitar
// o gate de verdade. db é Proxy lazy (importar não conecta).
vi.mock("@/lib/db/queries/market-catalog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/db/queries/market-catalog")>();
  return { ...actual, marketsForAudience: vi.fn() };
});
// getMatchById carrega a liga p/ o gate de cobertura ANTES da coerção/spend.
vi.mock("@/lib/db/queries/matches", () => ({ getMatchById: vi.fn() }));
// pre-warm de odds por evento (btts) — mockado (sem rede/quota nos testes).
vi.mock("@/lib/odds/fetch-and-snapshot", () => ({
  ensureOddsSnapshotsFresh: vi.fn(),
}));
vi.mock("@/lib/db/queries/users", () => ({ getUserAccessState: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkAnalysisRateLimit: vi.fn() }));
vi.mock("@/lib/view/analysis", () => ({ toAnalysisView: vi.fn(() => ({})) }));
vi.mock("@/lib/db/queries/ai-config", () => ({
  getEnableOverUnderExtraLines: vi.fn(),
}));

import { analyzeMatch } from "@/app/actions/predictions";
import { auth } from "@/auth";
import { predict } from "@/lib/ai/predict";
import { getEnableOverUnderExtraLines } from "@/lib/db/queries/ai-config";
import { marketsForAudience } from "@/lib/db/queries/market-catalog";
import { getMatchById } from "@/lib/db/queries/matches";
import { getAiCallById } from "@/lib/db/queries/predictions";
import { getUserAccessState } from "@/lib/db/queries/users";
import { ensureOddsSnapshotsFresh } from "@/lib/odds/fetch-and-snapshot";
import { checkAnalysisRateLimit } from "@/lib/rate-limit";
import { toAnalysisView } from "@/lib/view/analysis";

// `auth` é sobrecarregado; estreitamos pro uso como `auth()`.
const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const mockPredict = vi.mocked(predict);
const mockMarketsForAudience = vi.mocked(marketsForAudience);
const mockGetMatchById = vi.mocked(getMatchById);
const mockEnsureOdds = vi.mocked(ensureOddsSnapshotsFresh);
const mockGetAccess = vi.mocked(getUserAccessState);
// Helpers de estado de acesso (DB) — ativo (allowed:true) é o default dos testes
// que só querem passar do gate; bloqueado e órfão (null) têm testes dedicados.
const ALLOWED_ADMIN = { role: "admin" as const, allowed: true };
const ALLOWED_USER = { role: "user" as const, allowed: true };
const mockGetAiCall = vi.mocked(getAiCallById);
const mockRateLimit = vi.mocked(checkAnalysisRateLimit);
const mockToAnalysisView = vi.mocked(toAnalysisView);
const mockExtraLinesFlag = vi.mocked(getEnableOverUnderExtraLines);

const OVER_UNDER_MARKET = { key: "over_under", label: "Over/Under gols" };
const MATCH_RESULT_MARKET = { key: "match_result", label: "Resultado (1X2)" };
const BTTS_MARKET = { key: "btts", label: "Ambas marcam" };
const DOUBLE_CHANCE_MARKET = { key: "double_chance", label: "Dupla chance" };

// Match fixtures por liga (league p/ o gate de cobertura; status p/ analisabilidade).
function matchInLeague(league: string, status = "scheduled") {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    league,
    status,
    homeTeam: "Mexico",
    awayTeam: "South Africa",
    kickoffAt: new Date("2026-06-11T19:00:00.000Z"),
  } as unknown as Awaited<ReturnType<typeof getMatchById>>;
}

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
  mockGetAccess.mockReset();
  mockGetAiCall.mockReset();
  // Flag de linhas extras (#175) OFF por padrão → caminho de hoje; testes
  // específicos sobrescrevem pra exercitar o multi-linha.
  mockExtraLinesFlag.mockReset();
  mockExtraLinesFlag.mockResolvedValue(false);
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
  // Gate de mercado audiência-aware (espelha o resolver real PÓS-graduação #261):
  // todos os mercados ativos estão graduados, então admin E comum veem o mesmo
  // conjunto (over_under + match_result + btts + double_chance). O recorte por liga
  // (btts/dc → world_cup) fica por conta de marketsForLeague (gate real, não mockado).
  mockMarketsForAudience.mockReset();
  mockMarketsForAudience.mockImplementation(async () => [
    OVER_UNDER_MARKET,
    MATCH_RESULT_MARKET,
    BTTS_MARKET,
    DOUBLE_CHANCE_MARKET,
  ]);
  // Default: jogo world_cup (cobre btts). getMatchById é alcançado só após os gates
  // de pré-spend (auth/rate-limit retornam antes). ensureOddsSnapshotsFresh é no-op.
  mockGetMatchById.mockReset();
  mockGetMatchById.mockResolvedValue(matchInLeague("world_cup"));
  mockEnsureOdds.mockReset();
  mockEnsureOdds.mockResolvedValue(null);
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

  it("bounces a session whose user row no longer exists (getUserAccessState → null), without calling predict (no Anthropic cost)", async () => {
    mockAuth.mockResolvedValue(SESSION);
    mockGetAccess.mockResolvedValue(null);
    const res = await analyzeMatch(null, form({ matchId: VALID_MATCH_ID }));
    expect(res).toEqual({
      ok: false,
      error: "Sua sessão expirou. Faça login novamente.",
    });
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("bloqueia um usuário com allowed=false (guarda de custo load-bearing #264), sem chamar predict", async () => {
    mockAuth.mockResolvedValue(USER_SESSION);
    mockGetAccess.mockResolvedValue({ role: "user", allowed: false });
    const res = await analyzeMatch(null, form({ matchId: VALID_MATCH_ID }));
    expect(res).toEqual({
      ok: false,
      error: "Seu acesso está bloqueado. Fale com o administrador.",
    });
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("bloqueia ATÉ um admin com allowed=false (sem bypass por role; #264/ADR 0023)", async () => {
    mockAuth.mockResolvedValue(SESSION);
    mockGetAccess.mockResolvedValue({ role: "admin", allowed: false });
    const res = await analyzeMatch(null, form({ matchId: VALID_MATCH_ID }));
    expect(res).toEqual({
      ok: false,
      error: "Seu acesso está bloqueado. Fale com o administrador.",
    });
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("rejects a rate-limited request without calling predict (no Anthropic cost)", async () => {
    mockAuth.mockResolvedValue(SESSION);
    mockGetAccess.mockResolvedValue(ALLOWED_ADMIN);
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

  it("recusa com copy de indisponibilidade quando o rate-limit falha fechado (reason:'fail-closed'), sem chamar predict", async () => {
    mockAuth.mockResolvedValue(USER_SESSION);
    mockGetAccess.mockResolvedValue(ALLOWED_USER);
    // Fail-closed (KV ausente p/ não-admin): o discriminador explícito, não limit:0.
    mockRateLimit.mockResolvedValue({
      ok: false,
      limit: 0,
      remaining: 0,
      reset: 0,
      reason: "fail-closed",
    });
    const res = await analyzeMatch(null, form({ matchId: VALID_MATCH_ID }));
    expect(res).toEqual({
      ok: false,
      error: "Análises temporariamente indisponíveis. Tente mais tarde.",
    });
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("um limit:0 LEGÍTIMO (sem reason) cai na copy de teto real, não na de indisponibilidade", async () => {
    // Prova que o discriminador desacoplou a copy de fail-closed do valor limit:0:
    // um teto real de 0 (config inesperada do Upstash) não dispara mais a copy de
    // indisponibilidade por engano (ADR 0023, finding de code review).
    mockAuth.mockResolvedValue(USER_SESSION);
    mockGetAccess.mockResolvedValue(ALLOWED_USER);
    mockRateLimit.mockResolvedValue({
      ok: false,
      limit: 0,
      remaining: 0,
      reset: 0,
    });
    const res = await analyzeMatch(null, form({ matchId: VALID_MATCH_ID }));
    expect(res).toEqual({
      ok: false,
      error: "Você atingiu o limite de 0 análises por dia. Tente novamente amanhã.",
    });
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("passes the user id and role to the rate-limit gate before predicting", async () => {
    mockAuth.mockResolvedValue(USER_SESSION);
    mockGetAccess.mockResolvedValue(ALLOWED_USER);
    mockPredict.mockResolvedValue(PREDICTION);
    mockGetAiCall.mockResolvedValue({ costUsd: "0.01" } as never);
    await analyzeMatch(null, form({ matchId: VALID_MATCH_ID }));
    expect(mockRateLimit).toHaveBeenCalledWith("u2", "user");
    expect(mockPredict).toHaveBeenCalled();
  });

  it("forwards an admin session's role to the rate-limit gate (admin tier)", async () => {
    mockAuth.mockResolvedValue(SESSION);
    mockGetAccess.mockResolvedValue(ALLOWED_ADMIN);
    mockPredict.mockResolvedValue(PREDICTION);
    mockGetAiCall.mockResolvedValue({ costUsd: "0.01" } as never);
    await analyzeMatch(null, form({ matchId: VALID_MATCH_ID }));
    expect(mockRateLimit).toHaveBeenCalledWith("u1", "admin");
    expect(mockPredict).toHaveBeenCalled();
  });
});

describe("analyzeMatch — model override gating", () => {
  beforeEach(() => {
    mockGetAccess.mockResolvedValue(ALLOWED_ADMIN);
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
      extraLines: false,
    });
  });

  it("regular user + stale/removed override (Fable, fora do registry após #241) is IGNORED", async () => {
    // Após #241 o Fable não está no registry; um override forjado com esse id é
    // tratado como desconhecido pelo gate e cai pro default — queda graciosa.
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
      extraLines: false,
    });
  });

  it("admin + stale/removed override (Fable) is ALSO ignored (não há mais modelo admin-only)", async () => {
    // Antes este caso provava que admin podia forçar um modelo admin-only. Após
    // #240 + #241 não sobra modelo admin-only; o Fable virou id desconhecido e é
    // ignorado até pra admin. O caminho "admin força id válido" fica coberto pelo
    // teste de Sonnet 4.5 abaixo.
    mockAuth.mockResolvedValue(SESSION);
    await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, modelOverride: "claude-fable-5" }),
    );
    expect(mockPredict).toHaveBeenCalledWith({
      matchId: VALID_MATCH_ID,
      userId: "u1",
      isAdmin: true,
      modelOverride: undefined,
      marketKey: "over_under",
      extraLines: false,
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
      extraLines: false,
    });
  });

  it("regular user + Sonnet 4.5 override (promovido em #240) é AGORA encaminhado", async () => {
    // Sonnet 4.5 passou a userSelectable em #240, então um usuário comum pode
    // forçá-lo por análise — antes era ignorado por ser admin-only.
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
      modelOverride: "claude-sonnet-4-5-20250929",
      marketKey: "over_under",
      extraLines: false,
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
      extraLines: false,
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
      extraLines: false,
    });
  });
});

describe("analyzeMatch — market audience gating", () => {
  beforeEach(() => {
    mockGetAccess.mockResolvedValue(ALLOWED_ADMIN);
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
      extraLines: false,
    });
  });

  it("non-admin selecting match_result (graduado #261, in-audience) threads it to predict", async () => {
    mockAuth.mockResolvedValue(USER_SESSION);
    await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, marketKey: "match_result" }),
    );
    // Pós-graduação (#261): match_result está graduado, então o usuário comum o vê
    // e a action o passa adiante — sem coerção. (1X2 não tem gate de liga.)
    expect(mockPredict).toHaveBeenCalledWith({
      matchId: VALID_MATCH_ID,
      userId: "u2",
      isAdmin: false,
      modelOverride: undefined,
      marketKey: "match_result",
      extraLines: false,
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
      extraLines: false,
    });
  });
});

// #158: btts só é analisável em ligas com cobertura de odds validada (world_cup).
// O gate de liga (marketsForLeague REAL) compõe com o de audiência; a action é a
// FRONTEIRA DE SEGURANÇA (a UI só esconde o seletor).
describe("analyzeMatch — market league coverage gating (#158)", () => {
  beforeEach(() => {
    mockGetAccess.mockResolvedValue(ALLOWED_ADMIN);
    mockPredict.mockResolvedValue(PREDICTION);
    mockGetAiCall.mockResolvedValue({ costUsd: "0.01" } as never);
  });

  it("admin + btts numa partida world_cup → btts threadeado + pre-warm de odds", async () => {
    mockAuth.mockResolvedValue(SESSION);
    mockGetMatchById.mockResolvedValue(matchInLeague("world_cup"));
    await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, marketKey: "btts" }),
    );
    expect(mockPredict).toHaveBeenCalledWith({
      matchId: VALID_MATCH_ID,
      userId: "u1",
      isAdmin: true,
      modelOverride: undefined,
      marketKey: "btts",
      extraLines: false,
    });
    // additional market → pre-warm por evento ANTES do predict (1x), e nessa ORDEM
    // (o pre-warm garante o snapshot fresco que o predict reusa). Pina a ordem pra um
    // refactor que invertesse falhar em CI (#174 code review, finding 6).
    expect(mockEnsureOdds).toHaveBeenCalledTimes(1);
    expect(mockEnsureOdds.mock.invocationCallOrder[0]).toBeLessThan(
      mockPredict.mock.invocationCallOrder[0],
    );
  });

  it("btts numa partida world_cup ENCERRADA → erro de analisabilidade, SEM pre-warm nem spend (#174)", async () => {
    mockAuth.mockResolvedValue(SESSION);
    mockGetMatchById.mockResolvedValue(matchInLeague("world_cup", "finished"));
    const res = await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, marketKey: "btts" }),
    );
    expect(res).toEqual({
      ok: false,
      error: "Este jogo já foi encerrado ou cancelado.",
    });
    // o pre-warm por evento (1 crédito) NUNCA roda pra um jogo não-analisável.
    expect(mockEnsureOdds).not.toHaveBeenCalled();
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("btts sem book ofertando (predict lança 'sem snapshot fresco') → copy específica", async () => {
    mockAuth.mockResolvedValue(SESSION);
    mockGetMatchById.mockResolvedValue(matchInLeague("world_cup"));
    const { PredictError } = await import("@/lib/ai/predict");
    mockPredict.mockRejectedValue(
      new PredictError("additional-market 'btts' sem snapshot fresco", {}),
    );
    const res = await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, marketKey: "btts" }),
    );
    expect(res).toEqual({
      ok: false,
      error: "Nenhum bookmaker oferece este mercado para o jogo no momento.",
    });
  });

  it("admin + btts numa partida brasileirao (sem cobertura) → COERCIDO a over_under, SEM pre-warm", async () => {
    mockAuth.mockResolvedValue(SESSION);
    mockGetMatchById.mockResolvedValue(matchInLeague("brasileirao_a"));
    await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, marketKey: "btts" }),
    );
    // btts não tem cobertura no brasileirao → marketsForLeague o dropa → coerce.
    expect(mockPredict).toHaveBeenCalledWith({
      matchId: VALID_MATCH_ID,
      userId: "u1",
      isAdmin: true,
      modelOverride: undefined,
      marketKey: "over_under",
      extraLines: false,
    });
    // over_under é featured → nenhum pre-warm de odds por evento.
    expect(mockEnsureOdds).not.toHaveBeenCalled();
  });

  it("over_under/match_result passam em QUALQUER liga (pass-through, paridade)", async () => {
    mockAuth.mockResolvedValue(SESSION);
    mockGetMatchById.mockResolvedValue(matchInLeague("brasileirao_a"));
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
      extraLines: false,
    });
    expect(mockEnsureOdds).not.toHaveBeenCalled();
  });

  it("jogo inexistente → 'Jogo não encontrado' antes de qualquer spend", async () => {
    mockAuth.mockResolvedValue(SESSION);
    mockGetMatchById.mockResolvedValue(null);
    const res = await analyzeMatch(null, form({ matchId: VALID_MATCH_ID }));
    expect(res).toEqual({ ok: false, error: "Jogo não encontrado." });
    expect(mockPredict).not.toHaveBeenCalled();
    expect(mockEnsureOdds).not.toHaveBeenCalled();
  });
});

// #176: dupla chance é additional (odds por evento) + world_cup-only, idem btts.
// Pina a mesma fronteira de segurança: gate de liga + pre-warm na ordem certa +
// coerção fora da cobertura + sem spend em jogo encerrado.
describe("analyzeMatch — double_chance league coverage gating (#176)", () => {
  beforeEach(() => {
    mockGetAccess.mockResolvedValue(ALLOWED_ADMIN);
    mockPredict.mockResolvedValue(PREDICTION);
    mockGetAiCall.mockResolvedValue({ costUsd: "0.01" } as never);
  });

  it("admin + double_chance numa partida world_cup → threadeado + pre-warm de odds (na ordem)", async () => {
    mockAuth.mockResolvedValue(SESSION);
    mockGetMatchById.mockResolvedValue(matchInLeague("world_cup"));
    await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, marketKey: "double_chance" }),
    );
    expect(mockPredict).toHaveBeenCalledWith({
      matchId: VALID_MATCH_ID,
      userId: "u1",
      isAdmin: true,
      modelOverride: undefined,
      marketKey: "double_chance",
      extraLines: false,
    });
    // additional market → pre-warm por evento ANTES do predict (1x), nessa ORDEM.
    expect(mockEnsureOdds).toHaveBeenCalledTimes(1);
    expect(mockEnsureOdds.mock.invocationCallOrder[0]).toBeLessThan(
      mockPredict.mock.invocationCallOrder[0],
    );
  });

  it("double_chance numa partida world_cup ENCERRADA → erro de analisabilidade, SEM pre-warm nem spend", async () => {
    mockAuth.mockResolvedValue(SESSION);
    mockGetMatchById.mockResolvedValue(matchInLeague("world_cup", "finished"));
    const res = await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, marketKey: "double_chance" }),
    );
    expect(res).toEqual({
      ok: false,
      error: "Este jogo já foi encerrado ou cancelado.",
    });
    expect(mockEnsureOdds).not.toHaveBeenCalled();
    expect(mockPredict).not.toHaveBeenCalled();
  });

  it("admin + double_chance numa partida brasileirao (sem cobertura) → COERCIDO a over_under, SEM pre-warm", async () => {
    mockAuth.mockResolvedValue(SESSION);
    mockGetMatchById.mockResolvedValue(matchInLeague("brasileirao_a"));
    await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, marketKey: "double_chance" }),
    );
    expect(mockPredict).toHaveBeenCalledWith({
      matchId: VALID_MATCH_ID,
      userId: "u1",
      isAdmin: true,
      modelOverride: undefined,
      marketKey: "over_under",
      extraLines: false,
    });
    expect(mockEnsureOdds).not.toHaveBeenCalled();
  });
});

// Caminho de SUCESSO: o carrier N-vias de predict() (#173) é destruturado e
// threadeado em toAnalysisView (marketKey RESOLVIDO + candidate set), e a action
// devolve { ok: true, view }. Sem o mock no shape novo, este caminho nem rodaria.
describe("analyzeMatch — success path view wiring", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockGetAccess.mockResolvedValue(ALLOWED_ADMIN);
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

// #175: linhas extras de over/under atrás da flag (ai_config), pra TODOS os usuários
// onde a variante multi-linha tem cobertura (alternate_totals → world_cup por ora).
describe("analyzeMatch — over/under linhas extras (#175)", () => {
  beforeEach(() => {
    mockUserExists.mockResolvedValue(true);
    mockPredict.mockResolvedValue(PREDICTION);
    mockGetAiCall.mockResolvedValue({ costUsd: "0.01" } as never);
  });

  it("flag ON + over_under em world_cup (usuário COMUM) → extraLines:true + pre-warm additional alternate_totals", async () => {
    mockAuth.mockResolvedValue(USER_SESSION);
    mockExtraLinesFlag.mockResolvedValue(true);
    mockGetMatchById.mockResolvedValue(matchInLeague("world_cup"));

    await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, marketKey: "over_under" }),
    );

    // predict recebe extraLines:true → getCartridge devolve a variante v3 (multi-linha).
    expect(mockPredict).toHaveBeenCalledWith({
      matchId: VALID_MATCH_ID,
      userId: "u2",
      isAdmin: false,
      modelOverride: undefined,
      marketKey: "over_under",
      extraLines: true,
    });
    // over_under vira additional sob flag → pre-warm POR EVENTO da escada (1 crédito),
    // ANTES do predict. O descriptor efetivo é o da variante (alternate_totals/escada).
    expect(mockEnsureOdds).toHaveBeenCalledTimes(1);
    const descriptor = mockEnsureOdds.mock.calls[0][1]?.markets?.[0];
    expect(descriptor?.oddsSource).toBe("additional");
    expect(descriptor?.providerMarketKey).toBe("alternate_totals");
    expect(descriptor?.candidateLines).toEqual([1.5, 2.5, 3.5]);
    expect(mockEnsureOdds.mock.invocationCallOrder[0]).toBeLessThan(
      mockPredict.mock.invocationCallOrder[0],
    );
  });

  it("flag ON mas liga SEM cobertura (brasileirao) → extraLines:false (graceful featured 2.5, sem pre-warm)", async () => {
    mockAuth.mockResolvedValue(USER_SESSION);
    mockExtraLinesFlag.mockResolvedValue(true);
    mockGetMatchById.mockResolvedValue(matchInLeague("brasileirao_a"));

    await analyzeMatch(
      null,
      form({ matchId: VALID_MATCH_ID, marketKey: "over_under" }),
    );

    expect(mockPredict).toHaveBeenCalledWith({
      matchId: VALID_MATCH_ID,
      userId: "u2",
      isAdmin: false,
      modelOverride: undefined,
      marketKey: "over_under",
      extraLines: false,
    });
    // featured 2.5 → SEM pre-warm additional.
    expect(mockEnsureOdds).not.toHaveBeenCalled();
  });
});
