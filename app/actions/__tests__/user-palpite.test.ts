import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Session } from "next-auth";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/queries/matches", () => ({ getMatchById: vi.fn() }));
vi.mock("@/lib/db/queries/users", () => ({ getUserAccessState: vi.fn() }));
vi.mock("@/lib/db/queries/ai-config", () => ({
  getEnableUserContext: vi.fn(),
  // Modo ao vivo desligado: o caminho de pré-jogo de sempre (o ao vivo tem suíte própria).
  getEnableLiveMode: vi.fn(async () => false),
}));
vi.mock("@/lib/db/queries/user-palpite-analyses", () => ({
  insertUserPalpiteAnalysis: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ checkPalpitesRateLimit: vi.fn() }));
vi.mock("@/lib/server/request-timezone", () => ({
  getRequestTimeZone: vi.fn(async () => "America/Sao_Paulo"),
}));
vi.mock("@/lib/user-palpite/model-base", () => ({ resolvePalpiteModelBase: vi.fn() }));
vi.mock("@/lib/user-palpite/facts", () => ({ fetchPalpiteFacts: vi.fn() }));
vi.mock("@/lib/ai/user-palpite/extract", () => ({ extractPalpiteClaims: vi.fn() }));
vi.mock("@/lib/ai/user-palpite/narrate", () => ({ narratePalpite: vi.fn() }));
vi.mock("@/lib/auth/whitelist", () => ({ isEmailAllowed: vi.fn(() => false) }));

import { analyzeUserPalpite } from "@/app/actions/user-palpite";
import { auth } from "@/auth";
import { ANALYSES_UNAVAILABLE_MESSAGE } from "@/lib/ai/best-bet";
import { extractPalpiteClaims } from "@/lib/ai/user-palpite/extract";
import { narratePalpite } from "@/lib/ai/user-palpite/narrate";
import { isEmailAllowed } from "@/lib/auth/whitelist";
import { getEnableUserContext } from "@/lib/db/queries/ai-config";
import { getMatchById } from "@/lib/db/queries/matches";
import {
  insertUserPalpiteAnalysis,
  type NewUserPalpiteAnalysis,
} from "@/lib/db/queries/user-palpite-analyses";
import { getUserAccessState } from "@/lib/db/queries/users";
import { checkPalpitesRateLimit } from "@/lib/rate-limit";
import { fetchPalpiteFacts } from "@/lib/user-palpite/facts";
import {
  resolvePalpiteModelBase,
  type PalpiteModelBase,
} from "@/lib/user-palpite/model-base";
import type { Claim } from "@/lib/user-palpite/types";

const mockAuth = auth as unknown as Mock<() => Promise<Session | null>>;
const mockAccess = vi.mocked(getUserAccessState);
const mockFlag = vi.mocked(getEnableUserContext);
const mockMatch = vi.mocked(getMatchById);
const mockBase = vi.mocked(resolvePalpiteModelBase);
const mockRateLimit = vi.mocked(checkPalpitesRateLimit);
const mockExtract = vi.mocked(extractPalpiteClaims);
const mockNarrate = vi.mocked(narratePalpite);
const mockFacts = vi.mocked(fetchPalpiteFacts);
const mockInsert = vi.mocked(insertUserPalpiteAnalysis);
const mockWhitelist = vi.mocked(isEmailAllowed);

const MATCH_ID = "550e8400-e29b-41d4-a716-446655440000";
const EXTRACT_CALL = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const NARRATE_CALL = "6ba7b811-9dad-41d1-80b4-00c04fd430c8";

const USER_SESSION = {
  user: { id: "u1", email: "a@b.com", role: "user" },
  expires: "2099-01-01",
} as unknown as Session;

const BASE: PalpiteModelBase = {
  origin: "live",
  snapshotId: null,
  modelVersion: null,
  snapshotWeightsVersion: null,
  source: "dixon_coles",
  degraded: false,
  fallbackReason: null,
  staleBase: false,
  lambdaHomeBase: 1.6,
  lambdaAwayBase: 1.0,
  rho: null,
  jevAnswers: null,
};

const ABSENCE: Claim = {
  team: "away",
  topic: "absence",
  text: "o jogador citado, atacante, está fora",
  players: ["Flaco López"],
  role: "attack",
};

function match(status = "scheduled", kickoffAt = new Date("2099-06-11T19:00:00.000Z")) {
  return {
    id: MATCH_ID,
    league: "brasileirao_a",
    status,
    homeTeam: "Flamengo",
    awayTeam: "Palmeiras",
    kickoffAt,
    neutralVenue: false,
  } as unknown as Awaited<ReturnType<typeof getMatchById>>;
}

function form(over: Record<string, string | undefined> = {}): FormData {
  const fields: Record<string, string | undefined> = {
    matchId: MATCH_ID,
    palpite: JSON.stringify({ kind: "score", home: 2, away: 0 }),
    reason: "  o Palmeiras está sem o Flaco López  ",
    ...over,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.append(k, v);
  return fd;
}

function inserted(): NewUserPalpiteAnalysis {
  expect(mockInsert).toHaveBeenCalledTimes(1);
  return mockInsert.mock.calls[0][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(USER_SESSION);
  mockAccess.mockResolvedValue({ role: "user", allowed: true } as Awaited<
    ReturnType<typeof getUserAccessState>
  >);
  mockWhitelist.mockReturnValue(false);
  mockFlag.mockResolvedValue(true);
  mockMatch.mockResolvedValue(match());
  mockBase.mockResolvedValue(BASE);
  mockRateLimit.mockResolvedValue({ ok: true, limit: 50, remaining: 49, reset: 0 });
  mockExtract.mockResolvedValue({
    ok: true,
    claims: [ABSENCE],
    warnings: [],
    aiCallId: EXTRACT_CALL,
  });
  mockFacts.mockResolvedValue({
    absences: { available: true, data: { home: [], away: [] } },
  });
  mockNarrate.mockImplementation(async ({ input }) => ({
    narration: {
      veredito: input.codeVerdict,
      resumo: "Resumo do narrador.",
      pontos: ["Um ponto."],
      discordancias: [],
    },
    source: "llm",
    aiCallId: NARRATE_CALL,
  }));
  mockInsert.mockResolvedValue("a1b2c3d4-0000-4000-8000-000000000001");
});

function expectNothingCalled() {
  expect(mockAuth).not.toHaveBeenCalled();
  expect(mockRateLimit).not.toHaveBeenCalled();
  expect(mockExtract).not.toHaveBeenCalled();
  expect(mockInsert).not.toHaveBeenCalled();
}

describe("analyzeUserPalpite — input", () => {
  it("uuid inválido → invalido, nada chamado", async () => {
    const res = await analyzeUserPalpite(null, form({ matchId: "x" }));
    expect(res).toEqual({
      ok: false,
      error: "Identificador de jogo inválido.",
      kind: "invalido",
    });
    expectNothingCalled();
  });

  it("motivo vazio → copy da leitura grátis", async () => {
    const res = await analyzeUserPalpite(null, form({ reason: "  " }));
    expect(res).toEqual({
      ok: false,
      error:
        "Escreva o motivo do seu palpite. A leitura pelos botões é grátis e não precisa dele.",
      kind: "invalido",
    });
    expectNothingCalled();
  });

  it("motivo acima de 1000 caracteres → invalido", async () => {
    const res = await analyzeUserPalpite(null, form({ reason: "a".repeat(1001) }));
    expect(res).toMatchObject({ ok: false, kind: "invalido" });
    expectNothingCalled();
  });

  it("CRLF do navegador conta como 1 caractere, como o contador do cliente (#564 review)", async () => {
    // 1000 caracteres com LF (o que o contador mostra), 1333 com CRLF (o que o form manda).
    const reason = "ab\r\n".repeat(333) + "a";
    const res = await analyzeUserPalpite(null, form({ reason }));
    expect(res.ok).toBe(true);
    expect(inserted().reasonText).toBe("ab\n".repeat(333) + "a");
    // Passando de 1000 mesmo com LF: inválido, com a copy de tamanho.
    mockInsert.mockClear();
    const long = await analyzeUserPalpite(null, form({ reason: "ab\r\n".repeat(333) + "abc" }));
    expect(long).toEqual({
      ok: false,
      error: "O motivo passou de 1000 caracteres.",
      kind: "invalido",
    });
  });

  it("JSON de palpite inválido → Palpite inválido.", async () => {
    const res = await analyzeUserPalpite(null, form({ palpite: "{nope" }));
    expect(res).toEqual({ ok: false, error: "Palpite inválido.", kind: "invalido" });
    expectNothingCalled();
  });

  it("palpite fora do schema → Palpite inválido.", async () => {
    const res = await analyzeUserPalpite(
      null,
      form({ palpite: JSON.stringify({ kind: "score", home: 12, away: 0 }) }),
    );
    expect(res).toMatchObject({ ok: false, error: "Palpite inválido." });
    expectNothingCalled();
  });

  it("sem palpite dos botões → pede para escolher, sem gastar", async () => {
    const res = await analyzeUserPalpite(null, form({ palpite: "" }));
    expect(res).toEqual({
      ok: false,
      error: "Escolha um placar ou um resultado antes de analisar.",
      kind: "invalido",
    });
    expectNothingCalled();
  });
});

describe("analyzeUserPalpite — gates grátis antes da cobrança", () => {
  it("sem sessão", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await analyzeUserPalpite(null, form())).toEqual({
      ok: false,
      error: "Faça login para analisar.",
    });
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("acesso bloqueado; a whitelist libera", async () => {
    mockAccess.mockResolvedValue({ role: "user", allowed: false } as Awaited<
      ReturnType<typeof getUserAccessState>
    >);
    expect(await analyzeUserPalpite(null, form())).toMatchObject({
      ok: false,
      error: "Seu acesso está bloqueado. Fale com o administrador.",
    });
    mockWhitelist.mockReturnValue(true);
    expect(await analyzeUserPalpite(null, form())).toMatchObject({ ok: true });
  });

  it("flag desligada: nem rate-limit nem extração", async () => {
    mockFlag.mockResolvedValue(false);
    const res = await analyzeUserPalpite(null, form());
    expect(res).toMatchObject({ ok: false, kind: "desligado" });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("jogo inexistente", async () => {
    mockMatch.mockResolvedValue(null);
    expect(await analyzeUserPalpite(null, form())).toEqual({
      ok: false,
      error: "Jogo não encontrado.",
    });
  });

  it("jogo já começado → nao-analisavel", async () => {
    mockMatch.mockResolvedValue(match("scheduled", new Date("2020-01-01T00:00:00Z")));
    const res = await analyzeUserPalpite(null, form());
    expect(res).toMatchObject({ ok: false, kind: "nao-analisavel" });
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("sem modelo: rate-limit NÃO é chamado", async () => {
    mockBase.mockResolvedValue(null);
    const res = await analyzeUserPalpite(null, form());
    expect(res).toEqual({
      ok: false,
      error: "Ainda não temos o modelo deste jogo.",
      kind: "sem-modelo",
    });
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it("rate-limit fail-closed → indisponível, sem extração", async () => {
    mockRateLimit.mockResolvedValue({
      ok: false,
      limit: 0,
      remaining: 0,
      reset: 0,
      reason: "fail-closed",
    });
    expect(await analyzeUserPalpite(null, form())).toEqual({
      ok: false,
      error: ANALYSES_UNAVAILABLE_MESSAGE,
    });
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("limite excedido → limite, sem extração", async () => {
    mockRateLimit.mockResolvedValue({ ok: false, limit: 50, remaining: 0, reset: 0 });
    expect(await analyzeUserPalpite(null, form())).toEqual({
      ok: false,
      error: "Você atingiu o limite de 50 palpites por dia. Tente novamente amanhã.",
      kind: "limite",
    });
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("não-admin cobra fail-closed; admin passa failClosed:false", async () => {
    await analyzeUserPalpite(null, form());
    expect(mockRateLimit).toHaveBeenLastCalledWith("u1", { failClosed: true });
    mockAuth.mockResolvedValue({
      ...USER_SESSION,
      user: { ...USER_SESSION.user, role: "admin" },
    } as Session);
    await analyzeUserPalpite(null, form());
    expect(mockRateLimit).toHaveBeenLastCalledWith("u1", { failClosed: false });
  });
});

describe("analyzeUserPalpite — depois da cobrança", () => {
  it("caminho feliz: grava palpite dos botões, afirmações checadas, versões e ids", async () => {
    const res = await analyzeUserPalpite(null, form());
    expect(res.ok).toBe(true);
    const row = inserted();
    expect(row).toMatchObject({
      userId: "u1",
      matchId: MATCH_ID,
      palpite: { kind: "score", home: 2, away: 0 },
      palpiteSource: "buttons",
      reasonText: "o Palmeiras está sem o Flaco López",
      narrationSource: "llm",
      extractionAiCallId: EXTRACT_CALL,
      narrationAiCallId: NARRATE_CALL,
    });
    expect(row.claims).toHaveLength(1);
    expect(row.claims![0]).toMatchObject({ topic: "absence", status: "unverifiable" });
    expect(row.model!.versions).toEqual({
      matchModel: null,
      judgments: "jev_judgments_v1",
      weights: "judgment_weights_v1",
      snapshotWeights: null,
      userEvidence: "user_evidence_v1",
      verdict: "palpite_verdict_v1",
      extract: "user_palpite_extract_v2",
      narrate: "user_palpite_narrate_v1",
    });
    // Desfalque não verificável do Palmeiras com papel dito pelo usuário: 0.7 no ataque.
    expect(row.model!.userEvidence).toEqual({ attack_weakened_away: 0.7 });
    expect(row.model!.lambdaWith.away).toBeLessThan(row.model!.lambdaWithout.away);
    expect(row.narration!.codeVerdict).toBe(res.ok && res.analysis.verdict);
    // Fatos só por tópico: desfalque pede só a lista de desfalques.
    expect(mockFacts).toHaveBeenCalledWith(expect.objectContaining({ id: MATCH_ID }), {
      absences: true,
      form: false,
      standings: false,
    });
    if (res.ok) {
      expect(res.analysis.changed).toBe(true);
      expect(res.analysis.claims[0].statusLabel).toBe("não verificável");
      expect(res.analysis.warnings).toEqual([]);
    }
  });

  it("a view devolvida usa o nome curto; extração e narração recebem o canonical (#578)", async () => {
    mockMatch.mockResolvedValue({
      ...match(),
      homeTeam: "CR Flamengo",
      awayTeam: "SE Palmeiras",
    } as unknown as Awaited<ReturnType<typeof getMatchById>>);
    const res = await analyzeUserPalpite(null, form());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.analysis.palpiteLabel).toBe("Flamengo 2 × 0 Palmeiras");
    const canonical = { home: "CR Flamengo", away: "SE Palmeiras" };
    expect(mockExtract).toHaveBeenCalledWith(expect.objectContaining({ teams: canonical }));
    const input = mockNarrate.mock.calls[0][0].input;
    expect(input.teams).toEqual(canonical);
    expect(input.palpiteLabel).toBe("CR Flamengo 2 × 0 SE Palmeiras");
  });

  it("o narrador não recebe o motivo cru nem o nome do jogador", async () => {
    await analyzeUserPalpite(null, form());
    const input = mockNarrate.mock.calls[0][0].input;
    expect(JSON.stringify(input)).not.toContain("Flaco");
  });

  it("desfalque sem nome (o placeholder) entra a 0.7 na função, não verificável (#564 review)", async () => {
    mockExtract.mockResolvedValue({
      ok: true,
      claims: [
        { team: "away", topic: "absence", text: "o Palmeiras está sem o artilheiro", role: "attack" },
      ],
      warnings: [],
      aiCallId: EXTRACT_CALL,
    });
    const res = await analyzeUserPalpite(
      null,
      form({ reason: "o Palmeiras está sem o artilheiro" }),
    );
    const row = inserted();
    expect(row.model!.userEvidence).toEqual({ attack_weakened_away: 0.7 });
    expect(row.claims![0]).toMatchObject({
      status: "unverifiable",
      evidence: "Não conseguimos conferir qual jogador; entrou com peso menor.",
    });
    expect(res).toMatchObject({ ok: true, analysis: { changed: true } });
  });

  it("zero afirmações → zero chamadas de fatos", async () => {
    mockExtract.mockResolvedValue({ ok: true, claims: [], warnings: [], aiCallId: null });
    await analyzeUserPalpite(null, form());
    expect(mockFacts).not.toHaveBeenCalled();
    expect(inserted().model!.userEvidence).toEqual({});
  });

  it("extração falha: narração não é chamada, template, aviso e insert feito", async () => {
    mockExtract.mockResolvedValue({ ok: false, message: "timeout", aiCallId: EXTRACT_CALL });
    const res = await analyzeUserPalpite(null, form());
    expect(mockNarrate).not.toHaveBeenCalled();
    expect(mockFacts).not.toHaveBeenCalled();
    const row = inserted();
    expect(row).toMatchObject({
      narrationSource: "template",
      claims: [],
      extractionAiCallId: EXTRACT_CALL,
      narrationAiCallId: null,
    });
    expect(row.narration!.warnings).toEqual([
      "Não consegui ler o seu motivo agora; a leitura abaixo não considera o texto.",
    ]);
    expect(res).toMatchObject({
      ok: true,
      analysis: { narrationSource: "template", changed: false },
    });
  });

  it("insert lança: ainda ok:true, com aviso e log", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockInsert.mockRejectedValue(new Error("db down"));
    const res = await analyzeUserPalpite(null, form());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.analysis.warnings).toContain(
        "Não consegui salvar esta análise; ela some ao recarregar.",
      );
    }
    expect(JSON.parse(consoleError.mock.calls[0][0] as string)).toMatchObject({
      scope: "analyzeUserPalpite",
      error: "insert_failed",
    });
    consoleError.mockRestore();
  });

  it("exceção inesperada depois da cobrança → leitura sem o texto, com aviso e log, sem lançar (#564 review)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockExtract.mockRejectedValue(new Error("extract explodiu"));
    const res = await analyzeUserPalpite(null, form());
    expect(res).toMatchObject({
      ok: true,
      analysis: { narrationSource: "template", changed: false, claims: [] },
    });
    if (res.ok) {
      expect(res.analysis.warnings).toEqual([
        "Não consegui analisar o seu motivo agora; a leitura abaixo não considera o texto.",
        "Não consegui salvar esta análise; ela some ao recarregar.",
      ]);
    }
    expect(mockNarrate).not.toHaveBeenCalled();
    expect(JSON.parse(consoleError.mock.calls[0][0] as string)).toMatchObject({
      scope: "analyzeUserPalpite",
      error: "pipeline_failed",
      message: "extract explodiu",
    });
    consoleError.mockRestore();
  });

  it("fatos lançam depois da extração → também cai na leitura sem o texto", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFacts.mockRejectedValue(new Error("api-football fora"));
    const res = await analyzeUserPalpite(null, form());
    expect(res).toMatchObject({ ok: true, analysis: { narrationSource: "template" } });
    consoleError.mockRestore();
  });

  it("nem a leitura sem o texto sai → ok:false amigável e logado, nunca rejeita", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = new Proxy(
      {},
      {
        get() {
          throw new Error("jev corrompido");
        },
      },
    ) as PalpiteModelBase["jevAnswers"];
    mockBase.mockResolvedValue({ ...BASE, jevAnswers: broken });
    await expect(analyzeUserPalpite(null, form())).resolves.toEqual({
      ok: false,
      error: "Não consegui analisar o seu palpite agora. A leitura pelos botões continua valendo.",
    });
    const errors = consoleError.mock.calls.map((c) => JSON.parse(c[0] as string).error);
    expect(errors).toEqual(["pipeline_failed", "degraded_failed"]);
    consoleError.mockRestore();
  });

  it("veredito do resultado vem do código, não do LLM", async () => {
    mockNarrate.mockImplementation(async () => ({
      narration: { veredito: "discordo", resumo: "x", pontos: [], discordancias: [] },
      source: "llm",
      aiCallId: NARRATE_CALL,
    }));
    const res = await analyzeUserPalpite(
      null,
      form({ palpite: JSON.stringify({ kind: "result", selection: "home" }) }),
    );
    expect(res).toMatchObject({ ok: true, analysis: { verdict: "concordo" } });
  });
});
