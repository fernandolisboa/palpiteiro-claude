import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type {
  NormalizedFixture,
  ProviderCapabilities,
  SportsDataProvider,
} from "@/lib/providers/sports-data/types";
import type {
  AnalysisRequest,
  AnalysisResult,
  AIProvider,
} from "@/lib/ai/providers/types";

// ─── Module mocks (cada boundary que generatePalpites toca) ───────────────────

const matchRow = {
  id: "m-1",
  externalId: "ext-1",
  league: "brasileirao_a" as SupportedLeague,
  homeTeam: "CR Flamengo",
  awayTeam: "Fluminense FC",
  kickoffAt: new Date("2026-05-15T19:00:00.000Z"),
  status: "scheduled" as const,
  homeScore: null,
  awayScore: null,
  updatedAt: new Date("2026-05-01T00:00:00.000Z"),
};

// db stub: select().from().where().limit() → [matchRow]; insert().values().returning()
// → stub rows. insertValues spy compartilhado: [0]=ai_call, [1]=palpite_set, [2..]=linhas.
const insertValues = vi.fn();
const insertTable = vi.fn();
vi.mock("@/lib/db", () => {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve([matchRow])),
      })),
    })),
  }));
  const insert = vi.fn((table: unknown) => {
    insertTable(table);
    return {
      values: (...args: unknown[]) => {
        insertValues(...args);
        return {
          returning: vi.fn(() =>
            Promise.resolve([{ id: "row-1", type: "exact_score" }]),
          ),
        };
      },
    };
  });
  return { db: { select, insert } };
});

const getTeamForm = vi.fn();
const getH2H = vi.fn();
const getStandings = vi.fn();
const getFixtureByMatch = vi.fn();

vi.mock("@/lib/providers/sports-data", () => ({
  getSportsDataProvider: vi.fn((): SportsDataProvider => {
    const capabilities: ProviderCapabilities = {
      name: "mock",
      supportsInjuries: true,
      supportsLineups: true,
      supportsAbsences: true,
      supportedLeagues: new Set<SupportedLeague>(["brasileirao_a"]),
    };
    return {
      capabilities,
      getFixturesByDate: vi.fn() as never,
      getFixturesBySeason: vi.fn() as never,
      getFixtureByMatch: getFixtureByMatch as never,
      getFixtureResult: vi.fn() as never,
      getFixtureEvents: vi.fn() as never,
      getH2H: getH2H as never,
      getStandings: getStandings as never,
      getInjuriesByFixture: vi.fn() as never,
      getInjuriesByTeam: vi.fn() as never,
      getLineups: vi.fn() as never,
      getTeamForm: getTeamForm as never,
    };
  }),
}));

const getGenerationParams = vi.fn();
vi.mock("@/lib/db/queries/ai-config", () => ({
  getGenerationParams: (...args: unknown[]) => getGenerationParams(...args),
}));

// Seam de provider (ADR 0027): mockamos getProviderForModel → runAnalysis capturado.
const runAnalysis = vi.fn();
const hasKey = vi.fn(() => true);
const fakeProvider: AIProvider = {
  providerKey: "anthropic",
  hasKey: () => hasKey(),
  runAnalysis: (req: AnalysisRequest) => runAnalysis(req),
};
vi.mock("@/lib/ai/providers", () => ({
  getProviderForModel: vi.fn(() => fakeProvider),
}));

import { generatePalpites, PalpiteError } from "@/lib/ai/palpites";

function fixture(home: string, away: string, sh: number, sa: number): NormalizedFixture {
  return {
    id: `${home}:${away}`,
    league: "brasileirao_a",
    kickoffAt: "2026-05-10T19:00:00.000Z",
    kickoffTimestampMs: Date.parse("2026-05-10T19:00:00.000Z"),
    homeTeam: home,
    awayTeam: away,
    status: "finished",
    score: { home: sh, away: sa },
  };
}

const validToolInput = {
  palpites: [
    { type: "exact_score", text: "2 a 1 pro Fla", params: { home: 2, away: 1 } },
    { type: "red_card", text: "Clássico pega fogo!" },
    { type: "corners", text: "Vai chover escanteio." },
  ],
};

function okResult(toolInput: unknown): AnalysisResult {
  return {
    ok: true,
    toolInput,
    usage: { inputTokens: 100, outputTokens: 50 },
    inputPayload: { foo: "bar" },
    outputPayload: { content: [] },
    stopReason: "tool_use",
    latencyMs: 42,
  };
}

beforeEach(() => {
  insertValues.mockReset();
  insertTable.mockReset();
  runAnalysis.mockReset();
  hasKey.mockReset();
  hasKey.mockReturnValue(true);
  getFixtureByMatch.mockResolvedValue({
    ...fixture("CR Flamengo", "Fluminense FC", 0, 0),
    venue: "Maracanã",
  });
  getTeamForm.mockResolvedValue([fixture("CR Flamengo", "X", 2, 0)]);
  getH2H.mockResolvedValue([fixture("CR Flamengo", "Fluminense FC", 1, 1)]);
  getStandings.mockResolvedValue({
    league: "brasileirao_a",
    season: 2026,
    tables: [{ teams: [] }],
  });
  getGenerationParams.mockResolvedValue({
    maxTokens: 16000,
    effort: "high",
    temperature: 0.3,
  });
});

const baseCall = {
  matchId: "m-1",
  userId: "u-1",
  previousSets: [],
  modelOverride: "claude-haiku-4-5" as const,
};

describe("generatePalpites — caminho ok", () => {
  it("loga ai_call(ok) → palpite_set → linhas com settleable derivado", async () => {
    runAnalysis.mockResolvedValue(okResult(validToolInput));
    const res = await generatePalpites(baseCall);

    // Sequência de inserts: ai_calls, palpite_sets, palpites x3.
    const aiCallRow = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(aiCallRow.status).toBe("ok");
    expect(aiCallRow.model).toBe("claude-haiku-4-5");
    expect(aiCallRow.promptVersion).toBe("palpites_v1");

    const setRow = insertValues.mock.calls[1][0] as Record<string, unknown>;
    expect(setRow.modelVersion).toBe("claude-haiku-4-5");
    expect(setRow.promptVersion).toBe("palpites_v1");
    expect(setRow.aiCallId).toBe("row-1");

    // Linhas: exact_score settleable=true; fun settleable=false.
    const line0 = insertValues.mock.calls[2][0] as Record<string, unknown>;
    const line1 = insertValues.mock.calls[3][0] as Record<string, unknown>;
    const line2 = insertValues.mock.calls[4][0] as Record<string, unknown>;
    expect(line0.type).toBe("exact_score");
    expect(line0.settleable).toBe(true);
    expect(line0.params).toEqual({ home: 2, away: 1 });
    expect(line1.type).toBe("red_card");
    expect(line1.settleable).toBe(false);
    expect(line1.params).toBeNull();
    expect(line2.settleable).toBe(false);

    expect(res.aiCall).toEqual({ id: "row-1" });
    expect(res.palpites).toHaveLength(3);
  });

  it("golden payload: a AnalysisRequest leva temperature 0.3 (de model.temperature)", async () => {
    runAnalysis.mockResolvedValue(okResult(validToolInput));
    await generatePalpites(baseCall);
    const req = runAnalysis.mock.calls[0][0] as AnalysisRequest;
    expect(req.temperature).toBe(0.3);
    // Haiku é temperature-mode: effort NÃO é passado.
    expect(req.effort).toBeUndefined();
    expect(req.toolName).toBe("submit_palpites");
    expect(req.maxTokens).toBe(16000);
  });

  it("exclusão: previousSets não-vazio injeta os placares prévios no userMessage", async () => {
    runAnalysis.mockResolvedValue(okResult(validToolInput));
    const previousSets = [
      {
        palpiteSet: {
          id: "s-prev",
          matchId: "m-1",
          userId: "u-1",
          aiCallId: null,
          modelVersion: "claude-haiku-4-5",
          promptVersion: "palpites_v1",
          createdAt: new Date(),
        },
        aiCall: null,
        palpites: [
          {
            id: "x",
            palpiteSetId: "s-prev",
            type: "exact_score" as const,
            text: "3 a 0",
            params: { home: 3, away: 0 },
            settleable: true,
            createdAt: new Date(),
            outcome: null,
          },
        ],
      },
    ];
    await generatePalpites({ ...baseCall, previousSets });
    const req = runAnalysis.mock.calls[0][0] as AnalysisRequest;
    expect(req.userMessage).toContain("Não repita");
    expect(req.userMessage).toContain("3-0");
  });
});

describe("generatePalpites — caminhos de erro (auditados, sem set)", () => {
  it("hasKey()===false → provider_error, throw, zero runAnalysis", async () => {
    hasKey.mockReturnValue(false);
    await expect(generatePalpites(baseCall)).rejects.toBeInstanceOf(PalpiteError);
    expect(runAnalysis).not.toHaveBeenCalled();
    // ai_call de erro foi logado (provider_error).
    const row = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.status).toBe("provider_error");
    // Nenhum palpite_set inserido.
    expect(
      insertValues.mock.calls.some(
        (c) => (c[0] as { modelVersion?: string }).modelVersion !== undefined,
      ),
    ).toBe(false);
  });

  it("tool_missing → status tool_missing, throw, sem set", async () => {
    runAnalysis.mockResolvedValue(okResult(undefined));
    await expect(generatePalpites(baseCall)).rejects.toBeInstanceOf(PalpiteError);
    const row = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.status).toBe("tool_missing");
  });

  it("output inválido → invalid_output, throw, sem set", async () => {
    runAnalysis.mockResolvedValue(
      okResult({ palpites: [{ type: "exact_score", text: "x" }] }), // params faltando
    );
    await expect(generatePalpites(baseCall)).rejects.toBeInstanceOf(PalpiteError);
    const row = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.status).toBe("invalid_output");
    // Nenhum palpite_set.
    expect(
      insertValues.mock.calls.some(
        (c) => (c[0] as { modelVersion?: string }).modelVersion !== undefined,
      ),
    ).toBe(false);
  });

  it("provider !ok → loga o status do provider + throw", async () => {
    runAnalysis.mockResolvedValue({
      ok: false,
      status: "timeout",
      message: "timed out",
      usage: { inputTokens: 0, outputTokens: 0 },
      inputPayload: {},
      outputPayload: {},
      stopReason: null,
      latencyMs: 10,
    } satisfies AnalysisResult);
    await expect(generatePalpites(baseCall)).rejects.toBeInstanceOf(PalpiteError);
    const row = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.status).toBe("timeout");
  });

  it("jogo encerrado → throw 'match is not analyzable', sem chamada ao provider", async () => {
    // Re-mock o db pra devolver um match finished neste teste.
    const finished = { ...matchRow, status: "finished" as const };
    const { db } = await import("@/lib/db");
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([finished])),
        })),
      })),
    } as never);
    await expect(generatePalpites(baseCall)).rejects.toThrow(
      "match is not analyzable",
    );
    expect(runAnalysis).not.toHaveBeenCalled();
  });
});
