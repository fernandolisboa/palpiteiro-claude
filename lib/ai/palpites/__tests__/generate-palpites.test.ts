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
// #380 — getEnableFidelityValidation precisa estar no mock (senão a chamada nova vira
// undefined()→throw em TODO teste). Default ON (true) — exercita o validador no happy path.
const getEnableFidelityValidation = vi.fn();
vi.mock("@/lib/db/queries/ai-config", () => ({
  getGenerationParams: (...args: unknown[]) => getGenerationParams(...args),
  getEnableFidelityValidation: (...args: unknown[]) =>
    getEnableFidelityValidation(...args),
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
  firstHalfScore: { home: 1, away: 0 },
  firstToScore: "home",
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
  getNewsByMatch.mockReset();
  // Default: provider de notícias inerte (sem notícia). Degrade gracioso é o normal.
  getNewsByMatch.mockResolvedValue({
    results: [],
    aiCall: null,
    unavailable: true,
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
    temperature: 0.3,
  });
  // #380 — default ON (espelha a coluna default true). Casos flag-OFF sobrescrevem.
  getEnableFidelityValidation.mockReset();
  getEnableFidelityValidation.mockResolvedValue(true);
});

const baseCall = {
  matchId: "m-1",
  userId: "u-1",
  analyses: [analysis()],
  modelOverride: "claude-haiku-4-5" as const,
};

describe("generatePalpites (síntese) — caminho ok", () => {
  it("loga ai_call(ok) → palpite_set com headline → linhas settleable em BATCH (#354)", async () => {
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    const res = await generatePalpites(baseCall);

    // Sequência de inserts: ai_calls, palpite_sets, palpites (UM batch).
    const aiCallRow = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(aiCallRow.status).toBe("ok");
    expect(aiCallRow.model).toBe("claude-haiku-4-5");
    expect(aiCallRow.promptVersion).toBe("palpites_v7");

    const setRow = insertValues.mock.calls[1][0] as Record<string, unknown>;
    expect(setRow.modelVersion).toBe("claude-haiku-4-5");
    expect(setRow.promptVersion).toBe("palpites_v7");
    expect(setRow.aiCallId).toBe("row-1");
    // headline jsonb: a manchete SEM placar (vira a linha) e SEM número de valor.
    expect(setRow.headline).toEqual({
      verdict: "Vai dar Flamengo",
      confidence: "alta",
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
    // Ainda grava set + linhas settleable (síntese honesta no all-pass).
    const rows = insertValues.mock.calls[2][0] as Record<string, unknown>[];
    const exact = rows.find((r) => r.type === "exact_score")!;
    expect(exact.type).toBe("exact_score");
    expect(exact.settleable).toBe(true);
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
    expect(setRow.modelVersion).toBe("claude-haiku-4-5");
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
      unavailable: false,
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
    getNewsByMatch.mockResolvedValue({ results: [], aiCall: null, unavailable: true });
    runAnalysis.mockResolvedValue(okResult(validHeadline));
    const res = await generatePalpites(baseCall);
    const setRow = insertValues.mock.calls[1][0] as Record<string, unknown>;
    const headline = setRow.headline as Record<string, unknown>;
    expect(headline.sources).toBeUndefined();
    // O set ainda foi gravado (notícia nunca bloqueia a manchete).
    expect(setRow.modelVersion).toBe("claude-haiku-4-5");
    expect(res.palpiteSet).toBeDefined();
  });

  it("FIREWALL-REGRESSION: termo de valor numa NOTÍCIA não derruba a síntese NEM vaza pra manchete", async () => {
    // Uma fonte com "odd" no título é INPUT (sources), não verdict/narrative — não
    // pode tropeçar no guard de value-language. E o output limpo (validHeadline) não
    // vaza o termo pra manchete. Defesa-em-profundidade: se o LLM ECOASSE "odd" no
    // output, o guard existente ainda pegaria (provado nos testes de firewall acima).
    getNewsByMatch.mockResolvedValue({
      results: [
        { title: "Palmeiras com odd alta no mercado", url: "https://ge.globo.com/odd" },
      ],
      aiCall: { id: "news-2" },
      unavailable: false,
    });
    runAnalysis.mockResolvedValue(okResult(validHeadline));

    // Não lança (a notícia com "odd" é fonte, não manchete).
    const res = await generatePalpites(baseCall);
    expect(res.palpiteSet).toBeDefined();

    // A fonte (com "odd") foi persistida como sources…
    const setRow = insertValues.mock.calls[1][0] as Record<string, unknown>;
    const headline = setRow.headline as {
      verdict: string;
      narrative: string;
      sources?: Array<{ title: string }>;
    };
    expect(headline.sources?.[0].title).toContain("odd");
    // …mas NÃO vazou pra verdict/narrative (a manchete segue limpa).
    const serialized = `${headline.verdict} ${headline.narrative}`.toLowerCase();
    expect(serialized).not.toContain("odd");

    // O ai_call(ok) foi gravado (a síntese não foi rejeitada pelo firewall).
    const aiCallRow = insertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(aiCallRow.status).toBe("ok");
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
