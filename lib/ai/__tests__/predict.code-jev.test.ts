import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type FixtureRef,
  type NormalizedFixture,
  type NormalizedStanding,
  type ProviderCapabilities,
  type SportsDataProvider,
} from "@/lib/providers/sports-data/types";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

// Motor code_jev atrás do flag analysis_engine (#511, ADR 0041). Mesmos mocks de
// fronteira de predict.match-result.test.ts (sem DB/Anthropic/HTTP reais) + o flag, o
// JudgmentProvider (JEV) e o gate do Kelly.

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

const insertValues = vi.fn();
// Predições code_jev "persistidas" (id + createdAt), pro fake de
// findReusableJudgments abaixo. Cada insert devolve um id próprio.
type StoredPrediction = {
  id: string;
  matchId: string;
  judgments: PredictionJudgments;
  createdAt: Date;
};
let predictionStore: StoredPrediction[] = [];
let insertSeq = 0;
vi.mock("@/lib/db", () => {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => Promise.resolve([matchRow])),
      })),
    })),
  }));
  const insert = vi.fn(() => ({
    values: (...args: unknown[]) => {
      insertValues(...args);
      const id = `row-${++insertSeq}`;
      const row = args[0] as Record<string, unknown>;
      if (!Array.isArray(row) && row.judgments) {
        predictionStore.push({
          id,
          matchId: row.matchId as string,
          judgments: row.judgments as PredictionJudgments,
          createdAt: new Date(),
        });
      }
      // Ecoa a row inserida (como o .returning() real), pra a view rodar sobre ela.
      return {
        returning: vi.fn(() =>
          Promise.resolve([
            Array.isArray(row)
              ? { id }
              : { aiCallId: id, ...row, id, createdAt: new Date() },
          ])
        ),
      };
    },
  }));
  return { db: { select, insert } };
});

// Fake com a MESMA semântica da query (coberta contra Postgres real em
// find-reusable-judgments.pglite.test.ts), sobre o store acima.
const findReusableJudgments = vi.fn(
  (args: {
    matchId: string;
    judgmentsVersion: string;
    weightsVersion: string;
    jevModel: string;
    stateHash: string;
    since: Date;
  }) => {
    const hit = predictionStore
      .filter(
        (p) =>
          p.matchId === args.matchId &&
          p.judgments.applied &&
          p.judgments.stateHash === args.stateHash &&
          p.judgments.versions.judgments === args.judgmentsVersion &&
          p.judgments.versions.weights === args.weightsVersion &&
          p.judgments.versions.jevModel === args.jevModel &&
          p.createdAt >= args.since
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return Promise.resolve(
      hit ? { predictionId: hit.id, judgments: hit.judgments } : null
    );
  }
);
vi.mock("@/lib/db/queries/judgments", () => ({
  findReusableJudgments: (...args: unknown[]) =>
    findReusableJudgments(
      ...(args as Parameters<typeof findReusableJudgments>)
    ),
}));

const getInjuriesByFixture = vi.fn();
const getTeamForm = vi.fn();
const getH2H = vi.fn();
const getStandings = vi.fn();
const getLineups = vi.fn();
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
      getInjuriesByFixture: getInjuriesByFixture as never,
      getInjuriesByTeam: vi.fn() as never,
      getLineups: getLineups as never,
      getTeamForm: getTeamForm as never,
    };
  }),
}));

const getOddsForSport = vi.fn();
vi.mock("@/lib/providers/odds-api", () => ({
  getOddsForSport: (...args: unknown[]) => getOddsForSport(...args),
}));

const getLatestFreshSelectionOddsSnapshots = vi.fn();
vi.mock("@/lib/db/queries/odds-snapshots", () => ({
  getLatestFreshSelectionOddsSnapshots: (...args: unknown[]) =>
    getLatestFreshSelectionOddsSnapshots(...args),
}));

const resolveMarketCatalog = vi.fn();
vi.mock("@/lib/db/queries/market-catalog", () => ({
  resolveMarketCatalog: (...args: unknown[]) => resolveMarketCatalog(...args),
}));

const anthropicCreate = vi.fn();
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({ messages: { create: anthropicCreate } }),
}));

const getDefaultModelId = vi.fn();
const getGenerationParams = vi.fn();
const getAnalysisEngine = vi.fn();
vi.mock("@/lib/db/queries/ai-config", () => ({
  getDefaultModelId: (...args: unknown[]) => getDefaultModelId(...args),
  getGenerationParams: (...args: unknown[]) => getGenerationParams(...args),
  getAnalysisEngine: (...args: unknown[]) => getAnalysisEngine(...args),
}));

const getPreferredModelId = vi.fn();
vi.mock("@/lib/db/queries/users", () => ({
  getPreferredModelId: (...args: unknown[]) => getPreferredModelId(...args),
}));

vi.mock("@/lib/calibration/kelly-live", () => ({
  isKellyStakingActive: () => Promise.resolve(false),
}));

// JEV: o JudgmentProvider é a fronteira de rede (fetch pra api.typesafe.ai).
const judge = vi.fn();
const hasKey = vi.fn();
vi.mock("@/lib/ai/judgments/provider", () => ({
  createTypeSafeJudgmentProvider: () => ({
    hasKey: () => hasKey(),
    judge: (...args: unknown[]) => judge(...args),
  }),
}));

import { resetAnalysisEngineMemo } from "@/lib/ai/engine/analysis-engine-flag";
import { runCodeJevEngine } from "@/lib/ai/engine/code-jev";
import { resolveModelScoreline } from "@/lib/ai/engine/model-scoreline";
import type { PredictionJudgments } from "@/lib/ai/engine/types";
import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import { correctScoreCartridge } from "@/lib/ai/markets/correct_score";
import { matchResultCartridge } from "@/lib/ai/markets/match_result";
import { TypeSafeError } from "@/lib/ai/providers/typesafe/errors";
import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";
import { CORRECT_SCORE } from "@/lib/odds/market-descriptor";
import { predict } from "@/lib/ai/predict";
import { runCodeJevFanOut } from "@/lib/ai/best-bet";
import { computeBestBetRank } from "@/lib/view/best-bet";
import { sortBestBetEntries } from "@/lib/view/best-bet-sort";
import { toBestBetView } from "@/lib/view/best-bet";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const REF: FixtureRef = {
  league: "brasileirao_a",
  kickoffAt: matchRow.kickoffAt.toISOString(),
  homeTeam: matchRow.homeTeam,
  awayTeam: matchRow.awayTeam,
};

const FIXTURE: NormalizedFixture = {
  id: `brasileirao_a:${REF.kickoffAt}:${REF.homeTeam}:${REF.awayTeam}`,
  league: "brasileirao_a",
  kickoffAt: REF.kickoffAt,
  kickoffTimestampMs: matchRow.kickoffAt.getTime(),
  homeTeam: matchRow.homeTeam,
  awayTeam: matchRow.awayTeam,
  status: "scheduled",
  score: { home: null, away: null },
  venue: "Maracanã",
};

const split = (played: number, goalsFor: number, goalsAgainst: number) => ({
  played,
  wins: 0,
  draws: 0,
  losses: 0,
  goalsFor,
  goalsAgainst,
});

const STANDINGS: NormalizedStanding = {
  league: "brasileirao_a",
  season: 2026,
  tables: [
    {
      teams: [
        {
          position: 1,
          team: matchRow.homeTeam,
          played: 12,
          won: 8,
          draw: 2,
          lost: 2,
          goalsFor: 24,
          goalsAgainst: 10,
          points: 26,
          homeSplit: split(6, 15, 4),
          awaySplit: split(6, 9, 6),
        },
        {
          position: 2,
          team: matchRow.awayTeam,
          played: 12,
          won: 6,
          draw: 3,
          lost: 3,
          goalsFor: 18,
          goalsAgainst: 14,
          points: 21,
          homeSplit: split(6, 10, 6),
          awaySplit: split(6, 8, 8),
        },
      ],
    },
  ],
};

// Odds que dão valor no mandante segundo o modelo (implícita baixa no home).
const ODDS = { home: 2.6, draw: 3.4, away: 2.9 };

function freshSnapshot(selections: Record<string, number>) {
  return {
    bookmaker: "Pinnacle",
    capturedAt: new Date(),
    overroundPct: "4.00",
    selections: Object.entries(selections).map(([key, odd]) => ({
      key,
      odd: odd.toFixed(3),
    })),
  };
}

function catalogFor(keys: readonly string[]) {
  return {
    marketId: "mkt-1",
    idByKey: new Map(keys.map((k) => [k, `sel-${k}`])),
    keyById: new Map(keys.map((k) => [`sel-${k}`, k])),
  };
}

function anthropicMessage(name: string, input: Record<string, unknown>) {
  return {
    id: "msg-1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-5-20250929",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [{ type: "tool_use", id: "tu-1", name, input }],
    usage: { input_tokens: 900, output_tokens: 200 },
  };
}

const MARKET_OUTPUT = {
  recommendation: "home",
  confidence_pct: 58,
  prob_home: 58,
  prob_draw: 25,
  prob_away: 17,
  rationale: "Mandante forte joga em casa contra um visitante irregular.",
  key_factors: ["mando de campo", "forma recente superior"],
  minimum_odd: 1.6,
};

const NARRATION = {
  rationale:
    "O CR Flamengo chega melhor na tabela e marca muito em casa, e o modelo de placar vê valor na vitória do mandante.",
  key_factors: ["Ataque forte em casa", "Defesa sólida no Maracanã"],
};

let narratorOutput: Record<string, unknown> = NARRATION;
let marketOutput: Record<string, unknown> = MARKET_OUTPUT;

function answers(
  overrides: Partial<Record<string, number>> = {}
): JudgmentAnswers {
  return Object.fromEntries(
    JUDGMENT_QUESTION_IDS.map((id) => [
      id,
      { value: overrides[id] ?? 0.1, confidence: null },
    ])
  ) as JudgmentAnswers;
}

const JEV_ANSWERS = answers({ attack_weakened_away: 0.9 });

function jevResult(a: JudgmentAnswers) {
  return {
    answers: a,
    model: "jev-1.13.0",
    inputTokens: 1500,
    latencyMs: 110,
    requestPayload: { model: "jev-1.13.0" },
    responsePayload: { answers: {} },
  };
}

function toolNameOf(call: unknown[]): string {
  return (call[0] as { tools: { name: string }[] }).tools[0].name;
}

function setHappyPath() {
  getFixtureByMatch.mockResolvedValue(FIXTURE);
  getTeamForm.mockResolvedValue([]);
  getH2H.mockResolvedValue([]);
  getStandings.mockResolvedValue(STANDINGS);
  getInjuriesByFixture.mockResolvedValue({ home: [], away: [] });
  getLineups.mockResolvedValue(undefined);
  getOddsForSport.mockResolvedValue([]);
  getLatestFreshSelectionOddsSnapshots.mockResolvedValue(freshSnapshot(ODDS));
  resolveMarketCatalog.mockResolvedValue(catalogFor(["home", "draw", "away"]));
  getDefaultModelId.mockResolvedValue("claude-sonnet-4-5-20250929");
  getGenerationParams.mockResolvedValue({
    maxTokens: 16000,
    effort: "high",
    temperature: 0.3,
  });
  getPreferredModelId.mockResolvedValue(null);
  getAnalysisEngine.mockResolvedValue("code_jev");
  hasKey.mockReturnValue(true);
  judge.mockResolvedValue(jevResult(JEV_ANSWERS));
  narratorOutput = NARRATION;
  marketOutput = MARKET_OUTPUT;
  anthropicCreate.mockImplementation((req: { tools: { name: string }[] }) =>
    Promise.resolve(
      req.tools[0].name === "submit_narration"
        ? anthropicMessage("submit_narration", narratorOutput)
        : anthropicMessage(req.tools[0].name, marketOutput)
    )
  );
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-05-12T00:00:00.000Z"));
  resetAnalysisEngineMemo();
  predictionStore = [];
  insertSeq = 0;
  setHappyPath();
});

afterEach(() => {
  vi.useRealTimers();
});

// A decisão que o motor deve tomar com estes insumos (mesmas funções puras).
function expectedEngine(judgments: JudgmentAnswers | null) {
  const scoreline = resolveModelScoreline({
    standing: STANDINGS,
    homeTeam: matchRow.homeTeam,
    awayTeam: matchRow.awayTeam,
    neutral: false,
  })!;
  const { probs } = computeMarketImpliedProbabilities([
    ODDS.home,
    ODDS.draw,
    ODDS.away,
  ]);
  return runCodeJevEngine({
    dbMarketKey: "match_result",
    selectionKeys: ["home", "draw", "away"],
    scoreline,
    judgments,
    candidates: [
      {
        line: null,
        impliedByKey: {
          home: probs[0] * 100,
          draw: probs[1] * 100,
          away: probs[2] * 100,
        },
      },
    ],
    minEdgePp: 5,
  });
}

type Row = Record<string, unknown>;
// Cada row ganha `__id` = o id que o insert mockado devolveu (row-<ordem>).
const rowsWhere = (pred: (r: Row) => boolean) =>
  insertValues.mock.calls
    .map((c, i): Row | Row[] =>
      Array.isArray(c[0])
        ? (c[0] as Row[])
        : { ...(c[0] as Row), __id: `row-${i + 1}` }
    )
    .filter((r): r is Row => !Array.isArray(r) && pred(r));

describe("flag analysis_engine = 'llm' (default)", () => {
  it("caminho de hoje: cartucho de mercado chamado, JEV e narrador não", async () => {
    getAnalysisEngine.mockResolvedValue("llm");
    const buildSpy = vi.spyOn(matchResultCartridge, "buildPredictionInput");

    const result = await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "match_result",
    });

    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(judge).not.toHaveBeenCalled();
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(toolNameOf(anthropicCreate.mock.calls[0])).toBe("submit_prediction");
    // ai_call → prediction → PSO, como antes.
    expect(insertValues).toHaveBeenCalledTimes(3);
    const prediction = insertValues.mock.calls[1][0] as Row;
    expect(prediction).not.toHaveProperty("judgments");
    expect(prediction.modelVersion).toBe("claude-sonnet-4-5-20250929");
    expect(prediction.promptVersion).toBe("match_result_v1");
    expect(prediction.rationale).toBe(MARKET_OUTPUT.rationale);
    expect(result.selections.map((s) => s.modelProbPct)).toEqual([58, 25, 17]);
  });

  it("erro ao ler o flag → 'llm' (fail-safe)", async () => {
    getAnalysisEngine.mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "match_result",
    });
    expect(judge).not.toHaveBeenCalled();
    expect(toolNameOf(anthropicCreate.mock.calls[0])).toBe("submit_prediction");
    err.mockRestore();
  });
});

describe("flag analysis_engine = 'code_jev'", () => {
  it("JEV uma vez, narrador chamado, cartucho de mercado não; a row carrega as probs do motor + judgments", async () => {
    const buildSpy = vi.spyOn(matchResultCartridge, "buildPredictionInput");
    const expected = expectedEngine(JEV_ANSWERS);
    expect(expected.recommendation).toBe("home");

    const result = await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "match_result",
    });

    expect(judge).toHaveBeenCalledTimes(1);
    expect(buildSpy).not.toHaveBeenCalled();
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(toolNameOf(anthropicCreate.mock.calls[0])).toBe("submit_narration");

    // ai_calls: JEV (typesafe) e narrador.
    const [jevCall] = rowsWhere((r) => r.provider === "typesafe");
    expect(jevCall).toMatchObject({
      promptVersion: "jev_judgments_v1",
      model: "jev-1.13.0",
      inputTokens: 1500,
      outputTokens: 0,
      status: "ok",
    });
    const [narratorCall] = rowsWhere((r) => r.promptVersion === "narrator_v1");
    expect(narratorCall).toMatchObject({
      provider: "anthropic",
      status: "ok",
      outputTokens: 200,
    });

    const [prediction] = rowsWhere((r) => "recommendation" in r);
    expect(prediction.recommendation).toBe("home");
    expect(prediction.confidencePct).toBe(
      expected.modelProbByKey.home.toFixed(2)
    );
    expect(prediction.edgePct).toBe(expected.best!.edgePct!.toFixed(2));
    expect(prediction.rationale).toBe(NARRATION.rationale);
    expect(prediction.keyFactors).toEqual(NARRATION.key_factors);
    expect(prediction.promptVersion).toBe("narrator_v1");
    expect(prediction.modelVersion).toBe(
      "claude-sonnet-4-5-20250929;engine=code_jev;lambda=heuristic;judg=jev_judgments_v1;w=judgment_weights_v1"
    );
    expect(Number(prediction.minimumOdd)).toBeCloseTo(
      100 / (expected.modelProbByKey.home - 5),
      2
    );
    const judgments = prediction.judgments as PredictionJudgments;
    expect(judgments.applied).toBe(true);
    expect(judgments.answers).toEqual(JEV_ANSWERS);
    expect(judgments.lambda.source).toBe("heuristic");
    expect(judgments.lambda.adjusted.away).toBeLessThan(
      judgments.lambda.base.away
    );
    expect(judgments.versions).toEqual({
      judgments: "jev_judgments_v1",
      weights: "judgment_weights_v1",
      narrator: "narrator_v1",
      jevModel: "jev-1.13.0",
      jevModelServed: "jev-1.13.0",
    });
    expect(judgments.failure).toBeNull();
    // A prediction aponta pra row da chamada JEV; state hasheado; sem reuso.
    expect(judgments.aiCallId).toBe(jevCall.__id);
    expect(judgments.stateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(judgments.reusedFromPredictionId).toBeNull();
    // Esta predição fez a própria chamada narradora (#512).
    expect(judgments.narration).toBe("llm_call");
    // Reuso só com o modelo JEV pinado.
    expect(findReusableJudgments).toHaveBeenCalledWith(
      expect.objectContaining({ jevModel: "jev-1.13.0" })
    );

    // PSO + carrier com as probs do código.
    const pso = insertValues.mock.calls.find((c) => Array.isArray(c[0]))![0];
    expect(pso).toEqual([
      expect.objectContaining({
        selectionId: "sel-home",
        modelProbPct: expected.modelProbByKey.home.toFixed(2),
      }),
      expect.objectContaining({
        selectionId: "sel-draw",
        modelProbPct: expected.modelProbByKey.draw.toFixed(2),
      }),
      expect.objectContaining({
        selectionId: "sel-away",
        modelProbPct: expected.modelProbByKey.away.toFixed(2),
      }),
    ]);
    expect(result.selections.map((s) => s.modelProbPct)).toEqual([
      expected.modelProbByKey.home,
      expected.modelProbByKey.draw,
      expected.modelProbByKey.away,
    ]);
  });

  it("o narrador recebe a decisão fixa e desfalques por função, sem nome", async () => {
    getInjuriesByFixture.mockResolvedValue({
      home: [],
      away: [
        {
          player: { name: "Germán Cano" },
          type: "injury",
          status: "injured",
        },
      ],
    });
    await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "match_result",
    });
    const req = anthropicCreate.mock.calls[0][0] as {
      messages: { content: string }[];
    };
    const message = JSON.stringify(req.messages);
    expect(message).toContain("APOSTAR em Vitória do CR Flamengo");
    expect(message).toContain("jogador (lesionado)");
    expect(message).not.toContain("Cano");
    // O state do JEV também não leva o nome.
    expect(JSON.stringify(judge.mock.calls[0][0])).not.toContain("Cano");
  });

  it("falha do JEV → análise segue no estatístico puro (applied=false), falha logada", async () => {
    judge.mockRejectedValue(
      new TypeSafeError({
        kind: "rate_limited",
        message: "429",
        httpStatus: 429,
        latencyMs: 40,
      })
    );
    const expected = expectedEngine(null);

    await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "match_result",
    });

    const [jevCall] = rowsWhere((r) => r.provider === "typesafe");
    expect(jevCall).toMatchObject({ status: "rate_limited", outputTokens: 0 });
    const [prediction] = rowsWhere((r) => "recommendation" in r);
    const judgments = prediction.judgments as PredictionJudgments;
    expect(judgments.applied).toBe(false);
    expect(judgments.answers).toBeNull();
    expect(judgments.failure).toEqual({ kind: "rate_limited", message: "429" });
    expect(judgments.lambda.adjusted).toEqual(judgments.lambda.base);
    expect(prediction.recommendation).toBe(expected.recommendation);
    expect(prediction.confidencePct).toBe(
      expected.modelProbByKey[
        expected.recommendation === "pass" ? "home" : expected.recommendation
      ].toFixed(2)
    );
  });

  it("sem TYPESAFE_API_KEY → fail-open, falha logada como provider_error", async () => {
    hasKey.mockReturnValue(false);
    await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "match_result",
    });
    expect(judge).not.toHaveBeenCalled();
    const [jevCall] = rowsWhere((r) => r.provider === "typesafe");
    expect(jevCall).toMatchObject({ status: "provider_error" });
    const [prediction] = rowsWhere((r) => "recommendation" in r);
    expect((prediction.judgments as PredictionJudgments).applied).toBe(false);
  });

  it("narrador com campo extra (Zod strict) → invalid_output e racional templado", async () => {
    narratorOutput = { ...NARRATION, recommendation: "away" };
    await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "match_result",
    });
    const [narratorCall] = rowsWhere((r) => r.promptVersion === "narrator_v1");
    expect(narratorCall.status).toBe("invalid_output");
    const [prediction] = rowsWhere((r) => "recommendation" in r);
    expect(prediction.recommendation).toBe("home");
    expect(prediction.rationale).toMatch(/^O modelo de placar estima/);
  });

  it("narrador que contradiz o lado → invalid_output (fidelidade) e racional templado", async () => {
    narratorOutput = {
      rationale: "Mesmo com o modelo, recomendamos o empate neste clássico.",
      key_factors: ["Clássico equilibrado", "Pouca diferença na tabela"],
    };
    await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "match_result",
    });
    const [narratorCall] = rowsWhere((r) => r.promptVersion === "narrator_v1");
    expect(narratorCall.status).toBe("invalid_output");
    expect(narratorCall.errorMessage).toMatch(/^fidelity:/);
    const [prediction] = rowsWhere((r) => "recommendation" in r);
    expect(prediction.rationale).toMatch(/^O modelo de placar estima/);
  });

  it("erro do provider no narrador não bloqueia a análise", async () => {
    anthropicCreate.mockRejectedValue(new Error("boom"));
    const result = await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "match_result",
    });
    expect(result.prediction).toBeDefined();
    const [narratorCall] = rowsWhere((r) => r.promptVersion === "narrator_v1");
    expect(narratorCall.status).not.toBe("ok");
    const [prediction] = rowsWhere((r) => "recommendation" in r);
    expect(prediction.rationale).toMatch(/^O modelo de placar estima/);
  });

  it("sem tabela (λ indisponível) → caminho LLM, sem JEV", async () => {
    getStandings.mockResolvedValue(undefined);
    // O cartucho 1X2 exige standings no input; sem tabela ele falha como hoje.
    await expect(
      predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: true,
        marketKey: "match_result",
      })
    ).rejects.toThrow(/buildPredictionInput failed/);
    expect(judge).not.toHaveBeenCalled();
  });

  it("mercado não precificável (placar exato) → caminho LLM inalterado", async () => {
    const keys = CORRECT_SCORE.selectionKeys;
    getLatestFreshSelectionOddsSnapshots.mockResolvedValue(
      freshSnapshot(Object.fromEntries(keys.map((k) => [k, 12])))
    );
    resolveMarketCatalog.mockResolvedValue(catalogFor(keys));
    marketOutput = {
      recommendation: "pass",
      confidence_pct: 12,
      cell_probs: Object.fromEntries(keys.map((k) => [k, 100 / 16])),
      rationale: "Sem valor claro em nenhum placar.",
      key_factors: ["mercado equilibrado"],
    };
    const buildSpy = vi.spyOn(correctScoreCartridge, "buildPredictionInput");

    await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "correct_score",
    });

    expect(getAnalysisEngine).not.toHaveBeenCalled();
    expect(judge).not.toHaveBeenCalled();
    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(toolNameOf(anthropicCreate.mock.calls[0])).toBe("submit_prediction");
    const [prediction] = rowsWhere((r) => "recommendation" in r);
    expect(prediction).not.toHaveProperty("judgments");
    expect(prediction.promptVersion).toBe("correct_score_v1");
  });

  it("over/under multi-linha: o motor fixa a linha de maior edge", async () => {
    // Odds por linha: só a 3.5 tem valor claro no under (implícita baixa).
    const byLine: Record<number, Record<string, number>> = {
      1.5: { over: 1.3, under: 3.5 },
      2.5: { over: 1.9, under: 1.95 },
      3.5: { over: 2.2, under: 2.4 },
    };
    getLatestFreshSelectionOddsSnapshots.mockImplementation(
      (args: { params: { line: number } | null }) =>
        Promise.resolve(
          args.params ? freshSnapshot(byLine[args.params.line]) : null
        )
    );
    resolveMarketCatalog.mockResolvedValue(catalogFor(["over", "under"]));

    await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "over_under",
      extraLines: true,
    });

    expect(judge).toHaveBeenCalledTimes(1);
    const [prediction] = rowsWhere((r) => "recommendation" in r);
    const params = prediction.marketParams as { line: number };
    const odds = byLine[params.line];
    if (prediction.recommendation !== "pass") {
      expect(prediction.oddAtRecommendation).toBe(
        odds[prediction.recommendation as string].toFixed(3)
      );
    }
    // A linha persistida é a de maior edge entre as três.
    const scoreline = resolveModelScoreline({
      standing: STANDINGS,
      homeTeam: matchRow.homeTeam,
      awayTeam: matchRow.awayTeam,
      neutral: false,
    })!;
    const engine = runCodeJevEngine({
      dbMarketKey: "over_under",
      selectionKeys: ["over", "under"],
      scoreline,
      judgments: JEV_ANSWERS,
      candidates: [1.5, 2.5, 3.5].map((line) => {
        const { probs } = computeMarketImpliedProbabilities([
          byLine[line].over,
          byLine[line].under,
        ]);
        return {
          line,
          impliedByKey: { over: probs[0] * 100, under: probs[1] * 100 },
        };
      }),
      minEdgePp: 5,
    });
    expect(engine.recommendation).not.toBe("pass");
    expect(params.line).toBe(engine.line);
    expect(prediction.recommendation).toBe(engine.recommendation);
  });
});

describe("JEV uma vez por jogo (reuso entre mercados)", () => {
  const run = (marketKey: "match_result" | "over_under") =>
    predict({ matchId: "m-1", userId: "u-1", isAdmin: true, marketKey });

  function switchToOverUnder() {
    getLatestFreshSelectionOddsSnapshots.mockResolvedValue(
      freshSnapshot({ over: 1.9, under: 1.95 })
    );
    resolveMarketCatalog.mockResolvedValue(catalogFor(["over", "under"]));
  }

  const predictionRows = () =>
    rowsWhere((r) => "recommendation" in r).map((r) => ({
      id: r.__id as string,
      judgments: r.judgments as PredictionJudgments,
    }));

  it("2º mercado do mesmo jogo e mesmo state reusa as respostas: sem chamada e sem ai_call nova", async () => {
    await run("match_result");
    switchToOverUnder();
    vi.setSystemTime(new Date("2026-05-12T01:00:00.000Z"));
    await run("over_under");

    expect(judge).toHaveBeenCalledTimes(1);
    expect(rowsWhere((r) => r.provider === "typesafe")).toHaveLength(1);
    const [first, second] = predictionRows();
    expect(second.judgments.reusedFromPredictionId).toBe(first.id);
    expect(second.judgments.aiCallId).toBe(first.judgments.aiCallId);
    expect(second.judgments.answers).toEqual(JEV_ANSWERS);
    expect(second.judgments.applied).toBe(true);
    expect(second.judgments.stateHash).toBe(first.judgments.stateHash);
    expect(second.judgments.versions.jevModel).toBe("jev-1.13.0");
  });

  it("id datado ecoado pela API não desliga o reuso: grava e filtra pelo modelo PEDIDO", async () => {
    judge.mockResolvedValue({
      ...jevResult(JEV_ANSWERS),
      model: "jev-1.13.0-20260901",
    });
    await run("match_result");
    switchToOverUnder();
    await run("over_under");

    expect(judge).toHaveBeenCalledTimes(1);
    const [first, second] = predictionRows();
    expect(first.judgments.versions.jevModel).toBe("jev-1.13.0");
    expect(first.judgments.versions.jevModelServed).toBe("jev-1.13.0-20260901");
    expect(second.judgments.reusedFromPredictionId).toBe(first.id);
    expect(second.judgments.versions.jevModelServed).toBe(
      "jev-1.13.0-20260901"
    );
  });

  it("reuso de reuso aponta pra predição de ORIGEM", async () => {
    await run("match_result");
    await run("match_result");
    await run("match_result");
    expect(judge).toHaveBeenCalledTimes(1);
    const [first, , third] = predictionRows();
    expect(third.judgments.reusedFromPredictionId).toBe(first.id);
  });

  it("state diferente (desfalque novo) → chama o JEV de novo", async () => {
    await run("match_result");
    getInjuriesByFixture.mockResolvedValue({
      home: [{ player: { name: "Pedro" }, type: "injury", status: "injured" }],
      away: [],
    });
    await run("match_result");

    expect(judge).toHaveBeenCalledTimes(2);
    const [first, second] = predictionRows();
    expect(second.judgments.stateHash).not.toBe(first.judgments.stateHash);
    expect(second.judgments.reusedFromPredictionId).toBeNull();
  });

  it("predição com julgamentos de mais de 6h → chama o JEV de novo", async () => {
    await run("match_result");
    vi.setSystemTime(new Date("2026-05-12T06:00:01.000Z"));
    await run("match_result");

    expect(judge).toHaveBeenCalledTimes(2);
    expect(predictionRows()[1].judgments.reusedFromPredictionId).toBeNull();
  });

  it("JEV que falhou (applied=false) não é reusado", async () => {
    hasKey.mockReturnValue(false);
    await run("match_result");
    hasKey.mockReturnValue(true);
    await run("match_result");
    expect(judge).toHaveBeenCalledTimes(1);
    expect(predictionRows()[1].judgments.applied).toBe(true);
  });
});

describe("papel do desfalque pela escalação do jogo ANTERIOR", () => {
  const PREVIOUS: NormalizedFixture = {
    ...FIXTURE,
    id: "prev",
    kickoffAt: "2026-05-08T19:00:00.000Z",
    kickoffTimestampMs: Date.parse("2026-05-08T19:00:00.000Z"),
    homeTeam: "SE Palmeiras",
    awayTeam: matchRow.awayTeam,
    status: "finished",
  };

  it("busca a escalação do último jogo do time desfalcado e deriva o papel dela", async () => {
    getInjuriesByFixture.mockResolvedValue({
      home: [],
      away: [
        { player: { name: "Germán Cano" }, type: "injury", status: "injured" },
      ],
    });
    getTeamForm.mockImplementation((team: string) =>
      Promise.resolve(team === matchRow.awayTeam ? [PREVIOUS] : [])
    );
    getLineups.mockImplementation((ref: FixtureRef) =>
      Promise.resolve(
        ref.kickoffAt === PREVIOUS.kickoffAt
          ? {
              fixtureId: "prev",
              home: { team: "SE Palmeiras", starters: [] },
              away: {
                team: matchRow.awayTeam,
                starters: [{ name: "German Cano", position: "FWD" }],
              },
            }
          : undefined
      )
    );

    await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "match_result",
    });

    // Uma chamada pra este jogo + uma pro jogo anterior do visitante (o mandante
    // não tem desfalque → não busca).
    expect(getLineups).toHaveBeenCalledTimes(2);
    expect(getLineups).toHaveBeenCalledWith({
      league: PREVIOUS.league,
      kickoffAt: PREVIOUS.kickoffAt,
      homeTeam: PREVIOUS.homeTeam,
      awayTeam: PREVIOUS.awayTeam,
    });
    const message = JSON.stringify(anthropicCreate.mock.calls[0][0]);
    expect(message).toContain("atacante titular (lesionado)");
    expect(message).not.toContain("Cano");
    expect(JSON.stringify(judge.mock.calls[0][0])).toContain(
      "starting forward"
    );
  });

  it("falha na escalação anterior não derruba a análise (papel desconhecido)", async () => {
    getInjuriesByFixture.mockResolvedValue({
      home: [],
      away: [
        { player: { name: "Germán Cano" }, type: "injury", status: "injured" },
      ],
    });
    getTeamForm.mockResolvedValue([PREVIOUS]);
    getLineups.mockImplementation((ref: FixtureRef) =>
      ref.kickoffAt === PREVIOUS.kickoffAt
        ? Promise.reject(new Error("boom"))
        : Promise.resolve(undefined)
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "match_result",
    });
    expect(result.prediction).toBeDefined();
    expect(JSON.stringify(anthropicCreate.mock.calls[0][0])).toContain(
      "jogador (lesionado)"
    );
    err.mockRestore();
  });
});

describe("best bet no motor code_jev (#512): 1 JEV, mercados em código, 1 narração", () => {
  const ODDS_BY_MARKET: Record<string, Record<string, number>> = {
    match_result: ODDS,
    over_under: { over: 1.9, under: 1.95 },
    btts: { yes: 1.85, no: 1.95 },
  };
  const PREVIOUS: NormalizedFixture = {
    ...FIXTURE,
    id: "prev",
    kickoffAt: "2026-05-08T19:00:00.000Z",
    kickoffTimestampMs: Date.parse("2026-05-08T19:00:00.000Z"),
    homeTeam: "SE Palmeiras",
    awayTeam: matchRow.awayTeam,
    status: "finished",
  };
  const base = { matchId: "m-1", userId: "u-1", isAdmin: true };
  const markets = (...keys: string[]) =>
    keys.map((marketKey) => ({ marketKey, extraLines: false }));
  const mapError = (err: unknown) =>
    err instanceof Error ? err.message : String(err);

  beforeEach(() => {
    getLatestFreshSelectionOddsSnapshots.mockImplementation(
      (args: { dbMarketKey: string }) =>
        Promise.resolve(freshSnapshot(ODDS_BY_MARKET[args.dbMarketKey]))
    );
    resolveMarketCatalog.mockImplementation((key: string) =>
      Promise.resolve(catalogFor(Object.keys(ODDS_BY_MARKET[key])))
    );
    // Neutro pra passar na fidelidade em qualquer mercado escolhido.
    narratorOutput = {
      rationale:
        "O modelo de placar, com a tabela e a forma recente, sustenta esta decisão.",
      key_factors: ["Tabela", "Forma recente"],
    };
    // Visitante desfalcado → a escalação do jogo anterior seria buscada.
    getInjuriesByFixture.mockResolvedValue({
      home: [],
      away: [
        { player: { name: "Germán Cano" }, type: "injury", status: "injured" },
      ],
    });
    getTeamForm.mockImplementation((team: string) =>
      Promise.resolve(team === matchRow.awayTeam ? [PREVIOUS] : [])
    );
  });

  it("todos os mercados decididos da MESMA matriz; só o do topo é narrado; os outros templados com a narração do run", async () => {
    const acquireSlot = vi.fn(async () => ({ ok: true }));
    const out = await runCodeJevFanOut(
      base,
      markets("over_under", "match_result", "btts"),
      mapError,
      acquireSlot
    );

    expect(out.every((o) => o.ok)).toBe(true);
    // 1 JEV (e 1 lookup de reuso, 1 busca da escalação anterior) pro jogo inteiro.
    expect(judge).toHaveBeenCalledTimes(1);
    expect(findReusableJudgments).toHaveBeenCalledTimes(1);
    expect(
      getLineups.mock.calls.filter(
        ([ref]) => (ref as FixtureRef).kickoffAt === PREVIOUS.kickoffAt
      )
    ).toHaveLength(1);
    // 1 chamada LLM paga: a narração. Nenhum cartucho de mercado.
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(toolNameOf(anthropicCreate.mock.calls[0])).toBe("submit_narration");
    expect(rowsWhere((r) => r.provider === "typesafe")).toHaveLength(1);
    const narratorCalls = rowsWhere(
      (r) => r.promptVersion === "narrator_v1" && "provider" in r
    );
    expect(narratorCalls).toHaveLength(1);
    // 1 chamada paga (a narração) = 1 slot, cobrado logo antes dela.
    expect(acquireSlot).toHaveBeenCalledTimes(1);

    const predictions = rowsWhere((r) => "recommendation" in r);
    expect(predictions).toHaveLength(3);
    for (const p of predictions) {
      expect(p.aiCallId).toBe(narratorCalls[0].__id);
      expect(p.modelVersion).toMatch(/;engine=code_jev;/);
      const j = p.judgments as PredictionJudgments;
      // Os três com os MESMOS julgamentos (mesma chamada JEV).
      expect(j.aiCallId).toBe(
        rowsWhere((r) => r.provider === "typesafe")[0].__id
      );
      expect(j.answers).toEqual(JEV_ANSWERS);
    }
    const narrated = predictions.filter(
      (p) => (p.judgments as PredictionJudgments).narration === "llm_call"
    );
    expect(narrated).toHaveLength(1);
    expect(narrated[0].rationale).toBe(narratorOutput.rationale);
    const templated = predictions.filter(
      (p) =>
        (p.judgments as PredictionJudgments).narration === "best_bet_template"
    );
    expect(templated).toHaveLength(2);
    for (const p of templated) {
      expect(p.rationale).toMatch(/^(O modelo de placar estima|Sem aposta)/);
    }

    // O narrado é o card do TOPO do painel (mesma ordenação, modo "edge").
    const byId = new Map(predictions.map((p) => [p.__id as string, p]));
    const ranked = sortBestBetEntries(
      out.map((o) => {
        if (!o.ok) throw new Error("unreachable");
        const row = byId.get(o.result.prediction.id)!;
        return {
          marketKey: o.marketKey,
          row,
          rank: computeBestBetRank(
            {
              recommendation: row.recommendation as string,
              confidencePct: row.confidencePct as string,
              oddAtRecommendation: row.oddAtRecommendation as string | null,
            },
            o.marketKey,
            o.result.selections
          ),
        };
      }),
      "edge"
    );
    expect(ranked[0].row).toBe(narrated[0]);
    // Só os não narrados compartilham a ai_call (custo zero no card).
    for (const o of out) {
      if (!o.ok) continue;
      const isNarrated = byId.get(o.result.prediction.id) === narrated[0];
      expect(o.sharesAiCall).toBe(isNarrated ? undefined : true);
    }
  });

  it("λ indisponível (tabela sem gols, início de temporada): cada mercado vai pro caminho LLM e cada chamada paga pede o próprio slot", async () => {
    // Tabela presente (os cartuchos rodam), mas degenerada pro λ (média 0).
    getStandings.mockResolvedValue({
      ...STANDINGS,
      tables: [
        {
          teams: STANDINGS.tables[0].teams.map((t) => ({
            ...t,
            played: 0,
            won: 0,
            draw: 0,
            lost: 0,
            goalsFor: 0,
            goalsAgainst: 0,
            points: 0,
            homeSplit: split(0, 0, 0),
            awaySplit: split(0, 0, 0),
          })),
        },
      ],
    });
    marketOutput = {
      recommendation: "pass",
      confidence_pct: 50,
      rationale: "Sem valor claro.",
      key_factors: ["equilíbrio"],
    };
    const acquireSlot = vi
      .fn<() => Promise<{ ok: boolean }>>()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValue({ ok: false });

    const out = await runCodeJevFanOut(
      base,
      markets("over_under", "btts"),
      mapError,
      acquireSlot
    );

    expect(judge).not.toHaveBeenCalled();
    // 1ª chamada paga com o slot concedido; a 2ª teve o slot negado ANTES do gasto.
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(toolNameOf(anthropicCreate.mock.calls[0])).toBe("submit_prediction");
    expect(acquireSlot).toHaveBeenCalledTimes(2);
    expect(out[0].ok).toBe(true);
    expect(out[1]).toEqual({
      ok: false,
      marketKey: "btts",
      message: "Limite diário atingido — não analisado.",
      notRun: "rate-limited",
    });
  });

  it("recusa do narrador (#524) → racional templado, 1 row de ai_calls provider_error COM tokens, pendentes persistidos", async () => {
    anthropicCreate.mockImplementation((req: { tools: { name: string }[] }) =>
      Promise.resolve(
        req.tools[0].name === "submit_narration"
          ? {
              ...anthropicMessage("submit_narration", {}),
              stop_reason: "refusal",
              stop_details: {
                type: "refusal",
                category: null,
                explanation: "Não posso ajudar com isso.",
              },
              content: [],
              usage: { input_tokens: 1100, output_tokens: 7 },
            }
          : anthropicMessage(req.tools[0].name, marketOutput)
      )
    );
    const acquireSlot = vi.fn(async () => ({ ok: true }));

    const out = await runCodeJevFanOut(
      base,
      markets("over_under", "match_result", "btts"),
      mapError,
      acquireSlot
    );

    // A recusa NÃO derruba o best bet: todos os mercados saem.
    expect(out.every((o) => o.ok)).toBe(true);
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(acquireSlot).toHaveBeenCalledTimes(1);
    // Exatamente UMA row de narração, auditada como falha de provider e com os
    // tokens cobrados (a recusa é paga).
    const narratorCalls = rowsWhere(
      (r) => r.promptVersion === "narrator_v1" && "provider" in r
    );
    expect(narratorCalls).toHaveLength(1);
    expect(narratorCalls[0].status).toBe("provider_error");
    expect(narratorCalls[0].inputTokens).toBe(1100);
    expect(narratorCalls[0].outputTokens).toBe(7);
    expect(narratorCalls[0].errorMessage).toBe(
      "o modelo recusou a análise: Não posso ajudar com isso."
    );
    // Os três persistem com o racional templado, apontando pra row da narração.
    const predictions = rowsWhere((r) => "recommendation" in r);
    expect(predictions).toHaveLength(3);
    for (const p of predictions) {
      expect(p.aiCallId).toBe(narratorCalls[0].__id);
      expect(p.rationale).toMatch(/^(O modelo de placar estima|Sem aposta)/);
    }
  });

  it("narração sem espaço no prazo (#524) → NÃO chama nem cobra slot; racional templado, row timeout de custo zero, pendentes persistidos", async () => {
    const acquireSlot = vi.fn(async () => ({ ok: true }));

    // Opus 5.5 (adaptive) precisa de ≥120s pra começar; restam 100s. As decisões em
    // código ainda cabem (piso de 20s do orquestrador).
    const out = await runCodeJevFanOut(
      { ...base, modelOverride: "claude-opus-5-5" },
      markets("over_under", "match_result", "btts"),
      mapError,
      acquireSlot,
      { deadlineAt: Date.now() + 100_000 }
    );

    expect(out.every((o) => o.ok)).toBe(true);
    // Nenhuma chamada paga, nenhum slot.
    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(acquireSlot).not.toHaveBeenCalled();
    // Uma row de narração com status timeout e custo zero, pra os pendentes terem aiCallId.
    const narratorCalls = rowsWhere(
      (r) => r.promptVersion === "narrator_v1" && "provider" in r
    );
    expect(narratorCalls).toHaveLength(1);
    expect(narratorCalls[0].status).toBe("timeout");
    expect(narratorCalls[0].inputTokens).toBe(0);
    expect(narratorCalls[0].outputTokens).toBe(0);
    expect(Number(narratorCalls[0].costUsd)).toBe(0);
    const predictions = rowsWhere((r) => "recommendation" in r);
    expect(predictions).toHaveLength(3);
    for (const p of predictions) {
      expect(p.aiCallId).toBe(narratorCalls[0].__id);
      expect(p.rationale).toMatch(/^(O modelo de placar estima|Sem aposta)/);
    }
  });
});

describe("best bet code_jev (#512) — JEV/matriz fixados, multi-linha e a view", () => {
  const base = { matchId: "m-1", userId: "u-1", isAdmin: true };
  const mapError = (err: unknown) =>
    err instanceof Error ? err.message : String(err);
  const OU_BY_LINE: Record<number, Record<string, number>> = {
    1.5: { over: 1.3, under: 3.5 },
    2.5: { over: 1.9, under: 1.95 },
    3.5: { over: 2.2, under: 2.4 },
  };

  beforeEach(() => {
    getLatestFreshSelectionOddsSnapshots.mockImplementation(
      (args: { dbMarketKey: string; params: { line: number } | null }) =>
        Promise.resolve(
          freshSnapshot(
            args.dbMarketKey === "over_under"
              ? OU_BY_LINE[args.params?.line ?? 2.5]
              : args.dbMarketKey === "btts"
                ? { yes: 1.85, no: 1.95 }
                : ODDS
          )
        )
    );
    resolveMarketCatalog.mockImplementation((key: string) =>
      Promise.resolve(
        catalogFor(
          key === "over_under"
            ? ["over", "under"]
            : key === "btts"
              ? ["yes", "no"]
              : ["home", "draw", "away"]
        )
      )
    );
    narratorOutput = {
      rationale:
        "O modelo de placar, com a tabela e a forma recente, sustenta esta decisão.",
      key_factors: ["Tabela", "Forma recente"],
    };
  });

  it("desfalques e tabela mudando entre mercados: 1 chamada JEV e 1 matriz pro run inteiro", async () => {
    // 2º mercado em diante vê um desfalque novo e outra tabela no provider.
    getInjuriesByFixture
      .mockResolvedValueOnce({ home: [], away: [] })
      .mockResolvedValue({
        home: [
          { player: { name: "Pedro" }, type: "injury", status: "injured" },
        ],
        away: [],
      });
    getStandings.mockResolvedValueOnce(STANDINGS).mockResolvedValue({
      ...STANDINGS,
      tables: [
        {
          teams: STANDINGS.tables[0].teams.map((t) => ({
            ...t,
            goalsFor: t.goalsFor + 10,
            homeSplit: split(6, 23, 4),
          })),
        },
      ],
    });

    const out = await runCodeJevFanOut(
      base,
      [
        { marketKey: "match_result", extraLines: false },
        { marketKey: "btts", extraLines: false },
        { marketKey: "over_under", extraLines: false },
      ],
      mapError,
      async () => ({ ok: true })
    );

    expect(out.every((o) => o.ok)).toBe(true);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(findReusableJudgments).toHaveBeenCalledTimes(1);
    const js = rowsWhere((r) => "recommendation" in r).map(
      (r) => r.judgments as PredictionJudgments
    );
    expect(js).toHaveLength(3);
    for (const j of js) {
      expect(j.stateHash).toBe(js[0].stateHash);
      expect(j.aiCallId).toBe(js[0].aiCallId);
      expect(j.lambda).toEqual(js[0].lambda);
    }
  });

  it("over/under com linhas extras entra no grupo: linha da escada decidida em código, 1 narração", async () => {
    const out = await runCodeJevFanOut(
      base,
      [
        { marketKey: "over_under", extraLines: true },
        { marketKey: "match_result", extraLines: false },
      ],
      mapError,
      async () => ({ ok: true })
    );

    expect(out.every((o) => o.ok)).toBe(true);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(toolNameOf(anthropicCreate.mock.calls[0])).toBe("submit_narration");
    const ou = rowsWhere(
      (r) => "recommendation" in r && r.marketParams !== null
    );
    expect(ou).toHaveLength(1);
    const line = (ou[0].marketParams as { line: number }).line;
    expect([1.5, 2.5, 3.5]).toContain(line);
    if (ou[0].recommendation !== "pass") {
      expect(ou[0].oddAtRecommendation).toBe(
        OU_BY_LINE[line][ou[0].recommendation as string].toFixed(3)
      );
    }
  });

  it("o topo de toBestBetView (a view real) é o mercado narrado", async () => {
    const out = await runCodeJevFanOut(
      base,
      [
        { marketKey: "btts", extraLines: false },
        { marketKey: "over_under", extraLines: true },
        { marketKey: "match_result", extraLines: false },
      ],
      mapError,
      async () => ({ ok: true })
    );

    const view = toBestBetView(out, new Map());
    expect(view.entries).toHaveLength(3);
    const top = sortBestBetEntries(view.entries, "edge")[0];
    const narrated = out.find((o) => o.ok && !o.sharesAiCall);
    expect(narrated?.marketKey).toBe(top.marketKey);
    // E o card do topo carrega o texto do narrador; os outros, o templado.
    expect(top.analysis.rationale).toBe(narratorOutput.rationale);
    for (const e of view.entries) {
      if (e.marketKey === top.marketKey) continue;
      expect(e.analysis.rationale).not.toBe(narratorOutput.rationale);
    }
  });
});
