import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SportsDataTransientError,
  SportsDataUnsupportedError,
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
  neutralVenue: false,
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
// Bases do modelo por jogo "persistidas" (#555): a origem snapshot do reuso. Só os
// campos que o fake de findReusableJudgments lê.
type StoredSnapshot = {
  id: string;
  matchId: string;
  judgments: Pick<
    PredictionJudgments,
    | "applied"
    | "answers"
    | "stateHash"
    | "aiCallId"
    | "reusedFromPredictionId"
    | "reusedFromModelSnapshotId"
  > & {
    versions: Pick<
      PredictionJudgments["versions"],
      "judgments" | "weights" | "jevModel" | "jevModelServed"
    >;
  };
  checkedAt: Date;
};
let snapshotStore: StoredSnapshot[] = [];
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
    snapshotSince?: Date;
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
    if (hit) {
      return Promise.resolve({ predictionId: hit.id, judgments: hit.judgments });
    }
    // Sem predição → a base do modelo (checked_at ≥ snapshotSince ?? since).
    const snap = snapshotStore
      .filter(
        (s) =>
          s.matchId === args.matchId &&
          s.judgments.applied &&
          s.judgments.answers !== null &&
          s.judgments.stateHash === args.stateHash &&
          s.judgments.versions.judgments === args.judgmentsVersion &&
          s.judgments.versions.weights === args.weightsVersion &&
          s.judgments.versions.jevModel === args.jevModel &&
          s.checkedAt >= (args.snapshotSince ?? args.since)
      )
      .sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime())[0];
    return Promise.resolve(
      snap
        ? {
            predictionId: null,
            modelSnapshotId: snap.id,
            judgments: snap.judgments,
          }
        : null
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
// Opcionais (#617): vi.fn() sem implementação devolve undefined = "sem dado".
const getUpcomingTeamFixtures = vi.fn();
const getTopScorers = vi.fn();

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
      getUpcomingTeamFixtures: getUpcomingTeamFixtures as never,
      getTopScorers: getTopScorers as never,
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
// Dixon-Coles (ADR 0051): desligado por default → λ do heurístico da tabela.
const getEnableDixonColes = vi.fn(() => Promise.resolve(false));
vi.mock("@/lib/db/queries/ai-config", () => ({
  getDefaultModelId: (...args: unknown[]) => getDefaultModelId(...args),
  getGenerationParams: (...args: unknown[]) => getGenerationParams(...args),
  getAnalysisEngine: (...args: unknown[]) => getAnalysisEngine(...args),
  getEnableDixonColes: () => getEnableDixonColes(),
}));

// Ratings do Dixon-Coles (ADR 0051): só lidos com o flag ligado.
const getMatchRatings = vi.fn();
vi.mock("@/lib/db/queries/team-ratings", () => ({
  getMatchRatings: (...args: unknown[]) => getMatchRatings(...args),
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

// Extração do contexto extra (#565): a Haiku é a fronteira paga. Só o teste do teto a
// usa; os demais passam a Promise pronta em `userContextP`.
const extractPalpiteClaims = vi.fn();
vi.mock("@/lib/ai/user-palpite/extract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/user-palpite/extract")>()),
  extractPalpiteClaims: (...args: unknown[]) => extractPalpiteClaims(...args),
}));

import { resetAnalysisEngineMemo } from "@/lib/ai/engine/analysis-engine-flag";
import { resetDixonColesFlagMemo } from "@/lib/ratings/model-scoreline";
import { runCodeJevEngine } from "@/lib/ai/engine/code-jev";
import type { PredictionJudgments } from "@/lib/ai/engine/types";
import { computeMatchLambdas } from "@/lib/providers/sports-data/match-lambdas";
import { pickModelScoreline } from "@/lib/quant/match-model";
import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import { correctScoreCartridge } from "@/lib/ai/markets/correct_score";
import { matchResultCartridge } from "@/lib/ai/markets/match_result";
import { NARRATOR_VERSION } from "@/lib/ai/markets/_narrator";
import { TypeSafeError } from "@/lib/ai/providers/typesafe/errors";
import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";
import { CORRECT_SCORE } from "@/lib/odds/market-descriptor";
import { predict } from "@/lib/ai/predict";
import { MODEL_REGISTRY, type AIModel } from "@/lib/ai/models";
import { anthropicProvider } from "@/lib/ai/providers/anthropic";
import { runCodeJevFanOut } from "@/lib/ai/best-bet";
import { computeBestBetRank } from "@/lib/view/best-bet";
import { sortBestBetEntries } from "@/lib/view/best-bet-sort";
import { toBestBetView } from "@/lib/view/best-bet";
import {
  CONTEXT_EXTRACT_CAP_MS,
  startAnalysisContextExtraction,
} from "@/lib/ai/user-palpite/analysis-context";
import type { ExtractResult } from "@/lib/ai/user-palpite/extract";
import { combineAnswers } from "@/lib/user-palpite/evidence";
import type { Claim } from "@/lib/user-palpite/types";

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
    model: "claude-sonnet-5-5",
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
  getDefaultModelId.mockResolvedValue("claude-sonnet-5-5");
  getGenerationParams.mockResolvedValue({
    maxTokens: 16000,
    effort: "high",
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
  resetDixonColesFlagMemo();
  getEnableDixonColes.mockResolvedValue(false);
  predictionStore = [];
  snapshotStore = [];
  insertSeq = 0;
  setHappyPath();
});

afterEach(() => {
  vi.useRealTimers();
});

// λ do heurístico da tabela (flag do DC desligado nestes casos).
function heuristicScoreline(neutral = false) {
  return pickModelScoreline({
    now: new Date(),
    neutral,
    dc: null,
    heuristic: computeMatchLambdas({
      standing: STANDINGS,
      homeTeam: matchRow.homeTeam,
      awayTeam: matchRow.awayTeam,
      neutral,
    }),
  })!;
}

// A decisão que o motor deve tomar com estes insumos (mesmas funções puras).
function expectedEngine(judgments: JudgmentAnswers | null, neutral = false) {
  const scoreline = heuristicScoreline(neutral);
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
    // Calendário do JEV (#617) só no motor code_jev.
    expect(getUpcomingTeamFixtures).not.toHaveBeenCalled();
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(toolNameOf(anthropicCreate.mock.calls[0])).toBe("submit_prediction");
    // ai_call → prediction → PSO, como antes.
    expect(insertValues).toHaveBeenCalledTimes(3);
    const prediction = insertValues.mock.calls[1][0] as Row;
    expect(prediction).not.toHaveProperty("judgments");
    expect(prediction.modelVersion).toBe("claude-sonnet-5-5");
    expect(prediction.promptVersion).toBe("match_result_v1.1");
    expect(prediction.rationale).toBe(MARKET_OUTPUT.rationale);
    // Motor llm fora do over/under: ninguém usa o λ, o DC nem é lido.
    expect(getEnableDixonColes).not.toHaveBeenCalled();
    expect(getMatchRatings).not.toHaveBeenCalled();
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

// PLAN-608: a versão que serviu a narração (≠ do pedido) é a que vai no modelVersion,
// em ai_calls.model e no custo.
const ADOPTED_SONNET: AIModel = {
  ...MODEL_REGISTRY["claude-sonnet-5-5"],
  id: "claude-sonnet-5-6",
  inputPricePerMTok: 3,
  outputPricePerMTok: 15,
  adopted: { priceEstimated: true, pinnedId: "claude-sonnet-5-5" },
};
const CODE_JEV_TAGS =
  ";engine=code_jev;lambda=heuristic;judg=jev_judgments_v3;w=judgment_weights_v1";

function serveAs(model: AIModel) {
  const original = anthropicProvider.runAnalysis;
  return vi
    .spyOn(anthropicProvider, "runAnalysis")
    .mockImplementation(async (req) => ({ ...(await original(req)), servedModel: model }));
}

describe("flag analysis_engine = 'code_jev'", () => {
  it("narração servida por outra versão: modelVersion, ai_calls.model e custo usam a que serviu", async () => {
    const spy = serveAs(ADOPTED_SONNET);

    await predict({ matchId: "m-1", userId: "u-1", isAdmin: true, marketKey: "match_result" });

    expect(spy.mock.calls[0][0].model.id).toBe("claude-sonnet-5-5");
    const [narratorCall] = rowsWhere((r) => r.promptVersion === NARRATOR_VERSION && "provider" in r);
    expect(narratorCall.model).toBe("claude-sonnet-5-6");
    expect(narratorCall.costUsd).toBe(((900 * 3 + 200 * 15) / 1_000_000).toFixed(6));
    const [prediction] = rowsWhere((r) => "recommendation" in r);
    // Mesmo formato de hoje, só com o id que serviu.
    expect(prediction.modelVersion).toBe(`claude-sonnet-5-6${CODE_JEV_TAGS}`);
  });

  it("narrador falha com o servido → a row de erro e o modelVersion também levam o servido", async () => {
    anthropicCreate.mockRejectedValue(new Error("boom"));
    serveAs(ADOPTED_SONNET);

    await predict({ matchId: "m-1", userId: "u-1", isAdmin: true, marketKey: "match_result" });

    const [narratorCall] = rowsWhere((r) => r.promptVersion === NARRATOR_VERSION && "provider" in r);
    expect(narratorCall.status).toBe("provider_error");
    expect(narratorCall.model).toBe("claude-sonnet-5-6");
    const [prediction] = rowsWhere((r) => "recommendation" in r);
    expect(prediction.modelVersion).toBe(`claude-sonnet-5-6${CODE_JEV_TAGS}`);
  });

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
      promptVersion: "jev_judgments_v3",
      model: "jev-1.13.0",
      inputTokens: 1500,
      outputTokens: 0,
      status: "ok",
    });
    const [narratorCall] = rowsWhere((r) => r.promptVersion === NARRATOR_VERSION);
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
    expect(prediction.promptVersion).toBe(NARRATOR_VERSION);
    expect(prediction.modelVersion).toBe(
      "claude-sonnet-5-5;engine=code_jev;lambda=heuristic;judg=jev_judgments_v3;w=judgment_weights_v1"
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
      judgments: "jev_judgments_v3",
      weights: "judgment_weights_v1",
      narrator: NARRATOR_VERSION,
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

  it("final em campo neutro (#529): o λ sai sem vantagem de casa", async () => {
    matchRow.neutralVenue = true;
    try {
      const neutral = expectedEngine(JEV_ANSWERS, true);
      const homeAdvantage = expectedEngine(JEV_ANSWERS, false);
      expect(neutral.modelProbByKey.home).toBeLessThan(
        homeAdvantage.modelProbByKey.home
      );

      await predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: true,
        marketKey: "match_result",
      });

      const [prediction] = rowsWhere((r) => "recommendation" in r);
      const pick = prediction.recommendation as "home" | "draw" | "away";
      expect(prediction.confidencePct).toBe(
        neutral.modelProbByKey[pick].toFixed(2)
      );
    } finally {
      matchRow.neutralVenue = false;
    }
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
    const [narratorCall] = rowsWhere((r) => r.promptVersion === NARRATOR_VERSION);
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
    const [narratorCall] = rowsWhere((r) => r.promptVersion === NARRATOR_VERSION);
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
    const [narratorCall] = rowsWhere((r) => r.promptVersion === NARRATOR_VERSION);
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

  describe("Dixon-Coles ligado (ADR 0051)", () => {
    const FIT = {
      homeAdvantage: 1.3,
      rho: -0.08,
      fittedAt: new Date("2026-05-11T07:00:00.000Z"),
    };
    const rating = (attack: number, defence: number, matches = 60) => ({
      attack,
      defence,
      matches,
    });

    beforeEach(() => {
      getEnableDixonColes.mockResolvedValue(true);
    });

    it("λ base sai dos ratings (γ·α·β), com o ρ do fit; source e modelVersion = dixon_coles", async () => {
      getMatchRatings.mockResolvedValue({
        fit: FIT,
        home: rating(1.2, 0.9),
        away: rating(1.0, 1.1),
      });

      await predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: true,
        marketKey: "match_result",
      });

      expect(getMatchRatings).toHaveBeenCalledWith(
        "brasileirao_a",
        "CR Flamengo",
        "Fluminense FC"
      );
      const [prediction] = rowsWhere((r) => "recommendation" in r);
      expect(prediction.modelVersion).toContain(";lambda=dixon_coles;");
      const judgments = prediction.judgments as PredictionJudgments;
      expect(judgments.lambda.source).toBe("dixon_coles");
      expect(judgments.lambda.fallbackReason).toBeUndefined();
      expect(judgments.lambda.rho).toBe(-0.08);
      expect(judgments.lambda.base.home).toBeCloseTo(1.3 * 1.2 * 1.1, 10);
      expect(judgments.lambda.base.away).toBeCloseTo(1.0 * 0.9, 10);
    });

    it("time com poucos jogos na janela → heurístico, com o motivo gravado", async () => {
      getMatchRatings.mockResolvedValue({
        fit: FIT,
        home: rating(1.2, 0.9),
        away: rating(1.0, 1.1, 4),
      });

      await predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: true,
        marketKey: "match_result",
      });

      const [prediction] = rowsWhere((r) => "recommendation" in r);
      const judgments = prediction.judgments as PredictionJudgments;
      expect(judgments.lambda.source).toBe("heuristic");
      expect(judgments.lambda.fallbackReason).toBe("few_matches");
      expect(judgments.lambda.base).toEqual({
        home: heuristicScoreline().lambdaHome,
        away: heuristicScoreline().lambdaAway,
      });
    });

    it("erro lendo o flag → heurístico (fail-open), motivo 'error'", async () => {
      getEnableDixonColes.mockRejectedValue(new Error("neon down"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});

      await predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: true,
        marketKey: "match_result",
      });

      const [prediction] = rowsWhere((r) => "recommendation" in r);
      const judgments = prediction.judgments as PredictionJudgments;
      expect(judgments.lambda.source).toBe("heuristic");
      expect(judgments.lambda.fallbackReason).toBe("error");
      expect(getMatchRatings).not.toHaveBeenCalled();
      err.mockRestore();
    });

    it("erro lendo os ratings → heurístico (fail-open), motivo 'error'", async () => {
      getMatchRatings.mockRejectedValue(new Error("neon down"));
      const err = vi.spyOn(console, "error").mockImplementation(() => {});

      await predict({
        matchId: "m-1",
        userId: "u-1",
        isAdmin: true,
        marketKey: "match_result",
      });

      const [prediction] = rowsWhere((r) => "recommendation" in r);
      const judgments = prediction.judgments as PredictionJudgments;
      expect(judgments.lambda.source).toBe("heuristic");
      expect(judgments.lambda.fallbackReason).toBe("error");
      err.mockRestore();
    });
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
    expect(prediction.promptVersion).toBe("correct_score_v1.1");
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
    const scoreline = heuristicScoreline();
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

describe("reuso com origem na base do modelo (#555)", () => {
  const run = () =>
    predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "match_result",
    });

  // O stateHash que o predict calcula pra este jogo: roda uma vez, lê da row e limpa.
  async function currentStateHash(): Promise<string> {
    await run();
    const hash = predictionStore[0].judgments.stateHash;
    predictionStore = [];
    judge.mockClear();
    insertValues.mockClear();
    return hash;
  }

  function snapshot(
    stateHash: string,
    overrides: Partial<StoredSnapshot["judgments"]> = {},
    checkedAt = new Date()
  ): StoredSnapshot {
    return {
      id: "snap-1",
      matchId: "m-1",
      checkedAt,
      judgments: {
        applied: true,
        answers: JEV_ANSWERS,
        stateHash,
        aiCallId: "call-cron",
        reusedFromPredictionId: null,
        reusedFromModelSnapshotId: null,
        versions: {
          judgments: "jev_judgments_v3",
          weights: "judgment_weights_v1",
          jevModel: "jev-1.13.0",
          jevModelServed: "jev-1.13.0",
        },
        ...overrides,
      },
    };
  }

  const predictionJudgments = () =>
    rowsWhere((r) => "recommendation" in r).map(
      (r) => r.judgments as PredictionJudgments
    );

  it("sem predição, reusa a base: JEV não é chamado, aponta pro snapshot e herda o aiCallId", async () => {
    const hash = await currentStateHash();
    snapshotStore = [snapshot(hash)];
    await run();

    expect(judge).not.toHaveBeenCalled();
    expect(rowsWhere((r) => r.provider === "typesafe")).toHaveLength(0);
    const [j] = predictionJudgments();
    expect(j.reusedFromModelSnapshotId).toBe("snap-1");
    expect(j.reusedFromPredictionId).toBeNull();
    expect(j.aiCallId).toBe("call-cron");
    expect(j.answers).toEqual(JEV_ANSWERS);
    expect(j.applied).toBe(true);
  });

  it("snapshot que já era reuso de uma predição → aponta pra predição de origem", async () => {
    const hash = await currentStateHash();
    snapshotStore = [
      snapshot(hash, { reusedFromPredictionId: "pred-origem" }),
    ];
    await run();

    expect(judge).not.toHaveBeenCalled();
    const [j] = predictionJudgments();
    expect(j.reusedFromPredictionId).toBe("pred-origem");
    expect(j.reusedFromModelSnapshotId).toBeNull();
  });

  it("base checada há 9h (fora das 6h da predição, dentro das 12h da base) → reusa", async () => {
    const hash = await currentStateHash();
    snapshotStore = [
      snapshot(hash, {}, new Date(Date.now() - 9 * 3_600_000)),
    ];
    findReusableJudgments.mockClear();
    await run();

    expect(judge).not.toHaveBeenCalled();
    expect(predictionJudgments()[0].reusedFromModelSnapshotId).toBe("snap-1");
    // A janela da base é 12h sobre checked_at; a da predição segue 6h sobre created_at.
    expect(findReusableJudgments).toHaveBeenCalledWith(
      expect.objectContaining({
        since: new Date(Date.now() - 6 * 3_600_000),
        snapshotSince: new Date(Date.now() - 12 * 3_600_000),
      })
    );
  });

  it("base com checked_at fora da janela de 12h → chama o JEV", async () => {
    const hash = await currentStateHash();
    snapshotStore = [
      snapshot(hash, {}, new Date(Date.now() - 12 * 3_600_000 - 60_000)),
    ];
    await run();
    expect(judge).toHaveBeenCalledTimes(1);
    expect(predictionJudgments()[0].reusedFromModelSnapshotId).toBeNull();
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

describe("calendário e artilheiros no state JEV (#617)", () => {
  const NEXT = {
    kickoffAt: "2026-05-17T22:00:00.000Z",
    kickoffTimestampMs: Date.parse("2026-05-17T22:00:00.000Z"),
    homeTeam: "Racing Club",
    awayTeam: matchRow.homeTeam,
    competition: "CONMEBOL Libertadores",
    round: "Semi-finals",
  };
  const THIS_MATCH = {
    ...NEXT,
    kickoffAt: "2026-05-15T19:30:00.000Z",
    kickoffTimestampMs: Date.parse("2026-05-15T19:30:00.000Z"),
    homeTeam: matchRow.homeTeam,
    awayTeam: matchRow.awayTeam,
    competition: "Serie A",
    round: "Regular Season - 8",
  };

  it("próximo jogo e artilheiro desfalcado chegam ao JEV, sem nome", async () => {
    getInjuriesByFixture.mockResolvedValue({
      home: [{ player: { name: "P. Atacante" }, type: "injury", status: "injured" }],
      away: [],
    });
    getUpcomingTeamFixtures.mockImplementation((team: string) =>
      Promise.resolve(team === matchRow.homeTeam ? [THIS_MATCH, NEXT] : []),
    );
    getTopScorers.mockResolvedValue([
      { player: { name: "P. Atacante" }, team: matchRow.homeTeam, goals: 9 },
    ]);

    await predict({ matchId: "m-1", userId: "u-1", isAdmin: true, marketKey: "match_result" });

    expect(getUpcomingTeamFixtures).toHaveBeenCalledWith(matchRow.homeTeam, "brasileirao_a", 5);
    expect(getTopScorers).toHaveBeenCalledWith("brasileirao_a");
    const state = judge.mock.calls[0][0] as {
      home_team: { next_match: string; absences: string[] };
      away_team: { next_match: string };
    };
    expect(state.home_team.next_match).toBe(
      "next match within 72h (CONMEBOL Libertadores, knockout)",
    );
    expect(state.away_team.next_match).toBe("unknown");
    expect(state.home_team.absences).toEqual(["player, team top scorer (injured)"]);
    expect(JSON.stringify(state)).not.toContain("Atacante");
  });

  it("próximos jogos saem antes das buscas do passo 3 (primeiras vagas do throttle)", async () => {
    await predict({ matchId: "m-1", userId: "u-1", isAdmin: true, marketKey: "match_result" });
    const firstUpcoming = Math.min(...getUpcomingTeamFixtures.mock.invocationCallOrder);
    expect(getUpcomingTeamFixtures).toHaveBeenCalledTimes(2);
    expect(firstUpcoming).toBeLessThan(Math.min(...getTeamForm.mock.invocationCallOrder));
    expect(firstUpcoming).toBeLessThan(Math.min(...getFixtureByMatch.mock.invocationCallOrder));
  });

  it("sem desfalques não busca artilheiros", async () => {
    await predict({ matchId: "m-1", userId: "u-1", isAdmin: true, marketKey: "match_result" });
    expect(getTopScorers).not.toHaveBeenCalled();
  });

  it("busca que falha não derruba: JEV roda com próximo jogo unknown", async () => {
    getUpcomingTeamFixtures.mockRejectedValue(
      new SportsDataTransientError("boom", "mock", "getUpcomingTeamFixtures", undefined),
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "match_result",
    });
    expect(result.prediction).toBeDefined();
    expect(judge).toHaveBeenCalledTimes(1);
    const state = judge.mock.calls[0][0] as { home_team: { next_match: string } };
    expect(state.home_team.next_match).toBe("unknown");
    expect(err.mock.calls.map((c) => String(c[0]))).toContainEqual(
      expect.stringContaining("upcoming_fixtures_fetch_failed"),
    );
    err.mockRestore();
  });

  it("Unsupported não loga erro", async () => {
    getUpcomingTeamFixtures.mockRejectedValue(
      new SportsDataUnsupportedError("no", "mock", "getUpcomingTeamFixtures"),
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await predict({ matchId: "m-1", userId: "u-1", isAdmin: true, marketKey: "match_result" });
    expect(err.mock.calls.map((c) => String(c[0]))).not.toContainEqual(
      expect.stringContaining("fetch_failed"),
    );
    err.mockRestore();
  });
});

describe("escalação confirmada no state JEV (#619)", () => {
  const LEAGUE_COMPETITION = {
    name: "Serie A",
    league: "brasileirao_a" as const,
    friendly: false,
  };
  // Último jogo de liga de cada time, 7 dias antes (não congestionado).
  const pastLeague = (home: string, away: string): NormalizedFixture => ({
    ...FIXTURE,
    id: `past:${home}:${away}`,
    kickoffAt: "2026-05-08T19:00:00.000Z",
    kickoffTimestampMs: Date.parse("2026-05-08T19:00:00.000Z"),
    homeTeam: home,
    awayTeam: away,
    status: "finished",
    score: { home: 1, away: 1 },
    competition: LEAGUE_COMPETITION,
  });
  const HOME_PAST = pastLeague(matchRow.homeTeam, "SE Palmeiras");
  // Visitante: jogo de liga de 5 dias antes (o MESMO pro anterior e pra referência).
  const AWAY_PAST: NormalizedFixture = {
    ...pastLeague("SC Corinthians", matchRow.awayTeam),
    kickoffAt: "2026-05-10T19:00:00.000Z",
    kickoffTimestampMs: Date.parse("2026-05-10T19:00:00.000Z"),
  };

  // Nomes marcantes (LGPD): nenhum pode sair pro state, pro jsonb ou pro narrador.
  const NAMES = [
    "Zebedeu Quintanilha",
    "Ataulfo Brandimarte",
    "Clodoveu Pimpão",
    "Deoclides Furtunato",
    "Eleutério Bambozzi",
    "Filisberto Carvoeiro",
    "Genésio Trombetta",
    "Hermógenes Barrufi",
    "Isauro Cotrim",
    "Jacinto Malaquias",
    "Leovigildo Sarapião",
    "Mamede Tobias",
    "Nicanor Pellegrino",
    "Olegário Vasconcellos",
  ];
  const POS = ["GK", "DEF", "DEF", "DEF", "DEF", "MID", "MID", "MID", "FWD", "FWD", "FWD"];
  // XI de ids `ids` (nome = NAMES[id - 1] + o lado, pra os dois times terem nomes).
  const xi = (team: string, ids: readonly number[], side: number) => ({
    team,
    starters: ids.map((id, i) => ({
      name: `${NAMES[id - 1]} ${side}`,
      position: POS[i],
      providerPlayerId: `api-football:${side * 100 + id}`,
    })),
  });
  const ELEVEN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const lineupOf = (f: NormalizedFixture | FixtureRef, home: number[], away: number[]) => ({
    fixtureId: "fx",
    home: xi(f.homeTeam, home, f.homeTeam === matchRow.awayTeam ? 2 : 1),
    away: xi(f.awayTeam, away, f.awayTeam === matchRow.homeTeam ? 1 : 2),
  });
  // Hoje: o mandante poupa 3 titulares (meias 7 e 8, atacante 9); 8 e 9 no banco, 7
  // fora da lista. O visitante repete o XI.
  const TODAY = {
    fixtureId: "today",
    home: {
      ...xi(matchRow.homeTeam, [1, 2, 3, 4, 5, 6, 12, 13, 14, 10, 11], 1),
      bench: xi(matchRow.homeTeam, [8, 9], 1).starters,
    },
    away: xi(matchRow.awayTeam, ELEVEN, 2),
  };

  const isThisMatch = (ref: FixtureRef) => ref.kickoffAt === FIXTURE.kickoffAt;
  const run = () =>
    predict({ matchId: "m-1", userId: "u-1", isAdmin: true, marketKey: "match_result" });
  const lastPrediction = () =>
    rowsWhere((r) => "recommendation" in r).at(-1)!.judgments as PredictionJudgments;
  type TeamState = { lineup: string; starters_left_out: string[]; absences: string[] };
  const stateSent = () =>
    judge.mock.calls[0][0] as { home_team: TeamState; away_team: TeamState };

  beforeEach(() => {
    getTeamForm.mockImplementation((team: string) =>
      Promise.resolve(team === matchRow.homeTeam ? [HOME_PAST] : [AWAY_PAST])
    );
  });

  it("antes da escalação: nenhuma busca de referência, state 'not announced' e jsonb gravado", async () => {
    getLineups.mockResolvedValue(undefined);
    await run();
    // Só a escalação deste jogo (ninguém desfalcado → sem escalação anterior).
    expect(getLineups).toHaveBeenCalledTimes(1);
    expect(stateSent().home_team).toMatchObject({
      lineup: "not announced",
      starters_left_out: [],
    });
    expect(lastPrediction().lineup).toEqual({
      status: "not_announced",
      home: null,
      away: null,
    });
  });

  it("com a escalação: referência buscada, mudanças voluntárias no state e no jsonb, sem nomes", async () => {
    getInjuriesByFixture.mockResolvedValue({
      home: [],
      // Visitante: desfalcado em dúvida que está no XI de hoje (sai de absences) e um
      // lesionado de verdade (fora da lista de hoje e do XI de referência).
      away: [
        { player: { name: `${NAMES[3]} 2` }, type: "injury", status: "doubtful" },
        { player: { name: NAMES[12] }, type: "injury", status: "injured" },
      ],
    });
    getLineups.mockImplementation((ref: FixtureRef) => {
      if (isThisMatch(ref)) return Promise.resolve(TODAY);
      if (ref.kickoffAt === HOME_PAST.kickoffAt) {
        return Promise.resolve(lineupOf(HOME_PAST, ELEVEN, ELEVEN));
      }
      if (ref.kickoffAt === AWAY_PAST.kickoffAt) {
        return Promise.resolve(lineupOf(AWAY_PAST, ELEVEN, ELEVEN));
      }
      return Promise.resolve(undefined);
    });

    await run();

    // Este jogo + a referência do mandante + o jogo do visitante (anterior E referência:
    // o memo da chamada faz UMA busca).
    expect(getLineups).toHaveBeenCalledTimes(3);
    expect(
      getLineups.mock.calls.filter(([ref]) => (ref as FixtureRef).kickoffAt === AWAY_PAST.kickoffAt)
    ).toHaveLength(1);
    expect(getLineups).toHaveBeenCalledWith({
      league: HOME_PAST.league,
      kickoffAt: HOME_PAST.kickoffAt,
      homeTeam: HOME_PAST.homeTeam,
      awayTeam: HOME_PAST.awayTeam,
    });

    const state = stateSent();
    expect(state.home_team.lineup).toBe(
      "announced, 3 to 4 voluntary changes from the usual starting lineup"
    );
    expect(state.home_team.starters_left_out).toEqual([
      "starting midfielder (on the bench)",
      "starting midfielder (not in the squad)",
      "starting forward (on the bench)",
    ]);
    expect(state.away_team.lineup).toBe(
      "announced, 0 to 2 voluntary changes from the usual starting lineup"
    );
    expect(state.away_team.absences).toEqual(["player (injured)"]);

    const judgments = lastPrediction();
    expect(judgments.lineup).toEqual({
      status: "announced",
      home: { changes: "3-4", leftOut: 3 },
      away: { changes: "0-2", leftOut: 0 },
    });

    const outgoing = [
      JSON.stringify(judge.mock.calls),
      JSON.stringify(insertValues.mock.calls),
      JSON.stringify(anthropicCreate.mock.calls),
    ].join("\n");
    for (const name of NAMES) {
      expect(outgoing).not.toContain(name.split(" ")[1]);
    }
    expect(outgoing).not.toContain("api-football:");
  });

  it("referência que falha → 'announced, changes unknown' e a análise segue (fail-open)", async () => {
    getLineups.mockImplementation((ref: FixtureRef) =>
      isThisMatch(ref) ? Promise.resolve(TODAY) : Promise.reject(new Error("boom"))
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await run();

    expect(result.prediction).toBeDefined();
    expect(judge).toHaveBeenCalledTimes(1);
    expect(stateSent().home_team).toMatchObject({
      lineup: "announced, changes unknown",
      starters_left_out: [],
    });
    expect(lastPrediction().lineup).toEqual({
      status: "announced",
      home: { changes: null, leftOut: 0 },
      away: { changes: null, leftOut: 0 },
    });
    expect(err.mock.calls.map((c) => String(c[0]))).toContainEqual(
      expect.stringContaining("lineup_baseline_fetch_failed")
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
      (r) => r.promptVersion === NARRATOR_VERSION && "provider" in r
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

  it("narração servida por outra versão: TODOS os mercados do run gravam o id que serviu", async () => {
    const spy = serveAs(ADOPTED_SONNET);
    const out = await runCodeJevFanOut(
      base,
      markets("over_under", "match_result", "btts"),
      mapError,
      vi.fn(async () => ({ ok: true }))
    );

    expect(out.every((o) => o.ok)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].model.id).toBe("claude-sonnet-5-5");
    const [narratorCall] = rowsWhere(
      (r) => r.promptVersion === NARRATOR_VERSION && "provider" in r
    );
    expect(narratorCall.model).toBe("claude-sonnet-5-6");
    expect(narratorCall.costUsd).toBe(((900 * 3 + 200 * 15) / 1_000_000).toFixed(6));
    const predictions = rowsWhere((r) => "recommendation" in r);
    expect(predictions).toHaveLength(3);
    // O narrado e os dois templados: a mesma row de ai_calls, o mesmo modelo.
    for (const p of predictions) {
      expect(p.aiCallId).toBe(narratorCall.__id);
      expect(p.modelVersion).toMatch(/^claude-sonnet-5-6;engine=code_jev;lambda=/);
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
      (r) => r.promptVersion === NARRATOR_VERSION && "provider" in r
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

    // Opus 5.5 (deliberate) precisa de ≥120s pra começar; restam 100s. As decisões em
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
      (r) => r.promptVersion === NARRATOR_VERSION && "provider" in r
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
      // Sem chamada, o modelo "que serviu" é o pedido.
      expect(p.modelVersion).toMatch(/^claude-opus-5-5;engine=code_jev;/);
    }
    expect(narratorCalls[0].model).toBe("claude-opus-5-5");
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

  it("Dixon-Coles ligado: ratings lidos UMA vez pro run, todos os mercados com o mesmo λ do DC", async () => {
    getEnableDixonColes.mockResolvedValue(true);
    getMatchRatings.mockResolvedValue({
      fit: {
        homeAdvantage: 1.3,
        rho: -0.08,
        fittedAt: new Date("2026-05-11T07:00:00.000Z"),
      },
      home: { attack: 1.2, defence: 0.9, matches: 60 },
      away: { attack: 1.0, defence: 1.1, matches: 60 },
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
    expect(getMatchRatings).toHaveBeenCalledTimes(1);
    const js = rowsWhere((r) => "recommendation" in r).map(
      (r) => r.judgments as PredictionJudgments
    );
    expect(js).toHaveLength(3);
    for (const j of js) {
      expect(j.lambda.source).toBe("dixon_coles");
      expect(j.lambda.base).toEqual(js[0].lambda.base);
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

// ─── Contexto extra da análise (#565) ─────────────────────────────────────────

describe("contexto do usuário (#565)", () => {
  // Desfalque no ataque do mandante, com nome: não está na nossa lista (vazia) →
  // não verificável, papel dito pelo usuário (noul 0,7).
  const ATTACK_HOME: Claim = {
    team: "home",
    topic: "absence",
    text: "o mandante está sem o atacante citado",
    players: ["Pedro Guilherme"],
    role: "attack",
  };

  const extraction = (claims: Claim[], warnings: string[] = []) =>
    Promise.resolve<ExtractResult>({
      ok: true,
      claims,
      warnings,
      aiCallId: "ai-extract",
    });

  const run = (userContextP?: Promise<ExtractResult | null>) =>
    predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "match_result",
      ...(userContextP ? { userContextP } : {}),
    });

  const onlyPrediction = () => {
    const [prediction] = rowsWhere((r) => "recommendation" in r);
    return prediction;
  };

  it("(a) não verificável move o λ do mandante; answers só do JEV; tag user=; origem no narrador, sem nome", async () => {
    await run(extraction([ATTACK_HOME]));

    const prediction = onlyPrediction();
    const j = prediction.judgments as PredictionJudgments;
    const withUser = expectedEngine(
      combineAnswers(JEV_ANSWERS, { attack_weakened_home: 0.7 })
    );
    const without = expectedEngine(JEV_ANSWERS);
    expect(j.lambda.adjusted.home).toBeLessThan(without.judgments.lambdaHome);
    expect(j.lambda.adjusted.home).toBeCloseTo(withUser.judgments.lambdaHome, 10);
    expect(prediction.confidencePct).toBe(
      withUser.modelProbByKey[
        withUser.recommendation === "pass" ? "home" : withUser.recommendation
      ].toFixed(2)
    );
    expect(j.applied).toBe(true);
    expect(j.answers).toEqual(JEV_ANSWERS);
    expect(j.multipliers?.home.factors.attack_weakened_home).toBeLessThan(1);
    expect(j.userContext).toMatchObject({
      evidence: { attack_weakened_home: 0.7 },
      extractionAiCallId: "ai-extract",
      versions: {
        userEvidence: "user_evidence_v1",
        extract: "user_palpite_extract_v2",
      },
    });
    expect(j.userContext?.claims).toHaveLength(1);
    expect(j.userContext?.claims[0]).toMatchObject({
      topic: "absence",
      status: "unverifiable",
      playersCount: 1,
    });
    const stored = JSON.stringify(j.userContext);
    expect(stored).not.toContain("Pedro");
    expect(stored).not.toContain("está sem");
    expect(prediction.modelVersion).toBe(
      "claude-sonnet-5-5;engine=code_jev;lambda=heuristic;judg=jev_judgments_v3;w=judgment_weights_v1;user=user_evidence_v1"
    );
    expect(prediction.promptVersion).toBe(NARRATOR_VERSION);

    const message = JSON.stringify(
      (anthropicCreate.mock.calls[0][0] as { messages: unknown }).messages
    );
    expect(message).toContain(
      "ataque do CR Flamengo ajustado para baixo) (informado por você, não conferido)"
    );
    expect(message).not.toContain("Pedro");
    expect(message).not.toContain("está sem");
  });

  it("(b) confirmada com JEV presente: mesmos números, sem tag, contexto gravado", async () => {
    // O mandante jogou há 2 dias → rodízio confirmado pelos nossos dados; com o JEV
    // presente, "já considerado" (não sobe o fator).
    const recent: NormalizedFixture = {
      ...FIXTURE,
      id: "recent",
      kickoffAt: "2026-05-13T19:00:00.000Z",
      kickoffTimestampMs: Date.parse("2026-05-13T19:00:00.000Z"),
      awayTeam: "Outro FC",
      status: "finished",
      score: { home: 1, away: 0 },
    };
    getTeamForm.mockImplementation((team: string) =>
      Promise.resolve(team === matchRow.homeTeam ? [recent] : [])
    );
    await run(
      extraction([{ team: "home", topic: "rotation", text: "vai poupar" }])
    );

    const prediction = onlyPrediction();
    const j = prediction.judgments as PredictionJudgments;
    const without = expectedEngine(JEV_ANSWERS);
    expect(j.lambda.adjusted).toEqual({
      home: without.judgments.lambdaHome,
      away: without.judgments.lambdaAway,
    });
    expect(prediction.modelVersion).not.toContain(";user=");
    expect(j.userContext?.claims[0].status).toBe("confirmed");
    expect(j.userContext?.evidence).toEqual({});
    const message = JSON.stringify(
      (anthropicCreate.mock.calls[0][0] as { messages: unknown }).messages
    );
    expect(message).not.toContain("informado por você");
  });

  it("(b2) other com subtipo (#569): nota do código no narrador, sem número nem texto livre", async () => {
    await run(
      extraction([
        { team: "home", topic: "other", otherKind: "coach_change", text: "o técnico caiu ontem" },
      ])
    );

    const prediction = onlyPrediction();
    const j = prediction.judgments as PredictionJudgments;
    const without = expectedEngine(JEV_ANSWERS);
    expect(j.lambda.adjusted).toEqual({
      home: without.judgments.lambdaHome,
      away: without.judgments.lambdaAway,
    });
    expect(prediction.modelVersion).not.toContain(";user=");
    expect(j.userContext?.claims[0]).toMatchObject({ topic: "other", otherKind: "coach_change" });
    expect(JSON.stringify(j.userContext)).not.toContain("técnico caiu");
    const message = JSON.stringify(
      (anthropicCreate.mock.calls[0][0] as { messages: unknown }).messages
    );
    expect(message).toContain(
      "- troca de técnico no CR Flamengo (informado por você, não conferido)"
    );
    expect(message).not.toContain("técnico caiu");
  });

  it("(c) JEV falhou + não verificável: applied=false, answers=null, λ movido pelo usuário, falha gravada", async () => {
    judge.mockRejectedValue(
      new TypeSafeError({
        kind: "rate_limited",
        message: "429",
        httpStatus: 429,
        latencyMs: 40,
      })
    );
    await run(extraction([ATTACK_HOME]));

    const prediction = onlyPrediction();
    const j = prediction.judgments as PredictionJudgments;
    expect(j.applied).toBe(false);
    expect(j.answers).toBeNull();
    expect(j.failure).toEqual({ kind: "rate_limited", message: "429" });
    expect(j.multipliers).not.toBeNull();
    expect(j.lambda.adjusted.home).toBeLessThan(j.lambda.base.home);
    expect(j.lambda.adjusted.away).toBe(j.lambda.base.away);
    expect(prediction.modelVersion).toMatch(/;user=user_evidence_v1$/);
  });

  it("(d) só contradita: números idênticos a sem contexto e sem tag", async () => {
    getInjuriesByFixture.mockResolvedValue({
      home: [
        { player: { name: "Fulano de Tal" }, type: "injury", status: "injured" },
      ],
      away: [],
    });
    await run(
      extraction([{ team: "home", topic: "full_squad", text: "time completo" }])
    );
    const prediction = onlyPrediction();
    const j = prediction.judgments as PredictionJudgments;
    const without = expectedEngine(JEV_ANSWERS);
    expect(j.lambda.adjusted).toEqual({
      home: without.judgments.lambdaHome,
      away: without.judgments.lambdaAway,
    });
    expect(j.userContext?.claims[0].status).toBe("contradicted");
    expect(prediction.modelVersion).not.toContain(";user=");
    expect(JSON.stringify(j.userContext)).not.toContain("Fulano");
  });

  it("(e) extração vazia, que falhou ou que rejeita → run idêntico ao sem contexto", async () => {
    const rejected = Promise.reject(new Error("boom"));
    rejected.catch(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const p of [
      extraction([]),
      Promise.resolve<ExtractResult>({ ok: false, message: "x", aiCallId: null }),
      Promise.resolve(null),
      rejected,
    ]) {
      insertValues.mockClear();
      await run(p);
      const prediction = onlyPrediction();
      const j = prediction.judgments as PredictionJudgments;
      expect(j).not.toHaveProperty("userContext");
      expect(prediction.modelVersion).not.toContain(";user=");
    }
    err.mockRestore();
  });

  it("(f) best bet: 1 JEV, a mesma evidência e o mesmo contexto em todas as rows code_jev", async () => {
    getLatestFreshSelectionOddsSnapshots.mockImplementation(
      (args: { dbMarketKey: string }) =>
        Promise.resolve(
          freshSnapshot(
            args.dbMarketKey === "over_under"
              ? { over: 1.9, under: 1.95 }
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
    const userContextP = extraction([ATTACK_HOME]);
    const out = await runCodeJevFanOut(
      { matchId: "m-1", userId: "u-1", isAdmin: true, userContextP },
      ["over_under", "match_result", "btts"].map((marketKey) => ({
        marketKey,
        extraLines: false,
      })),
      (e) => String(e),
      async () => ({ ok: true })
    );
    expect(out.every((o) => o.ok)).toBe(true);
    expect(judge).toHaveBeenCalledTimes(1);
    const predictions = rowsWhere((r) => "recommendation" in r);
    expect(predictions).toHaveLength(3);
    const js = predictions.map((p) => p.judgments as PredictionJudgments);
    for (const j of js) {
      expect(j.multipliers).toEqual(js[0].multipliers);
      expect(j.userContext).toEqual(js[0].userContext);
      expect(j.answers).toEqual(JEV_ANSWERS);
    }
    for (const p of predictions) {
      expect(p.modelVersion).toMatch(/;user=user_evidence_v1$/);
    }
  });

  it("(g) placar exato no mesmo run: caminho LLM intocado, sem contexto e sem judgments", async () => {
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
    await predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "correct_score",
      userContextP: extraction([ATTACK_HOME]),
    });
    expect(toolNameOf(anthropicCreate.mock.calls[0])).toBe("submit_prediction");
    const message = JSON.stringify(anthropicCreate.mock.calls[0][0]);
    expect(message).not.toContain("Pedro");
    expect(message).not.toContain("informado por você");
    const prediction = onlyPrediction();
    expect(prediction).not.toHaveProperty("judgments");
    expect(prediction.modelVersion).toBe("claude-sonnet-5-5");
  });

  it("(h) reuso: predição com contexto, reusada por uma análise SEM contexto, dá só o JEV", async () => {
    await run(extraction([ATTACK_HOME]));
    insertValues.mockClear();
    await run();

    expect(judge).toHaveBeenCalledTimes(1);
    const prediction = onlyPrediction();
    const j = prediction.judgments as PredictionJudgments;
    const without = expectedEngine(JEV_ANSWERS);
    expect(j.answers).toEqual(JEV_ANSWERS);
    expect(j.reusedFromPredictionId).not.toBeNull();
    expect(j).not.toHaveProperty("userContext");
    expect(j.lambda.adjusted).toEqual({
      home: without.judgments.lambdaHome,
      away: without.judgments.lambdaAway,
    });
    expect(prediction.modelVersion).not.toContain(";user=");
  });

  it("(i) extração lenta: o teto de 10 s corta a espera e o narrador fica com o resto do prazo", async () => {
    // Timers falsos de verdade (setTimeout também): o teto é um setTimeout.
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T00:00:00.000Z"));
    const start = Date.now();
    // Só responderia em 30 s. Sem o teto, o predict esperaria até lá e o narrador
    // (Haiku 5.5, `fast`; em effort high o mínimo é ~54 s) não caberia nos 40 s que
    // sobram. Haiku de propósito: um `deliberate` (Sonnet/Opus 5.5, ~108 s+) não
    // caberia nem nos 60 s.
    getDefaultModelId.mockResolvedValue("claude-haiku-5-5");
    const deadlineAt = start + 70_000;
    extractPalpiteClaims.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({ ok: true, claims: [ATTACK_HOME], warnings: [], aiCallId: "late" }),
            30_000
          )
        )
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const userContextP = startAnalysisContextExtraction({
      text: "O mandante está sem o atacante.",
      teams: { home: matchRow.homeTeam, away: matchRow.awayTeam },
      matchId: "m-1",
      userId: "u-1",
      fanOutDeadline: deadlineAt,
    });
    let narratorAt: number | null = null;
    anthropicCreate.mockImplementation((req: { tools: { name: string }[] }) => {
      if (req.tools[0].name === "submit_narration") narratorAt = Date.now();
      return Promise.resolve(anthropicMessage(req.tools[0].name, narratorOutput));
    });

    const p = predict({
      matchId: "m-1",
      userId: "u-1",
      isAdmin: true,
      marketKey: "match_result",
      userContextP,
      deadlineAt,
    });
    // Até a resposta tardia: sem o teto, o predict só seguiria aqui.
    await vi.advanceTimersByTimeAsync(30_000);
    await p;

    // O narrador começou no teto, nem um ms depois, com o prazo do run intacto.
    expect(narratorAt).toBe(start + CONTEXT_EXTRACT_CAP_MS);
    const narration = anthropicCreate.mock.calls.find(
      (c) => (c[0] as { tools: { name: string }[] }).tools[0].name === "submit_narration"
    )!;
    // Restam 60 s − 5 s de margem = 55 s de timeout.
    expect((narration[1] as { timeout: number }).timeout).toBe(55_000);
    const [narratorRow] = rowsWhere(
      (r) => r.promptVersion === NARRATOR_VERSION && "provider" in r
    );
    expect(narratorRow.status).toBe("ok");
    // O run seguiu sem o contexto.
    const j = onlyPrediction().judgments as PredictionJudgments;
    expect(j).not.toHaveProperty("userContext");
    expect(info.mock.calls.map((c) => JSON.parse(String(c[0])))).toContainEqual(
      expect.objectContaining({ event: "user_context", outcome: "timeout", latencyMs: 10_000 })
    );
    info.mockRestore();
  });
});
