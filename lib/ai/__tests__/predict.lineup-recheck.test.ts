import { beforeEach, describe, expect, it, vi } from "vitest";

// Reconferência com a escalação (#619, PR B): recheckPredictionWithLineup recalcula em
// código a predição code_jev do pai com o JEV já resolvido pelo cron. As fronteiras
// pagas (Anthropic, The Odds API, limite diário, JEV, API-Football) são spies que NUNCA
// podem ser chamados; o banco é um fake que guarda o que seria gravado.

const inserted: { table: unknown; values: unknown }[] = [];
let insertSeq = 0;
vi.mock("@/lib/db", () => {
  const insert = vi.fn((table: unknown) => ({
    values: (values: unknown) => {
      inserted.push({ table, values });
      const id = `row-${++insertSeq}`;
      const row = Array.isArray(values)
        ? { id }
        : { ...(values as Record<string, unknown>), id, createdAt: new Date() };
      return Object.assign(Promise.resolve(), {
        returning: () => Promise.resolve([row]),
      });
    },
  }));
  return { db: { insert, select: vi.fn(() => { throw new Error("select inesperado"); }) } };
});

const getLatestFreshSelectionOddsSnapshots = vi.fn();
vi.mock("@/lib/db/queries/odds-snapshots", () => ({
  getLatestFreshSelectionOddsSnapshots: (...a: unknown[]) =>
    getLatestFreshSelectionOddsSnapshots(...a),
}));

const getFrozenSelectionOdds = vi.fn();
const hasNewerPreMatchPrediction = vi.fn();
vi.mock("@/lib/db/queries/lineup-recheck", () => ({
  getFrozenSelectionOdds: (...a: unknown[]) => getFrozenSelectionOdds(...a),
  hasNewerPreMatchPrediction: (...a: unknown[]) => hasNewerPreMatchPrediction(...a),
}));

const resolveMarketCatalog = vi.fn();
vi.mock("@/lib/db/queries/market-catalog", () => ({
  resolveMarketCatalog: (...a: unknown[]) => resolveMarketCatalog(...a),
}));

vi.mock("@/lib/calibration/kelly-live", () => ({
  isKellyStakingActive: () => Promise.resolve(false),
}));

// Fronteiras que a reconferência nunca toca.
const anthropicCreate = vi.fn();
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({ messages: { create: anthropicCreate } }),
}));
const getProviderForModel = vi.fn();
vi.mock("@/lib/ai/providers", () => ({
  getProviderForModel: (...a: unknown[]) => getProviderForModel(...a),
}));
const getOddsProvider = vi.fn();
vi.mock("@/lib/providers/odds", () => ({
  getOddsProvider: (...a: unknown[]) => getOddsProvider(...a),
}));
const ensureOddsSnapshotsFresh = vi.fn();
vi.mock("@/lib/odds/fetch-and-snapshot", () => ({
  ensureOddsSnapshotsFresh: (...a: unknown[]) => ensureOddsSnapshotsFresh(...a),
}));
const rateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkAnalysisRateLimit: rateLimit,
  checkPalpitesRateLimit: rateLimit,
  checkBetParseRateLimit: rateLimit,
  checkBetSlipsRateLimit: rateLimit,
}));
const judge = vi.fn();
vi.mock("@/lib/ai/judgments/provider", () => ({
  createTypeSafeJudgmentProvider: () => ({ hasKey: () => true, judge }),
}));
const findReusableJudgments = vi.fn();
vi.mock("@/lib/db/queries/judgments", () => ({
  findReusableJudgments: (...a: unknown[]) => findReusableJudgments(...a),
}));
const getSportsDataProvider = vi.fn();
vi.mock("@/lib/providers/sports-data", () => ({
  getSportsDataProvider: (...a: unknown[]) => getSportsDataProvider(...a),
}));

import type { MatchJudgmentInput } from "@/lib/ai/engine/judgment-input";
import type { PredictionJudgments } from "@/lib/ai/engine/types";
import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAbsenceInput } from "@/lib/ai/judgments/state";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import { NARRATOR_VERSION } from "@/lib/ai/markets/_narrator";
import {
  recheckPredictionWithLineup,
  resolveModelBaseJudgments,
  RECHECK_ODDS_MAX_AGE_MS,
  type JudgmentRun,
  type LineupRecheckArgs,
  type Prediction,
} from "@/lib/ai/predict";
import { predictions, predictionSelectionOdds } from "@/db/schema";
import type { SportsDataProvider } from "@/lib/providers/sports-data/types";

const KO = new Date("2026-05-15T19:00:00.000Z");
const NOW = new Date("2026-05-15T18:20:00.000Z");
const MATCH = {
  id: "m-1",
  homeTeam: "CR Flamengo",
  awayTeam: "Fluminense FC",
  kickoffAt: KO,
};
// Nome marcante: não pode aparecer em nada que seja gravado (LGPD).
const PLAYER = "Zézinho Marcante da Silva";

function answers(over: Partial<Record<string, number>> = {}): JudgmentAnswers {
  return Object.fromEntries(
    JUDGMENT_QUESTION_IDS.map((id) => [id, { value: over[id] ?? 0.1, confidence: null }])
  ) as JudgmentAnswers;
}

function parentJudgments(over: Partial<PredictionJudgments> = {}): PredictionJudgments {
  return {
    engine: "code_jev",
    applied: true,
    answers: answers(),
    multipliers: null,
    lambda: {
      source: "dixon_coles",
      degraded: false,
      rho: -0.07,
      base: { home: 1.9, away: 0.8 },
      adjusted: { home: 1.9, away: 0.8 },
    },
    versions: {
      judgments: "jev_judgments_v3",
      weights: "judgment_weights_v1",
      narrator: "narrator_v1.4",
      jevModel: "jev-1.13.0",
    },
    failure: null,
    stateHash: "parent-hash",
    aiCallId: "jev-call-parent",
    reusedFromPredictionId: null,
    lineup: { status: "not_announced", home: null, away: null },
    ...over,
  };
}

function parent(over: Partial<Prediction> = {}): Prediction {
  return {
    id: "p-parent",
    matchId: MATCH.id,
    userId: "u-1",
    aiCallId: "narration-call-parent",
    market: null,
    marketId: "mkt-1",
    selectionId: null,
    marketParams: null,
    recommendation: "pass",
    confidencePct: "55.00",
    rationale: "antes",
    keyFactors: ["f"],
    minimumOdd: null,
    oddAtRecommendation: null,
    bookmaker: "Casa Antiga",
    impliedProbPct: null,
    edgePct: null,
    stakeUnits: "1.00",
    judgments: parentJudgments(),
    modelVersion:
      "claude-sonnet-5-5;engine=code_jev;lambda=dixon_coles;judg=jev_judgments_v3;w=judgment_weights_v1",
    promptVersion: "narrator_v1.4",
    isLive: false,
    liveState: null,
    createdAt: new Date("2026-05-15T09:00:00.000Z"),
    ...over,
  };
}

function absence(name: string): JudgmentAbsenceInput {
  return {
    injury: { player: { name }, type: "injury", status: "doubtful" },
  } as JudgmentAbsenceInput;
}

function judgmentInput(): MatchJudgmentInput {
  return {
    stateInput: {} as MatchJudgmentInput["stateInput"],
    // O desfalcado em dúvida está no XI de hoje: saiu de `absences`.
    absences: { home: [], away: [] },
    providerAbsences: { home: [absence(PLAYER)], away: [] },
    lineup: {
      home: {
        status: "announced",
        changes: "5+",
        leftOut: [{ position: "forward", whereabouts: "bench" }],
      },
      away: { status: "announced", changes: null, leftOut: [] },
    },
  };
}

function run(over: Partial<JudgmentRun> = {}): JudgmentRun {
  return {
    answers: answers({ rotation_risk_home: 0.9 }),
    jevModel: "jev-1.13.0",
    jevModelServed: "jev-1.13.0",
    failure: null,
    stateHash: "lineup-hash",
    aiCallId: "jev-call-recheck",
    reusedFromPredictionId: null,
    reusedFromModelSnapshotId: null,
    ...over,
  };
}

function args(over: Partial<LineupRecheckArgs> = {}): LineupRecheckArgs {
  return {
    parent: { prediction: parent(), marketKey: "match_result" },
    match: MATCH,
    judgment: { input: judgmentInput(), run: run() },
    now: () => NOW,
    ...over,
  };
}

function snapshot(selections: Record<string, number>, capturedAt = NOW) {
  return {
    bookmaker: "Casa Nova",
    capturedAt,
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

const predictionInsert = () =>
  inserted.find((i) => i.table === predictions)?.values as
    | (Record<string, unknown> & { judgments: PredictionJudgments })
    | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  inserted.length = 0;
  getLatestFreshSelectionOddsSnapshots.mockResolvedValue(
    snapshot({ home: 2.6, draw: 3.4, away: 2.9 })
  );
  getFrozenSelectionOdds.mockResolvedValue([]);
  hasNewerPreMatchPrediction.mockResolvedValue(false);
  resolveMarketCatalog.mockImplementation((key: string) =>
    Promise.resolve(
      catalogFor(
        key === "over_under" ? ["over", "under"] : ["home", "draw", "away"]
      )
    )
  );
});

function expectNoPaidBoundaries() {
  expect(anthropicCreate).not.toHaveBeenCalled();
  expect(getProviderForModel).not.toHaveBeenCalled();
  expect(getOddsProvider).not.toHaveBeenCalled();
  expect(ensureOddsSnapshotsFresh).not.toHaveBeenCalled();
  expect(rateLimit).not.toHaveBeenCalled();
  expect(judge).not.toHaveBeenCalled();
  expect(getSportsDataProvider).not.toHaveBeenCalled();
}

describe("recheckPredictionWithLineup", () => {
  it("grava uma row NOVA com o ponteiro pro pai, sem Anthropic, odds provider, JEV ou limite", async () => {
    const out = await recheckPredictionWithLineup(args());
    expect(out).toEqual({
      kind: "persisted",
      predictionId: expect.any(String),
      flipped: true,
      oddsFrom: "snapshot",
    });
    expectNoPaidBoundaries();

    const row = predictionInsert()!;
    expect(row).toMatchObject({
      matchId: MATCH.id,
      userId: "u-1",
      aiCallId: "jev-call-recheck",
      recommendation: "home",
      bookmaker: "Casa Nova",
      promptVersion: NARRATOR_VERSION,
      modelVersion:
        "claude-sonnet-5-5;engine=code_jev;lambda=dixon_coles;judg=jev_judgments_v3;w=judgment_weights_v1;recheck=lineup_v1",
      marketParams: null,
    });
    expect(row.judgments).toMatchObject({
      engine: "code_jev",
      applied: true,
      narration: "lineup_recheck_template",
      stateHash: "lineup-hash",
      aiCallId: "jev-call-recheck",
      lineup: {
        status: "announced",
        home: { changes: "5+", leftOut: 1 },
        away: { changes: null, leftOut: 0 },
      },
      recheck: {
        kind: "lineup",
        version: "lineup_v1",
        of: "p-parent",
        parentStateHash: "parent-hash",
        oddsFrom: "snapshot",
        oddsCapturedAt: NOW.toISOString(),
        before: { recommendation: "pass", line: null, confidencePct: 55, edgePct: null },
      },
    });
    // λ de base do PAI (não um refit), com o mesmo ρ e a mesma fonte.
    expect(row.judgments.lambda).toMatchObject({
      source: "dixon_coles",
      degraded: false,
      rho: -0.07,
      base: { home: 1.9, away: 0.8 },
    });
    // Escalação depois de prob./edge nos fatores; abrindo o racional.
    const factors = row.keyFactors as string[];
    expect(factors[0]).toMatch(/^Probabilidade do modelo/);
    expect(factors[1]).toMatch(/^Edge/);
    expect(factors[2]).toContain("Escalação do CR Flamengo confirmada com 5 ou mais mudanças");
    expect(factors[2]).toContain("atacante titular no banco");
    expect(factors[2]).toContain("1 jogador listado como desfalque está entre os titulares");
    expect(row.rationale as string).toMatch(/^Escalação do CR Flamengo confirmada/);
    // Odds só do banco, janela de 6 h.
    expect(getLatestFreshSelectionOddsSnapshots).toHaveBeenCalledWith(
      { matchId: MATCH.id, dbMarketKey: "match_result" },
      NOW,
      RECHECK_ODDS_MAX_AGE_MS
    );
    expect(getFrozenSelectionOdds).not.toHaveBeenCalled();
    // Candidate set das 3 seleções no PSO.
    const pso = inserted.find((i) => i.table === predictionSelectionOdds)?.values;
    expect(pso).toHaveLength(3);
    // LGPD: nome de jogador em nada gravado.
    expect(JSON.stringify(inserted.map((i) => i.values))).not.toContain("Zézinho");
  });

  it("mesma recomendação do pai → flipped false", async () => {
    const out = await recheckPredictionWithLineup(
      args({
        parent: { prediction: parent({ recommendation: "home" }), marketKey: "match_result" },
      })
    );
    expect(out).toMatchObject({ kind: "persisted", flipped: false });
  });

  it("sem captura ≤ 6 h no banco: odds congeladas do pai, marcadas `parent`", async () => {
    getLatestFreshSelectionOddsSnapshots.mockResolvedValue(null);
    getFrozenSelectionOdds.mockResolvedValue([
      { key: "home", odd: 2.5 },
      { key: "draw", odd: 3.3 },
      { key: "away", odd: 3.0 },
    ]);
    const out = await recheckPredictionWithLineup(args());
    expect(out).toMatchObject({ kind: "persisted", oddsFrom: "parent" });
    expect(getFrozenSelectionOdds).toHaveBeenCalledWith("p-parent");
    const row = predictionInsert()!;
    expect(row.bookmaker).toBe("Casa Antiga");
    expect(row.oddAtRecommendation).toBe("2.500");
    expect(row.judgments.recheck).toMatchObject({ oddsFrom: "parent", oddsCapturedAt: null });
    expectNoPaidBoundaries();
  });

  it("captura incompleta também cai nas odds do pai; sem nenhuma → no_odds, sem insert", async () => {
    getLatestFreshSelectionOddsSnapshots.mockResolvedValue(snapshot({ home: 2.6, draw: 3.4 }));
    getFrozenSelectionOdds.mockResolvedValue([{ key: "home", odd: 2.5 }]);
    const out = await recheckPredictionWithLineup(args());
    expect(out).toEqual({ kind: "skipped", reason: "no_odds" });
    expect(inserted).toEqual([]);
    expectNoPaidBoundaries();
  });

  it("over/under avalia só a linha do pai", async () => {
    getLatestFreshSelectionOddsSnapshots.mockResolvedValue(
      snapshot({ over: 2.4, under: 1.6 })
    );
    const out = await recheckPredictionWithLineup(
      args({
        parent: {
          prediction: parent({ marketParams: { line: 1.5 }, recommendation: "under" }),
          marketKey: "over_under",
        },
      })
    );
    expect(out.kind).toBe("persisted");
    expect(getLatestFreshSelectionOddsSnapshots).toHaveBeenCalledTimes(1);
    expect(getLatestFreshSelectionOddsSnapshots).toHaveBeenCalledWith(
      { matchId: MATCH.id, dbMarketKey: "over_under", params: { line: 1.5 } },
      NOW,
      RECHECK_ODDS_MAX_AGE_MS
    );
    const row = predictionInsert()!;
    expect(row.marketParams).toEqual({ line: 1.5 });
    expect(row.judgments.recheck?.before.line).toBe(1.5);
  });

  it("guarda de KO imediatamente antes do insert: jogo começou → nada gravado", async () => {
    const out = await recheckPredictionWithLineup(
      args({ now: () => new Date(KO.getTime() + 1000) })
    );
    expect(out).toEqual({ kind: "skipped", reason: "kickoff_passed" });
    expect(inserted).toEqual([]);
  });

  it("outra análise de pré-jogo mais nova que o pai → superseded, nada gravado", async () => {
    hasNewerPreMatchPrediction.mockResolvedValue(true);
    const out = await recheckPredictionWithLineup(args());
    expect(out).toEqual({ kind: "skipped", reason: "superseded" });
    expect(hasNewerPreMatchPrediction).toHaveBeenCalledWith({
      id: "p-parent",
      matchId: MATCH.id,
      userId: "u-1",
      marketId: "mkt-1",
      createdAt: parent().createdAt,
    });
    expect(inserted).toEqual([]);
  });

  it("JEV sem resposta nunca vira DC puro rotulado com a escalação", async () => {
    const out = await recheckPredictionWithLineup(
      args({ judgment: { input: judgmentInput(), run: run({ answers: null }) } })
    );
    expect(out).toEqual({ kind: "skipped", reason: "jev_failed" });
    expect(inserted).toEqual([]);
    expect(getLatestFreshSelectionOddsSnapshots).not.toHaveBeenCalled();
  });

  it("pai sem λ de base (LLM ou row parcial) e mercado fora do code_jev são pulados", async () => {
    expect(
      await recheckPredictionWithLineup(
        args({ parent: { prediction: parent({ judgments: null }), marketKey: "match_result" } })
      )
    ).toEqual({ kind: "skipped", reason: "parent_incomplete" });
    expect(
      await recheckPredictionWithLineup(
        args({ parent: { prediction: parent(), marketKey: "correct_score" } })
      )
    ).toEqual({ kind: "skipped", reason: "not_code_jev_market" });
    expect(inserted).toEqual([]);
  });

  it("JEV reusado sem row própria: aponta pra ai_call do pai", async () => {
    await recheckPredictionWithLineup(
      args({ judgment: { input: judgmentInput(), run: run({ aiCallId: null }) } })
    );
    expect(predictionInsert()!.aiCallId).toBe("narration-call-parent");
  });
});

describe("resolveModelBaseJudgments com judgeIf e escopo do log (#619)", () => {
  // Sem escalação, sem desfalque e sem os métodos opcionais: o input sai sem request.
  const provider = {
    capabilities: { name: "mock" },
    getLineups: vi.fn(),
  } as unknown as SportsDataProvider;
  const data = {
    league: "brasileirao_a" as const,
    kickoffAt: KO,
    homeTeam: MATCH.homeTeam,
    awayTeam: MATCH.awayTeam,
    injuries: { home: [], away: [] },
    lineups: undefined,
    homeForm: [],
    awayForm: [],
    standings: undefined,
  };

  it("judgeIf false → input pronto, run null, sem JEV nem busca de reuso", async () => {
    const judgeIf = vi.fn(() => false);
    const out = await resolveModelBaseJudgments({
      matchId: MATCH.id,
      provider,
      data,
      logScope: "recheck_lineups",
      judgeIf,
    });
    expect(out?.run).toBeNull();
    expect(out?.input.lineup.home).toEqual({ status: "not_announced" });
    expect(judgeIf).toHaveBeenCalledWith(out?.input);
    expect(judge).not.toHaveBeenCalled();
    expect(findReusableJudgments).not.toHaveBeenCalled();
  });

  it("erro na preparação → null, logado no escopo pedido", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await resolveModelBaseJudgments({
      matchId: MATCH.id,
      provider,
      // Dado quebrado de propósito: o throw sai de dentro da preparação.
      data: { ...data, injuries: undefined as never },
      logScope: "recheck_lineups",
      judgeIf: () => true,
    });
    expect(out).toBeNull();
    const logged = error.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(logged).toContainEqual(
      expect.objectContaining({
        scope: "recheck_lineups",
        error: "model_base_judgments_failed",
      })
    );
    error.mockRestore();
  });
});
