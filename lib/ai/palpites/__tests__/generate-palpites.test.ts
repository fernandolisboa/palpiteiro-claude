import { beforeEach, describe, expect, it, vi } from "vitest";

import { MODEL_REGISTRY, type AIModel } from "@/lib/ai/models";

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
// #380 — getEnableFidelityValidation precisa estar no mock (senão a chamada nova vira
// undefined()→throw em TODO teste). Default ON (true) — exercita o validador no happy path.
const getEnableFidelityValidation = vi.fn();
vi.mock("@/lib/db/queries/ai-config", () => ({
  getGenerationParams: (...args: unknown[]) => getGenerationParams(...args),
  getEnableFidelityValidation: (...args: unknown[]) =>
    getEnableFidelityValidation(...args),
  // Lote guardado das notícias (#672) desligado: o caminho ao vivo de sempre.
  getEnableNewsFactors: async () => false,
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

// Provider de notícias (ADR 0032 / #377): mockado no seam. Default = sem notícia
// (degrade gracioso). Casos específicos sobrescrevem `getNewsByMatch`.
const getNewsByMatch = vi.fn();
vi.mock("@/lib/providers/news", () => ({
  getNewsProvider: vi.fn(() => ({ getNewsByMatch })),
}));

// Base do modelo por jogo (#649): fonte da confiança do palpite. Default = sem base.
const getLatestMatchModelSnapshot = vi.fn();
vi.mock("@/lib/db/queries/match-model-snapshots", () => ({
  getLatestMatchModelSnapshot: (...args: unknown[]) =>
    getLatestMatchModelSnapshot(...args),
}));

import {
  generatePalpites,
  newsVerdict,
  PalpiteError,
  startNewsFetch,
} from "@/lib/ai/palpites";
import { STEP_NOTES } from "@/lib/ai/progress/steps";
import {
  NEWS_MIN_BUDGET_MS,
  SYNTHESIS_CALL_RESERVE_MS,
} from "@/lib/ai/deadline";

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
  firstHalfScore: { home: 1, away: 0 },
  firstToScore: "home",
  narrative: "O Fla vem voando em casa e o Flu sofre fora.",
  citedMarkets: ["Resultado (1X2)"],
};

function okResult(toolInput: unknown): AnalysisResult {
  return {
    ok: true,
    toolInput,
    usage: {
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
    inputPayload: { foo: "bar" },
    outputPayload: { content: [] },
    stopReason: "tool_use",
    latencyMs: 42,
    servedModel: MODEL_REGISTRY["claude-haiku-5-5"],
  };
}

beforeEach(() => {
  getLatestMatchModelSnapshot.mockReset();
  getLatestMatchModelSnapshot.mockResolvedValue(null);
  insertValues.mockReset();
  insertTable.mockReset();
  runAnalysis.mockReset();
  hasKey.mockReset();
  hasKey.mockReturnValue(true);
  getNewsByMatch.mockReset();
  // Default: provider de notícias inerte (sem notícia). Degrade gracioso é o normal.
  getNewsByMatch.mockResolvedValue({
    results: [],
    aiCall: null,
    status: "failed",
    via: null,
  });
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
  });
  // #380 — default ON (espelha a coluna default true). Casos flag-OFF sobrescrevem.
  getEnableFidelityValidation.mockReset();
  getEnableFidelityValidation.mockResolvedValue(true);
});

const baseCall = {
  matchId: "m-1",
  userId: "u-1",
  analyses: [analysis()],
  modelOverride: "claude-haiku-5-5" as const,
  // A action resolve o nome de exibição (lib/view/team) e passa pronto (#668).
  displayTeams: { home: "Flamengo", away: "Fluminense" },
};

describe("generatePalpites (síntese) — prazo do run (#524 re-review)", () => {
  it("sem tempo pra uma chamada → lança ANTES do provider, sem row em ai_calls", async () => {
    await expect(
      generatePalpites({ ...baseCall, deadlineAt: Date.now() + 5_000 }),
    ).rejects.toThrow("analysis deadline exceeded");
    expect(runAnalysis).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("com tempo → segue e repassa o prazo na request", async () => {
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    const deadlineAt = Date.now() + 60_000;
    await generatePalpites({ ...baseCall, deadlineAt });
    const req = runAnalysis.mock.calls[0][0] as AnalysisRequest;
    expect(req.deadlineAt).toBe(deadlineAt);
  });

  it("a busca de notícias termina antes, guardando o tempo da manchete", async () => {
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    const deadlineAt = Date.now() + 60_000;
    await generatePalpites({ ...baseCall, deadlineAt });
    expect(getNewsByMatch).toHaveBeenCalledTimes(1);
    expect(getNewsByMatch.mock.calls[0][2]).toEqual({
      deadlineAt: deadlineAt - SYNTHESIS_CALL_RESERVE_MS,
    });
  });

  it("busca que usa o prazo inteiro ainda deixa a manchete caber", async () => {
    const start = 1_000_000;
    let clock = start;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => clock);
    try {
      const deadlineAt = start + SYNTHESIS_CALL_RESERVE_MS + NEWS_MIN_BUDGET_MS;
      getNewsByMatch.mockImplementation(async (_ctx, _audit, opts) => {
        // A busca roda até o próprio prazo (o timeout da request corta aqui).
        clock = opts.deadlineAt;
        return { results: [], aiCall: null, status: "none", via: "ge" };
      });
      runAnalysis.mockResolvedValue(okResult(validHeadline));
      const res = await generatePalpites({ ...baseCall, deadlineAt });
      expect(runAnalysis).toHaveBeenCalledTimes(1);
      expect((runAnalysis.mock.calls[0][0] as AnalysisRequest).deadlineAt).toBe(
        deadlineAt,
      );
      expect(res.palpiteSet).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });

  it("notícia lenta não mata a manchete: sem tempo pra busca, pula e o palpite sai", async () => {
    // Regressão: a busca rodava sem prazo e, num run apertado, comia a reserva inteira;
    // a manchete lançava AnalysisDeadlineError e o HERO voltava vazio.
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    const res = await generatePalpites({
      ...baseCall,
      deadlineAt: Date.now() + SYNTHESIS_CALL_RESERVE_MS + NEWS_MIN_BUDGET_MS - 1_000,
    });
    expect(getNewsByMatch).not.toHaveBeenCalled();
    expect(runAnalysis).toHaveBeenCalledTimes(1);
    expect(res.palpiteSet).toBeDefined();
  });
});

describe("generatePalpites (síntese) — notícias já disparadas pelo run", () => {
  it("usa a busca recebida e não busca de novo", async () => {
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    const news = Promise.resolve({
      results: [],
      aiCall: { id: "ac-news" },
      status: "none" as const,
      via: "web_search" as const,
    });
    const res = await generatePalpites({ ...baseCall, news });
    expect(getNewsByMatch).not.toHaveBeenCalled();
    expect(res.palpiteSet).toBeDefined();
  });

  it("startNewsFetch nunca rejeita: falha do provider vira 'sem notícias'", async () => {
    getNewsByMatch.mockRejectedValue(new Error("web search caiu"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        startNewsFetch(
          {
            league: "brasileirao_a",
            homeTeam: "A",
            awayTeam: "B",
            kickoffAt: new Date("2099-01-01T00:00:00Z"),
          },
          { userId: "u-1", matchId: "m-1" },
          undefined,
        ),
      ).resolves.toEqual({ results: [], aiCall: null, status: "failed", via: null });
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe("generatePalpites (síntese) — modelo que serviu (PLAN-608)", () => {
  const ADOPTED: AIModel = {
    ...MODEL_REGISTRY["claude-haiku-5-5"],
    id: "claude-haiku-5-6",
    inputPricePerMTok: 1,
    outputPricePerMTok: 2,
    longPromptPricing: undefined,
    adopted: { priceEstimated: true, pinnedId: "claude-haiku-5-5" },
  };

  it("ok: ai_calls.model, custo e palpite_sets.modelVersion usam o servido", async () => {
    runAnalysis.mockResolvedValue({ ...okResult(validHeadline), servedModel: ADOPTED });
    await generatePalpites(baseCall);

    expect((runAnalysis.mock.calls[0][0] as AnalysisRequest).model.id).toBe(
      "claude-haiku-5-5",
    );
    const aiCallRow = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(aiCallRow.model).toBe("claude-haiku-5-6");
    // 100 × $1 + 50 × $2 por 1M
    expect(aiCallRow.costUsd).toBe(((100 * 1 + 50 * 2) / 1_000_000).toFixed(6));
    const setRow = insertValues.mock.calls[1][0] as Record<string, unknown>;
    expect(setRow.modelVersion).toBe("claude-haiku-5-6");
  });

  it("Zod falha: a row invalid_output leva o servido", async () => {
    runAnalysis.mockResolvedValue({
      ...okResult({ ...validHeadline, edgePct: 8 }),
      servedModel: ADOPTED,
    });
    await expect(generatePalpites(baseCall)).rejects.toBeInstanceOf(PalpiteError);
    const row = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(row.status).toBe("invalid_output");
    expect(row.model).toBe("claude-haiku-5-6");
  });
});

describe("generatePalpites (síntese) — caminho ok", () => {
  it("loga ai_call(ok) → palpite_set com headline → linhas settleable em BATCH (#354)", async () => {
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    const res = await generatePalpites(baseCall);

    // Sequência de inserts: ai_calls, palpite_sets, palpites (UM batch).
    const aiCallRow = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(aiCallRow.status).toBe("ok");
    expect(aiCallRow.model).toBe("claude-haiku-5-5");
    expect(aiCallRow.promptVersion).toBe("palpites_v13");

    const setRow = insertValues.mock.calls[1][0] as Record<string, unknown>;
    expect(setRow.modelVersion).toBe("claude-haiku-5-5");
    expect(setRow.promptVersion).toBe("palpites_v13");
    expect(setRow.aiCallId).toBe("row-1");
    // headline jsonb: a manchete SEM placar (vira a linha) e SEM número de valor.
    expect(setRow.headline).toEqual({
      verdict: "Vai dar Flamengo",
      // Sem base do modelo e a análise de 1X2 não é do code_jev: sem confiança (#649).
      confidence: null,
      confidenceProbPct: null,
      confidenceSource: "none",
      narrative: "O Fla vem voando em casa e o Flu sofre fora.",
      citedMarkets: ["Resultado (1X2)"],
      sourcePredictionIds: ["pred-1"],
    });

    // As linhas vêm num ÚNICO insert em batch (array). validHeadline (2-1, HT 1-0,
    // home 1º): exact_score + first_half_score + first_to_score (margin pula <2;
    // clean_sheet pula — away marcou).
    const rows = insertValues.mock.calls[2][0] as Record<string, unknown>[];
    expect(Array.isArray(rows)).toBe(true);
    const exact = rows.find((r) => r.type === "exact_score")!;
    expect(exact.settleable).toBe(true);
    expect(exact.params).toEqual({ home: 2, away: 1 });
    const types = rows.map((r) => r.type);
    expect(types).toContain("exact_score");
    expect(types).toContain("first_half_score");
    expect(types).toContain("first_to_score");
    expect(types).not.toContain("margin");
    expect(types).not.toContain("clean_sheet");
    expect(types).not.toContain("red_card");
    // 3 inserts no total (ai_call + set + batch de linhas).
    expect(insertValues.mock.calls).toHaveLength(3);

    expect(res.aiCall).toEqual({ id: "row-1" });
    // res.palpites é o retorno do batch (o mock devolve 1 row stub).
    expect(res.palpites.length).toBeGreaterThanOrEqual(1);
  });

  it("#379: SEM custo de LLM extra — fatos pré-contados em buildPredictionInput (síntese = 1 chamada ao provider) + input carrega os fatos", async () => {
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    await generatePalpites(baseCall);
    // Os fatos estruturados (H2H + placares) são montados num builder PURO — nenhuma
    // chamada nova ao provider de LLM. A síntese segue sendo EXATAMENTE 1 chamada.
    expect(runAnalysis.mock.calls).toHaveLength(1);
    // E o input carrega os fatos pré-contados (tally do H2H + placares contados).
    const req = runAnalysis.mock.calls[0][0] as AnalysisRequest;
    expect(req.userMessage).toContain("mandante do jogo");
    expect(req.userMessage).toContain("placares contados");
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

  it("golden payload: a AnalysisRequest leva effort UTILITY_EFFORT (low, não o do ai_config), sem temperature, e o tool submit_palpite", async () => {
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    await generatePalpites(baseCall);
    const req = runAnalysis.mock.calls[0][0] as AnalysisRequest;
    expect(req.effort).toBe("low");
    expect("temperature" in req).toBe(false);
    expect(req.model.id).toBe("claude-haiku-5-5");
    expect(req.toolName).toBe("submit_palpite");
    expect(req.maxTokens).toBe(16000);
  });

  it("max_tokens baixo do admin: a manchete leva o piso de 8192 (o thinking conta dentro)", async () => {
    getGenerationParams.mockResolvedValue({ maxTokens: 1024, effort: "high" });
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    await generatePalpites(baseCall);
    const req = runAnalysis.mock.calls[0][0] as AnalysisRequest;
    expect(req.maxTokens).toBe(8192);
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
    // Ainda grava set + linhas settleable (síntese honesta no all-pass).
    const rows = insertValues.mock.calls[2][0] as Record<string, unknown>[];
    const exact = rows.find((r) => r.type === "exact_score")!;
    expect(exact.type).toBe("exact_score");
    expect(exact.settleable).toBe(true);
  });
});

describe("generatePalpites (síntese) — confiança pelo motor (#649)", () => {
  const headlineOf = () =>
    (insertValues.mock.calls[1][0] as { headline: Record<string, unknown> }).headline;
  const snapshot = (home: number, draw: number, away: number) => ({
    probabilities: { match_result: { home, draw, away } },
  });

  it("base do modelo primeiro: P do resultado do placar provável (2–1 → casa)", async () => {
    getLatestMatchModelSnapshot.mockResolvedValue(snapshot(56.2, 25, 18.8));
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    await generatePalpites({
      ...baseCall,
      analyses: [analysis({ engine: "code_jev" })],
    });
    expect(getLatestMatchModelSnapshot).toHaveBeenCalledWith("m-1");
    expect(headlineOf()).toMatchObject({
      confidence: "alta",
      confidenceProbPct: 56.2,
      confidenceSource: "snapshot",
    });
  });

  it("zebra (1–2) com a base dando 30% ao visitante → baixa", async () => {
    getLatestMatchModelSnapshot.mockResolvedValue(snapshot(45, 25, 30));
    runAnalysis.mockResolvedValue(
      okResult({
        ...validHeadline,
        probableScore: { home: 1, away: 2 },
        firstHalfScore: { home: 0, away: 1 },
        firstToScore: "away",
      }),
    );
    await generatePalpites(baseCall);
    expect(headlineOf()).toMatchObject({
      confidence: "baixa",
      confidenceProbPct: 30,
      confidenceSource: "snapshot",
    });
  });

  it("sem base: usa a análise de 1X2 do code_jev do run", async () => {
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    await generatePalpites({
      ...baseCall,
      analyses: [analysis({ engine: "code_jev" })],
    });
    expect(headlineOf()).toMatchObject({
      confidence: "alta",
      confidenceProbPct: 58,
      confidenceSource: "analysis",
    });
  });

  it("análise do motor LLM não serve de fonte: sem chip", async () => {
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    await generatePalpites({
      ...baseCall,
      analyses: [analysis({ engine: "llm" })],
    });
    expect(headlineOf()).toMatchObject({
      confidence: null,
      confidenceProbPct: null,
      confidenceSource: "none",
    });
  });

  it("leitura da base falha: não derruba a síntese, cai na análise", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getLatestMatchModelSnapshot.mockRejectedValue(new Error("db down"));
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    await generatePalpites({
      ...baseCall,
      analyses: [analysis({ engine: "code_jev" })],
    });
    expect(headlineOf()).toMatchObject({ confidenceSource: "analysis" });
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

  it("citedMarkets com 'edge' → invalid_output, throw, sem set (rótulo cruza pra view)", async () => {
    runAnalysis.mockResolvedValue(
      okResult({ ...validHeadline, citedMarkets: ["Resultado", "Over com edge"] }),
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
});

describe("generatePalpites (síntese) — validação de fidelidade (#380)", () => {
  // Facts mockados (beforeEach): getH2H = 1 fixture → h2hSummary.gamesConsidered = 1.
  // Uma manchete citando "Em 3 confrontos" CONTRADIZ o fato pré-contado (3 ≠ 1).
  const divergentHeadline = {
    ...validHeadline,
    narrative: "Em 3 confrontos diretos o Fla sempre venceu.",
  };

  it("flag OFF → validação pulada: manchete count-divergente (mas firewall-limpa) ainda embarca (comportamento de hoje)", async () => {
    getEnableFidelityValidation.mockResolvedValue(false);
    runAnalysis.mockResolvedValue(okResult(divergentHeadline));

    const res = await generatePalpites(baseCall);
    // 1 chamada ao provider (sem regen), set persistido (ai_call ok + set + linhas).
    expect(runAnalysis.mock.calls).toHaveLength(1);
    const aiCallRow = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(aiCallRow.status).toBe("ok");
    const setRow = insertValues.mock.calls[1][0] as Record<string, unknown>;
    expect(setRow.modelVersion).toBe("claude-haiku-5-5");
    expect(res.palpiteSet).toBeDefined();
  });

  it("flag ON + divergência (MAX=1) → degrada: throw, ai_call fidelity_divergence, sem set", async () => {
    getEnableFidelityValidation.mockResolvedValue(true);
    runAnalysis.mockResolvedValue(okResult(divergentHeadline));

    await expect(generatePalpites(baseCall)).rejects.toBeInstanceOf(PalpiteError);
    // MAX=1: degrada na hora, SEM 2ª síntese paga.
    expect(runAnalysis.mock.calls).toHaveLength(1);
    // A tentativa paga divergente foi logada em ai_calls como auditoria (não chamada de LLM).
    const aiCallRow = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(aiCallRow.status).toBe("fidelity_divergence");
    expect(String(aiCallRow.errorMessage)).toContain("h2h.gamesConsidered");
    // Nenhum palpite_set escrito (degradou pra null).
    expect(
      insertValues.mock.calls.some(
        (c) => (c[0] as { modelVersion?: string }).modelVersion !== undefined,
      ),
    ).toBe(false);
  });

  it("flag ON + manchete fiel (sem contagem citada) → aceita normalmente (caminho comum, custo zero)", async () => {
    getEnableFidelityValidation.mockResolvedValue(true);
    runAnalysis.mockResolvedValue(okResult(validHeadline));

    const res = await generatePalpites(baseCall);
    expect(runAnalysis.mock.calls).toHaveLength(1);
    const aiCallRow = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(aiCallRow.status).toBe("ok");
    expect(res.palpiteSet).toBeDefined();
  });

  it("FIREWALL roda ANTES da fidelidade (dentro do loop): value-leak → invalid_output, nunca fidelity_divergence", async () => {
    // Manchete que é AO MESMO TEMPO divergente (confrontos) E vaza valor ("odd"). O
    // firewall deve pegá-la primeiro (invalid_output), provando que o guard roda dentro
    // do loop ANTES do validador de fidelidade — fidelidade só ADICIONA rejeição.
    getEnableFidelityValidation.mockResolvedValue(true);
    runAnalysis.mockResolvedValue(
      okResult({
        ...divergentHeadline,
        verdict: "Em 3 confrontos, odd boa no Fla",
      }),
    );
    await expect(generatePalpites(baseCall)).rejects.toBeInstanceOf(PalpiteError);
    const aiCallRow = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(aiCallRow.status).toBe("invalid_output");
    expect(aiCallRow.status).not.toBe("fidelity_divergence");
  });
});

describe("generatePalpites (síntese) — notícias (#377 / ADR 0032)", () => {
  const newsSources = [
    { title: "Flamengo perde titular por lesão", url: "https://ge.globo.com/x" },
    { title: "Fluminense confirma escalação", url: "https://lance.com.br/y" },
  ];

  it("alimenta o userMessage com as notícias E persiste headline.sources", async () => {
    getNewsByMatch.mockResolvedValue({
      results: newsSources,
      aiCall: { id: "news-1" },
      status: "found",
      via: "web_search",
    });
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    await generatePalpites(baseCall);

    // O input do LLM carrega a seção de notícias + o título real da fonte.
    const req = runAnalysis.mock.calls[0][0] as AnalysisRequest;
    expect(req.userMessage).toContain("Notícias recentes");
    expect(req.userMessage).toContain("Flamengo perde titular por lesão");

    // A headline persiste as fontes capturadas {title,url}.
    const setRow = insertValues.mock.calls[1][0] as Record<string, unknown>;
    const headline = setRow.headline as { sources?: unknown };
    expect(headline.sources).toEqual(newsSources);
  });

  it("sem notícia (degrade gracioso) → headline SEM sources; palpite ainda embarca", async () => {
    getNewsByMatch.mockResolvedValue({ results: [], aiCall: null, status: "failed", via: null });
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    const res = await generatePalpites(baseCall);
    const setRow = insertValues.mock.calls[1][0] as Record<string, unknown>;
    const headline = setRow.headline as Record<string, unknown>;
    expect(headline.sources).toBeUndefined();
    // O set ainda foi gravado (notícia nunca bloqueia a manchete).
    expect(setRow.modelVersion).toBe("claude-haiku-5-5");
    expect(res.palpiteSet).toBeDefined();
  });

  it("FIREWALL-REGRESSION: termo de valor numa NOTÍCIA não derruba a síntese NEM vaza pra manchete", async () => {
    // Um título com "odd" sai na ENTRADA (o modelo nem o vê) e, por isso, também não
    // persiste. O output limpo (validHeadline) segue; se o LLM ECOASSE "odd", o guard
    // de saída ainda pegaria (testes de firewall acima).
    getNewsByMatch.mockResolvedValue({
      results: [
        { title: "Palmeiras com odd alta no mercado", url: "https://ge.globo.com/odd" },
        { title: "Flamengo confirma retorno de Arrascaeta", url: "https://ge.globo.com/volta" },
      ],
      aiCall: { id: "news-2" },
      status: "found",
      via: "web_search",
    });
    runAnalysis.mockResolvedValue(okResult(validHeadline));

    const res = await generatePalpites(baseCall);
    expect(res.palpiteSet).toBeDefined();

    const req = runAnalysis.mock.calls[0][0] as AnalysisRequest;
    expect(req.userMessage).not.toContain("odd alta");
    expect(req.userMessage).toContain("retorno de Arrascaeta");

    const setRow = insertValues.mock.calls[1][0] as Record<string, unknown>;
    const headline = setRow.headline as {
      verdict: string;
      narrative: string;
      sources?: Array<{ title: string; url: string }>;
    };
    expect(headline.sources).toEqual([
      { title: "Flamengo confirma retorno de Arrascaeta", url: "https://ge.globo.com/volta" },
    ]);
    const serialized = `${headline.verdict} ${headline.narrative}`.toLowerCase();
    expect(serialized).not.toContain("odd");

    const aiCallRow = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(aiCallRow.status).toBe("ok");
  });

  it("persiste EXATAMENTE a notícia limpa que o modelo viu (#670)", async () => {
    getNewsByMatch.mockResolvedValue({
      results: [
        {
          title: "  Escalação do Flamengo:\n três   desfalques ",
          url: " https://ge.globo.com/a b ",
          snippet: "Pulgar está suspenso.",
          source: "ge",
        },
        { title: "Sem https", url: "http://ge.globo.com/http", source: "ge" },
        { title: "Esquema estranho", url: "javascript:alert(1)", source: "ge" },
        { title: "Casa de apostas patrocina o clube", url: "https://ge.globo.com/bet", source: "ge" },
      ],
      aiCall: null,
      status: "found",
      via: "ge",
    });
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    await generatePalpites(baseCall);

    const req = runAnalysis.mock.calls[0][0] as AnalysisRequest;
    const setRow = insertValues.mock.calls[1][0] as Record<string, unknown>;
    const headline = setRow.headline as {
      sources?: Array<{ title: string; url: string }>;
    };
    expect(headline.sources).toEqual([
      {
        title: "Escalação do Flamengo: três desfalques",
        url: "https://ge.globo.com/a%20b",
      },
    ]);
    // Cada fonte persistida aparece no prompt exatamente assim; as barradas, não.
    for (const src of headline.sources ?? []) {
      expect(req.userMessage).toContain(`${src.title} (${src.url})`);
    }
    expect(req.userMessage).not.toContain("http://ge.globo.com/http");
    expect(req.userMessage).not.toContain("Casa de apostas");
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
      okResult({ verdict: "x", narrative: "y", citedMarkets: [] }),
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
      usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
      inputPayload: {},
      outputPayload: {},
      stopReason: null,
      latencyMs: 10,
      servedModel: MODEL_REGISTRY["claude-haiku-5-5"],
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

// ─── #668 (ADR 0072): palpite decidido em código ─────────────────────────────

// O 1X2 code_jev do run: recomenda o mandante por PREÇO (2.90), mas o mercado sem margem
// dá o visitante como mais provável (2.35). O palpite é o visitante.
function codeJevAnalysis(over: Partial<MarketAnalysisSummary> = {}): MarketAnalysisSummary {
  return analysis({
    recommendation: "home",
    recommendedLabel: "Casa",
    oddAtRecommendation: 2.9,
    engine: "code_jev",
    odds: { home: 2.9, draw: 3.3, away: 2.35 },
    line: null,
    predictionCreatedAt: "2026-05-15T12:00:00.000Z",
    judgmentsModel: {
      base: { home: 1.2, away: 1.4 },
      adjusted: { home: 1.2, away: 1.4 },
      rho: -0.08,
      stateHash: "s-1",
      jevAiCallId: "jev-1",
    },
    factorPhrases: [],
    ...over,
  });
}

const modelPickText = {
  verdict: "Vai dar Fluminense",
  verdictOutcome: "away",
  narrative: "O Flu chega embalado e o Fla sente a semana pesada.",
  citedMarkets: ["Resultado (1X2)"],
};

const pickCall = { ...baseCall, analyses: [codeJevAnalysis()] };

type SetRow = {
  aiCallId: string | null;
  promptVersion: string;
  headline: Record<string, unknown> & {
    pick: {
      source: string;
      outcome: string;
      probs: Record<string, number>;
      basePredictionId: string;
    };
  };
};
type LineRow = { type: string; params: { home: number; away: number } };

function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  return fn().finally(() => warn.mockRestore());
}

describe("generatePalpites — palpite decidido em código (#668)", () => {
  it("base de mercado: v13, placar e confiança do pick, headline com pick, sem ler o snapshot", async () => {
    runAnalysis.mockResolvedValue(okResult(modelPickText));
    await generatePalpites(pickCall);

    const req = runAnalysis.mock.calls[0][0] as AnalysisRequest;
    expect(req.userMessage).toContain("# Palpite fixado");
    expect(req.userMessage).toContain("vitória do Fluminense FC (visitante)");
    expect(getLatestMatchModelSnapshot).not.toHaveBeenCalled();

    const aiCallRow = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(aiCallRow.status).toBe("ok");
    expect(aiCallRow.promptVersion).toBe("palpites_v15");
    const setRow = insertValues.mock.calls[1][0] as SetRow;
    expect(setRow.promptVersion).toBe("palpites_v15");
    expect(setRow.headline.verdict).toBe("Vai dar Fluminense");
    expect(setRow.headline.confidenceSource).toBe("market");
    expect(setRow.headline.pick.source).toBe("market");
    expect(setRow.headline.pick.outcome).toBe("away");
    expect(setRow.headline.pick.basePredictionId).toBe("pred-1");
    expect(setRow.headline.confidenceProbPct).toBe(setRow.headline.pick.probs.away);
    expect(setRow.headline.templated).toBeUndefined();
    const rows = insertValues.mock.calls[2][0] as LineRow[];
    const exact = rows.find((r) => r.type === "exact_score")!;
    expect(exact.params.away).toBeGreaterThan(exact.params.home);
  });

  it("sem odds no 1X2: λ do modelo (dc_jev)", async () => {
    runAnalysis.mockResolvedValue(
      okResult({ ...modelPickText, verdict: "Vai dar Flamengo", verdictOutcome: "home" }),
    );
    await generatePalpites({
      ...baseCall,
      analyses: [
        codeJevAnalysis({
          odds: {},
          judgmentsModel: {
            base: { home: 1.9, away: 0.8 },
            adjusted: { home: 1.9, away: 0.8 },
            rho: null,
            stateHash: "s",
            jevAiCallId: null,
          },
        }),
      ],
    });
    const setRow = insertValues.mock.calls[1][0] as SetRow;
    expect(setRow.headline.pick.source).toBe("dc_jev");
    expect(setRow.headline.pick.outcome).toBe("home");
    expect(setRow.headline.confidenceSource).toBe("dc_jev");
  });

  it("veredito do outro time → veredito de template, narrativa do LLM fica, row ok", async () => {
    runAnalysis.mockResolvedValue(
      okResult({ ...modelPickText, verdict: "Vai dar Flamengo", verdictOutcome: "home" }),
    );
    await quietly(() => generatePalpites(pickCall));
    const aiCallRow = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(aiCallRow.status).toBe("ok");
    const setRow = insertValues.mock.calls[1][0] as SetRow;
    expect(setRow.headline.verdict).toBe("Vai dar Fluminense");
    expect(setRow.headline.narrative).toBe(modelPickText.narrative);
    expect(setRow.headline.templated).toMatchObject({ verdict: true, narrative: false });
  });

  it("probableScore na saída v13 → row invalid_output e palpite de template (T7)", async () => {
    runAnalysis.mockResolvedValue(
      okResult({ ...modelPickText, probableScore: { home: 2, away: 1 } }),
    );
    const res = await quietly(() => generatePalpites(pickCall));
    expect(insertValues).toHaveBeenCalledTimes(3);
    const errRow = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(errRow.status).toBe("invalid_output");
    expect(errRow.promptVersion).toBe("palpites_v15");
    const setRow = insertValues.mock.calls[1][0] as SetRow;
    // O set aponta pra row de erro (status real), com o texto de template.
    expect(setRow.aiCallId).toBe("row-1");
    expect(res.aiCall).toEqual({ id: "row-1" });
    expect(setRow.headline.verdict).toBe("Vai dar Fluminense");
    expect(setRow.headline.templated).toMatchObject({ verdict: true, narrative: true });
    expect(setRow.headline.citedMarkets).toEqual([]);
  });

  it("sem nome de exibição: template com o canonical, e o veredito com o canonical passa", async () => {
    const { displayTeams: _omit, ...canonicalCall } = pickCall;
    runAnalysis.mockResolvedValueOnce(
      okResult({ ...modelPickText, probableScore: { home: 2, away: 1 } }),
    );
    await quietly(() => generatePalpites(canonicalCall));
    const templ = insertValues.mock.calls[1][0] as SetRow;
    expect(templ.headline.verdict).toBe("Vai dar Fluminense FC");

    insertValues.mockClear();
    runAnalysis.mockResolvedValueOnce(
      okResult({ ...modelPickText, verdict: "Vai dar Fluminense FC" }),
    );
    await quietly(() => generatePalpites(pickCall));
    const ok = insertValues.mock.calls[1][0] as SetRow;
    expect(ok.headline.verdict).toBe("Vai dar Fluminense FC");
    expect(ok.headline.templated).toBeUndefined();
  });

  it("erro do provedor com pick → template, sem throw", async () => {
    runAnalysis.mockResolvedValue({
      ok: false,
      status: "provider_error",
      message: "overloaded",
      cause: null,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
      inputPayload: {},
      outputPayload: {},
      stopReason: null,
      latencyMs: 10,
      servedModel: MODEL_REGISTRY["claude-haiku-5-5"],
    } satisfies AnalysisResult);
    await quietly(() => generatePalpites(pickCall));
    expect((insertValues.mock.calls[0][0] as Record<string, unknown>).status).toBe(
      "provider_error",
    );
    const setRow = insertValues.mock.calls[1][0] as SetRow;
    expect(setRow.headline.templated).toMatchObject({ verdict: true, narrative: true });
  });

  it("sem tempo pra chamada com pick → template, sem chamada nem row de ai_calls", async () => {
    await quietly(() => generatePalpites({ ...pickCall, deadlineAt: Date.now() + 5_000 }));
    expect(runAnalysis).not.toHaveBeenCalled();
    // set + linhas (sem ai_call).
    expect(insertValues).toHaveBeenCalledTimes(2);
    const setRow = insertValues.mock.calls[0][0] as SetRow;
    expect(setRow.aiCallId).toBeNull();
  });

  it("linguagem de valor só na narrativa → só ela sai do template; uma row invalid_output", async () => {
    runAnalysis.mockResolvedValue(okResult({ ...modelPickText, narrative: "Tem edge no Flu." }));
    await quietly(() => generatePalpites(pickCall));
    expect(insertValues).toHaveBeenCalledTimes(3);
    const errRow = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(errRow.status).toBe("invalid_output");
    const setRow = insertValues.mock.calls[1][0] as SetRow;
    expect(setRow.headline.verdict).toBe(modelPickText.verdict);
    expect(setRow.headline.narrative).not.toContain("edge");
    expect(setRow.headline.templated).toMatchObject({ verdict: false, narrative: true });
  });

  it("v13: 'preço' no veredito → só ele sai do template; uma row invalid_output", async () => {
    runAnalysis.mockResolvedValue(
      okResult({ ...modelPickText, verdict: "Flu no preço certo pra levar" }),
    );
    await quietly(() => generatePalpites(pickCall));
    expect(insertValues).toHaveBeenCalledTimes(3);
    const errRow = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(errRow.status).toBe("invalid_output");
    const setRow = insertValues.mock.calls[1][0] as SetRow;
    expect(setRow.headline.verdict).not.toMatch(/preço/i);
    expect(setRow.headline.narrative).toBe(modelPickText.narrative);
    expect(setRow.headline.templated).toMatchObject({ verdict: true, narrative: false });
  });

  it("determinismo: dois runs com textos diferentes → mesmo exact_score e mesma confiança", async () => {
    const capture = () => ({
      set: insertValues.mock.calls[1][0] as SetRow,
      rows: insertValues.mock.calls[2][0] as LineRow[],
    });
    const settled = (rows: LineRow[]) =>
      rows.filter((r) => r.type !== "cards").map((r) => [r.type, r.params]);

    runAnalysis.mockResolvedValueOnce(okResult(modelPickText));
    await generatePalpites(pickCall);
    const first = capture();
    insertValues.mockClear();
    runAnalysis.mockResolvedValueOnce(
      okResult({ ...modelPickText, verdict: "O Flu leva", narrative: "Outro texto qualquer." }),
    );
    await generatePalpites(pickCall);
    const second = capture();

    expect(settled(second.rows)).toEqual(settled(first.rows));
    expect(second.set.headline.confidence).toBe(first.set.headline.confidence);
    expect(second.set.headline.confidenceProbPct).toBe(first.set.headline.confidenceProbPct);
    expect(second.set.headline.pick).toEqual(first.set.headline.pick);
  });
});

describe("generatePalpites (síntese) — notícias honestas (#670)", () => {
  const geNews = [
    {
      title: "Escalação do Flamengo: Jardim tem três desfalques",
      url: "https://ge.globo.com/futebol/times/flamengo/noticia/a.ghtml",
      snippet: "Léo Pereira e Pulgar cumprem suspensão e não viajam",
      publishedAt: "2026-05-14T20:02:01.000Z",
      source: "ge" as const,
    },
  ];

  it("trecho e data vão pro prompt, mas só {title,url} persiste", async () => {
    getNewsByMatch.mockResolvedValue({ results: geNews, aiCall: null, status: "found", via: "ge" });
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    await generatePalpites(baseCall);

    const req = runAnalysis.mock.calls[0][0] as AnalysisRequest;
    expect(req.userMessage).toContain("[ge, 14/05 17:02] Escalação do Flamengo");
    expect(req.userMessage).toContain("  Trecho: Léo Pereira e Pulgar cumprem suspensão");

    const setRow = insertValues.mock.calls[1][0] as Record<string, unknown>;
    const headline = setRow.headline as { sources?: unknown };
    expect(headline.sources).toEqual([
      { title: geNews[0].title, url: geNews[0].url },
    ]);
  });

  it("'none' diz 'nenhuma notícia recente'; 'failed' diz 'indisponíveis'", async () => {
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    getNewsByMatch.mockResolvedValue({ results: [], aiCall: null, status: "none", via: "ge" });
    await generatePalpites(baseCall);
    const noneMsg = (runAnalysis.mock.calls[0][0] as AnalysisRequest).userMessage;
    expect(noneMsg).toContain("(nenhuma notícia recente sobre o jogo)");

    runAnalysis.mockClear();
    getNewsByMatch.mockResolvedValue({ results: [], aiCall: null, status: "failed", via: null });
    await generatePalpites(baseCall);
    const failedMsg = (runAnalysis.mock.calls[0][0] as AnalysisRequest).userMessage;
    expect(failedMsg).toContain(
      "(notícias indisponíveis nesta análise: não conclua nada pela ausência)",
    );
    expect(failedMsg).not.toContain("nenhuma notícia recente");
  });

  it("sem tempo pra busca → status skipped", async () => {
    await expect(
      startNewsFetch(
        {
          league: "brasileirao_a",
          homeTeam: "A",
          awayTeam: "B",
          kickoffAt: new Date("2099-01-01T00:00:00Z"),
        },
        { userId: "u-1", matchId: "m-1" },
        Date.now() + 1_000,
      ),
    ).resolves.toEqual({ results: [], aiCall: null, status: "skipped", via: null });
    expect(getNewsByMatch).not.toHaveBeenCalled();
  });
});

describe("newsVerdict — desfecho do passo de notícias (#670)", () => {
  const base = { aiCall: null } as const;

  it("found → done com o detalhe por fonte", () => {
    expect(
      newsVerdict({
        ...base,
        results: [
          { title: "a", url: "https://ge.globo.com/a", source: "ge" },
          { title: "b", url: "https://ge.globo.com/b", source: "ge" },
        ],
        status: "found",
        via: "ge",
      }),
    ).toEqual({ detail: ["2 notícias do ge"] });
  });

  it("found com meia falha → detalhe + nota de um dos times", () => {
    expect(
      newsVerdict({
        ...base,
        results: [{ title: "a", url: "https://ge.globo.com/a", source: "ge" }],
        status: "found",
        via: "ge",
        partial: true,
      }),
    ).toEqual({ detail: ["1 notícia do ge", STEP_NOTES.newsPartial] });
  });

  it("none pelo ge, none pela busca, none com meia falha", () => {
    expect(newsVerdict({ ...base, results: [], status: "none", via: "ge" })).toEqual({
      status: "done",
      label: STEP_NOTES.newsNoneGe,
    });
    expect(
      newsVerdict({ ...base, results: [], status: "none", via: "web_search" }),
    ).toEqual({ status: "done", label: STEP_NOTES.newsNoneWeb });
    expect(
      newsVerdict({ ...base, results: [], status: "none", via: "ge", partial: true }),
    ).toEqual({
      status: "done",
      label: STEP_NOTES.newsPartial,
      detail: [STEP_NOTES.newsNoneGe],
    });
  });

  it("no_search → skipped com nota; failed → failed; skipped → skipped", () => {
    expect(
      newsVerdict({ ...base, results: [], status: "no_search", via: "web_search" }),
    ).toEqual({ status: "skipped", label: STEP_NOTES.newsNoSearch });
    expect(newsVerdict({ ...base, results: [], status: "failed", via: null })).toEqual({
      status: "failed",
    });
    expect(newsVerdict({ ...base, results: [], status: "skipped", via: null })).toEqual({
      status: "skipped",
    });
  });
});
