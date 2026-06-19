import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MarketAnalysisSummary } from "@/lib/ai/palpites/synthesis-input";
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
// → stub rows. insertValues spy compartilhado: [0]=ai_call, [1]=palpite_set, [2]=linha.
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

function analysis(over: Partial<MarketAnalysisSummary> = {}): MarketAnalysisSummary {
  return {
    marketKey: "match_result",
    marketLabel: "Resultado (1X2)",
    recommendation: "home",
    recommendedLabel: "Casa",
    isPass: false,
    modelProbPct: 58,
    edgePct: 9,
    confidencePct: 60,
    oddAtRecommendation: 1.85,
    rationale: "Mandante superior.",
    predictionId: "pred-1",
    selections: [
      { key: "home", modelProbPct: 58 },
      { key: "draw", modelProbPct: 24 },
      { key: "away", modelProbPct: 18 },
    ],
    ...over,
  };
}

const validHeadline = {
  verdict: "Vai dar Flamengo",
  probableScore: { home: 2, away: 1 },
  confidence: "alta",
  narrative: "O Fla vem voando em casa e o Flu sofre fora.",
  citedMarkets: ["Resultado (1X2)"],
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
  analyses: [analysis()],
  modelOverride: "claude-haiku-4-5" as const,
};

describe("generatePalpites (síntese) — caminho ok", () => {
  it("loga ai_call(ok) → palpite_set com headline → 1 linha exact_score settleable", async () => {
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    const res = await generatePalpites(baseCall);

    // Sequência de inserts: ai_calls, palpite_sets, palpites (1).
    const aiCallRow = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(aiCallRow.status).toBe("ok");
    expect(aiCallRow.model).toBe("claude-haiku-4-5");
    expect(aiCallRow.promptVersion).toBe("palpites_v2");

    const setRow = insertValues.mock.calls[1][0] as Record<string, unknown>;
    expect(setRow.modelVersion).toBe("claude-haiku-4-5");
    expect(setRow.promptVersion).toBe("palpites_v2");
    expect(setRow.aiCallId).toBe("row-1");
    // headline jsonb: a manchete SEM placar (vira a linha) e SEM número de valor.
    expect(setRow.headline).toEqual({
      verdict: "Vai dar Flamengo",
      confidence: "alta",
      narrative: "O Fla vem voando em casa e o Flu sofre fora.",
      citedMarkets: ["Resultado (1X2)"],
      sourcePredictionIds: ["pred-1"],
    });

    // UMA linha settleable exact_score com o placar provável.
    const line = insertValues.mock.calls[2][0] as Record<string, unknown>;
    expect(line.type).toBe("exact_score");
    expect(line.settleable).toBe(true);
    expect(line.params).toEqual({ home: 2, away: 1 });
    // Só 3 inserts no total (ai_call + set + 1 linha) — nada de red_card/corners.
    expect(insertValues.mock.calls).toHaveLength(3);

    expect(res.aiCall).toEqual({ id: "row-1" });
    expect(res.palpites).toHaveLength(1);
  });

  it("o input do LLM carrega as análises (edge/odd como DADO) + sem value-language no output", async () => {
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    await generatePalpites(baseCall);
    const req = runAnalysis.mock.calls[0][0] as AnalysisRequest;
    expect(req.userMessage).toContain("Análises por mercado");
    expect(req.userMessage).toContain("Resultado (1X2)");
    // O OUTPUT persistido (headline + text) não contém termo de valor.
    const setRow = insertValues.mock.calls[1][0] as Record<string, unknown>;
    const headline = setRow.headline as { verdict: string; narrative: string };
    const serialized = `${headline.verdict} ${headline.narrative}`.toLowerCase();
    for (const term of ["edge", "stake", "yield", "odd", "r$"]) {
      expect(serialized).not.toContain(term);
    }
  });

  it("golden payload: a AnalysisRequest leva temperature 0.3 e o tool submit_palpite", async () => {
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    await generatePalpites(baseCall);
    const req = runAnalysis.mock.calls[0][0] as AnalysisRequest;
    expect(req.temperature).toBe(0.3);
    expect(req.effort).toBeUndefined();
    expect(req.toolName).toBe("submit_palpite");
    expect(req.maxTokens).toBe(16000);
  });

  it("all-pass: análises todas pass ainda sintetizam manchete + linha settleable", async () => {
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    const passOnly = [
      analysis({
        isPass: true,
        recommendation: "pass",
        recommendedLabel: null,
        edgePct: null,
        oddAtRecommendation: null,
        modelProbPct: null,
        predictionId: "pred-pass",
      }),
    ];
    await generatePalpites({ ...baseCall, analyses: passOnly });
    const req = runAnalysis.mock.calls[0][0] as AnalysisRequest;
    expect(req.userMessage).toContain("sem valor recomendado (pass)");
    // Ainda grava set + linha settleable (síntese honesta no all-pass).
    const line = insertValues.mock.calls[2][0] as Record<string, unknown>;
    expect(line.type).toBe("exact_score");
    expect(line.settleable).toBe(true);
  });
});

describe("generatePalpites (síntese) — firewall de value-language (blocker #5)", () => {
  it("verdict com 'odd' → invalid_output, throw, sem set", async () => {
    runAnalysis.mockResolvedValue(
      okResult({ ...validHeadline, verdict: "Aposta no Fla, odd boa" }),
    );
    await expect(generatePalpites(baseCall)).rejects.toBeInstanceOf(PalpiteError);
    const row = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.status).toBe("invalid_output");
    // Nenhum palpite_set escrito.
    expect(
      insertValues.mock.calls.some(
        (c) => (c[0] as { modelVersion?: string }).modelVersion !== undefined,
      ),
    ).toBe(false);
  });

  it("narrative com 'edge'/'stake' → invalid_output, throw", async () => {
    runAnalysis.mockResolvedValue(
      okResult({
        ...validHeadline,
        narrative: "Tem edge claro e vale a stake no over.",
      }),
    );
    await expect(generatePalpites(baseCall)).rejects.toBeInstanceOf(PalpiteError);
    const row = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.status).toBe("invalid_output");
  });
});

describe("generatePalpites (síntese) — caminhos de erro (auditados, sem set)", () => {
  it("hasKey()===false → provider_error, throw, zero runAnalysis", async () => {
    hasKey.mockReturnValue(false);
    await expect(generatePalpites(baseCall)).rejects.toBeInstanceOf(PalpiteError);
    expect(runAnalysis).not.toHaveBeenCalled();
    const row = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.status).toBe("provider_error");
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

  it("output inválido (placar faltando) → invalid_output, throw, sem set", async () => {
    runAnalysis.mockResolvedValue(
      okResult({ verdict: "x", confidence: "alta", narrative: "y", citedMarkets: [] }),
    );
    await expect(generatePalpites(baseCall)).rejects.toBeInstanceOf(PalpiteError);
    const row = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.status).toBe("invalid_output");
    expect(
      insertValues.mock.calls.some(
        (c) => (c[0] as { modelVersion?: string }).modelVersion !== undefined,
      ),
    ).toBe(false);
  });

  it("chave de valor parasita no output (.strict) → invalid_output, throw", async () => {
    runAnalysis.mockResolvedValue(
      okResult({ ...validHeadline, edgePct: 8 }),
    );
    await expect(generatePalpites(baseCall)).rejects.toBeInstanceOf(PalpiteError);
    const row = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.status).toBe("invalid_output");
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
