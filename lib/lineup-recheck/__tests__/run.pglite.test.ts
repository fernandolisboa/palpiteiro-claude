// @vitest-environment node
//
// Reconferência com a escalação (#619, PR B) de ponta a ponta contra Postgres REAL
// (pglite, migrations reais) e com o `@/lib/ai/predict` REAL: cron → candidatos → sonda
// → JEV (mock só na fronteira de rede) → recheckPredictionWithLineup → odds do banco
// (predicado da linha do over/under) → guarda de corrida → persistPrediction + PSO.
// Anthropic, The Odds API, ensureOddsSnapshotsFresh e o limite diário são spies que
// nunca podem ser chamados.
import { PGlite } from "@electric-sql/pglite";
import { eq, isNull } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as schema from "@/db/schema";
import type { PredictionJudgments } from "@/lib/ai/engine/types";
import type {
  NormalizedStanding,
  SportsDataProvider,
} from "@/lib/providers/sports-data/types";

let realDb: PgliteDatabase<typeof schema>;
let client: PGlite;

vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = (realDb as any)[prop];
        return typeof v === "function" ? v.bind(realDb) : v;
      },
    },
  ),
}));

// JEV: só a fronteira de rede (api.typesafe.ai).
const judge = vi.fn();
vi.mock("@/lib/ai/judgments/provider", () => ({
  createTypeSafeJudgmentProvider: () => ({
    hasKey: () => true,
    judge: (...args: unknown[]) => judge(...args),
  }),
}));
vi.mock("@/lib/ai/providers/typesafe/client", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/ai/providers/typesafe/client")
  >()),
  hasTypeSafeKey: () => true,
}));

// Fronteiras pagas que a reconferência nunca toca.
const anthropicCreate = vi.fn();
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({ messages: { create: anthropicCreate } }),
}));
const getOddsProvider = vi.fn();
vi.mock("@/lib/providers/odds", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers/odds")>()),
  getOddsProvider: () => getOddsProvider(),
}));
const ensureOddsSnapshotsFresh = vi.fn();
vi.mock("@/lib/odds/fetch-and-snapshot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/odds/fetch-and-snapshot")>()),
  ensureOddsSnapshotsFresh: (...a: unknown[]) => ensureOddsSnapshotsFresh(...a),
}));
const rateLimit = vi.fn();
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkAnalysisRateLimit: rateLimit,
  checkPalpitesRateLimit: rateLimit,
  checkBetParseRateLimit: rateLimit,
  checkBetSlipsRateLimit: rateLimit,
}));

import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import { getLineupRecheckCandidates } from "@/lib/db/queries/lineup-recheck";
import {
  LINEUP_RECHECK_LOCK_KEY,
  lineupRecheckMarkerKey,
  runLineupRechecks,
} from "@/lib/lineup-recheck/run";
import { __setAbsencesProviderForTesting } from "@/lib/providers/absences";
import { __setSportsDataProviderForTesting } from "@/lib/providers/sports-data";
import { releaseKvLock } from "@/lib/sync/lock";

const HOME = "CR Flamengo";
const AWAY = "Fluminense FC";
// Nome marcante: não pode aparecer em nada que seja gravado (LGPD).
const PLAYER = "Zézinho Marcante da Silva";
const MODEL_VERSION =
  "claude-sonnet-5-5;engine=code_jev;lambda=dixon_coles;judg=jev_judgments_v3;w=judgment_weights_v1";

const MIN = 60_000;
let NOW: Date;
let matchId: string;
let userId: string;
let parentAiCallId: string;
const ids = {} as { ouMarketId: string; over: string; under: string };

function standings(): NormalizedStanding {
  const split = { played: 6, wins: 0, draws: 0, losses: 0, goalsFor: 8, goalsAgainst: 6 };
  return {
    league: "brasileirao_a",
    season: 2026,
    tables: [
      {
        teams: [HOME, AWAY].map((team, i) => ({
          position: i + 1,
          team,
          played: 12,
          won: 6,
          draw: 3,
          lost: 3,
          goalsFor: 18 - i,
          goalsAgainst: 12 + i,
          points: 21 - i,
          homeSplit: split,
          awaySplit: split,
        })),
      },
    ],
  };
}

function answers(): JudgmentAnswers {
  return Object.fromEntries(
    JUDGMENT_QUESTION_IDS.map((id) => [
      id,
      { value: id === "attack_weakened_away" ? 0.9 : 0.1, confidence: null },
    ]),
  ) as JudgmentAnswers;
}

const starters = (team: string, first?: string) =>
  Array.from({ length: 11 }, (_, i) => ({
    name: i === 0 && first ? first : `${team} ${i + 1}`,
  }));

const provider = {
  getStandings: vi.fn(),
  getLineups: vi.fn(),
  getTeamForm: vi.fn(),
  getUpcomingTeamFixtures: vi.fn(),
  getTopScorers: vi.fn(),
};
const absences = vi.fn();
const CAPS = {
  name: "mock",
  supportsInjuries: true,
  supportsLineups: true,
  supportsAbsences: true,
  supportedLeagues: new Set(["brasileirao_a"]),
};

function parentJudgments(): PredictionJudgments {
  return {
    engine: "code_jev",
    applied: true,
    answers: answers(),
    multipliers: null,
    lambda: {
      source: "dixon_coles",
      degraded: false,
      rho: -0.05,
      base: { home: 1.7, away: 1.3 },
      adjusted: { home: 1.7, away: 1.3 },
    },
    versions: {
      judgments: "jev_judgments_v3",
      weights: "judgment_weights_v1",
      narrator: "narrator_v1.4",
      jevModel: "jev-1.13.0",
    },
    failure: null,
    stateHash: "parent-hash",
    aiCallId: null,
    reusedFromPredictionId: null,
    lineup: { status: "not_announced", home: null, away: null },
  };
}

async function insertSnapshot(line: number, over: string, under: string, capturedAt: Date) {
  await realDb.insert(schema.selectionOddsSnapshots).values(
    [
      { selectionId: ids.over, odd: over },
      { selectionId: ids.under, odd: under },
    ].map((s) => ({
      matchId,
      marketId: ids.ouMarketId,
      selectionId: s.selectionId,
      marketParams: { line },
      odd: s.odd,
      overroundPct: "4.00",
      bookmaker: line === 2.5 ? "Casa Nova" : "Casa da Linha 3,5",
      capturedAt,
    })),
  );
}

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
  const [u] = await realDb
    .insert(schema.users)
    .values({ email: "recheck-e2e@pglite.test", allowed: true })
    .returning({ id: schema.users.id });
  userId = u.id;
  const [ou] = await realDb
    .select({ id: schema.markets.id })
    .from(schema.markets)
    .where(eq(schema.markets.key, "over_under"));
  ids.ouMarketId = ou.id;
  const sels = await realDb
    .select({ id: schema.marketSelections.id, key: schema.marketSelections.key })
    .from(schema.marketSelections)
    .where(eq(schema.marketSelections.marketId, ids.ouMarketId));
  ids.over = sels.find((s) => s.key === "over")!.id;
  ids.under = sels.find((s) => s.key === "under")!.id;
}, 60_000);

afterAll(async () => {
  __setSportsDataProviderForTesting(undefined);
  __setAbsencesProviderForTesting(undefined);
  await client.close();
});

beforeEach(async () => {
  vi.stubEnv("KV_REST_API_URL", "");
  vi.stubEnv("KV_REST_API_TOKEN", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  NOW = new Date();

  for (const fn of Object.values(provider)) fn.mockReset();
  provider.getStandings.mockResolvedValue(standings());
  provider.getTeamForm.mockResolvedValue([]);
  provider.getUpcomingTeamFixtures.mockResolvedValue([]);
  provider.getTopScorers.mockResolvedValue([]);
  // Escalação saiu: o desfalcado "em dúvida" está entre os titulares de hoje.
  provider.getLineups.mockResolvedValue({
    fixtureId: "f-1",
    home: { team: HOME, starters: starters(HOME, PLAYER) },
    away: { team: AWAY, starters: starters(AWAY) },
  });
  absences.mockReset();
  absences.mockResolvedValue({
    home: [{ player: { name: PLAYER }, type: "injury", status: "doubtful" }],
    away: [],
  });
  __setSportsDataProviderForTesting({
    capabilities: CAPS,
    ...provider,
  } as unknown as SportsDataProvider);
  __setAbsencesProviderForTesting({
    capabilities: CAPS,
    getAbsencesByFixture: absences,
    getAbsencesByTeam: vi.fn(),
  } as never);
  judge.mockReset();
  judge.mockResolvedValue({
    answers: answers(),
    model: "jev-1.13.0",
    inputTokens: 1500,
    latencyMs: 110,
    requestPayload: { model: "jev-1.13.0" },
    responsePayload: { answers: {} },
  });

  await realDb.delete(schema.predictionSelectionOdds);
  await realDb.delete(schema.predictions);
  await realDb.delete(schema.aiCalls);
  await realDb.delete(schema.selectionOddsSnapshots);
  await realDb.delete(schema.matches);
  await realDb.update(schema.aiConfig).set({ enableLineupRecheck: true });

  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: `ext-recheck-e2e-${NOW.getTime()}`,
      league: "brasileirao_a",
      homeTeam: HOME,
      awayTeam: AWAY,
      kickoffAt: new Date(NOW.getTime() + 40 * MIN),
      status: "scheduled",
    })
    .returning({ id: schema.matches.id });
  matchId = m.id;
  const [ac] = await realDb
    .insert(schema.aiCalls)
    .values({
      userId,
      matchId,
      model: "claude-sonnet-5-5",
      promptVersion: "narrator_v1.4",
      inputPayload: {},
      outputPayload: {},
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      costUsd: "0.001000",
    })
    .returning({ id: schema.aiCalls.id });
  parentAiCallId = ac.id;
});

afterEach(async () => {
  // Nenhuma fronteira paga, em nenhum caminho.
  expect(anthropicCreate).not.toHaveBeenCalled();
  expect(getOddsProvider).not.toHaveBeenCalled();
  expect(ensureOddsSnapshotsFresh).not.toHaveBeenCalled();
  expect(rateLimit).not.toHaveBeenCalled();
  await releaseKvLock(LINEUP_RECHECK_LOCK_KEY);
  await releaseKvLock(lineupRecheckMarkerKey(matchId));
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function insertParent(): Promise<string> {
  const [p] = await realDb
    .insert(schema.predictions)
    .values({
      matchId,
      userId,
      aiCallId: parentAiCallId,
      marketId: ids.ouMarketId,
      selectionId: null,
      marketParams: { line: 2.5 },
      recommendation: "pass",
      confidencePct: "52.00",
      rationale: "antes da escalação",
      keyFactors: ["f"],
      bookmaker: "Casa Antiga",
      stakeUnits: "1.00",
      modelVersion: MODEL_VERSION,
      promptVersion: "narrator_v1.4",
      judgments: parentJudgments(),
    })
    .returning({ id: schema.predictions.id });
  // created_at com microssegundos (o JS só enxerga ms): a guarda de corrida precisa
  // reconhecer o próprio pai.
  await client.query(
    `UPDATE predictions SET created_at = $2::timestamptz + interval '456 microseconds' WHERE id = $1`,
    [p.id, new Date(NOW.getTime() - 10 * 60 * MIN).toISOString()],
  );
  await realDb.insert(schema.predictionSelectionOdds).values([
    { predictionId: p.id, selectionId: ids.over, odd: "1.950", modelProbPct: "52.00" },
    { predictionId: p.id, selectionId: ids.under, odd: "1.900", modelProbPct: "48.00" },
  ]);
  return p.id;
}

describe("runLineupRechecks de ponta a ponta (predict real)", () => {
  it("grava a reconferência pela porta do predict, com as odds da linha do pai", async () => {
    const parentId = await insertParent();
    const snapshotAt = new Date(NOW.getTime() - 5 * MIN);
    await insertSnapshot(2.5, "2.100", "1.750", snapshotAt);
    // Linha vizinha mais recente: o predicado da linha não pode misturá-la.
    await insertSnapshot(3.5, "3.400", "1.300", new Date(NOW.getTime() - MIN));

    expect((await getLineupRecheckCandidates({ now: NOW })).map((c) => c.prediction.id)).toEqual(
      [parentId],
    );

    const summary = await runLineupRechecks({ now: NOW });
    expect(summary).toMatchObject({
      candidates: 1,
      matches: 1,
      persisted: 1,
      uninformative: 0,
      jevFailed: 0,
      errors: 0,
      oddsFromParent: 0,
      parentsSkipped: { superseded: 0, no_odds: 0, kickoff_passed: 0 },
    });
    // Uma chamada JEV (de sistema), uma sonda + a escalação do state.
    expect(judge).toHaveBeenCalledTimes(1);

    const rows = await realDb
      .select()
      .from(schema.predictions)
      .where(eq(schema.predictions.matchId, matchId));
    expect(rows).toHaveLength(2);
    const parent = rows.find((r) => r.id === parentId)!;
    const recheck = rows.find((r) => r.id !== parentId)!;

    // O pai é imutável.
    expect(parent.rationale).toBe("antes da escalação");
    expect(parent.judgments?.recheck).toBeUndefined();

    const [jevCall] = await realDb
      .select()
      .from(schema.aiCalls)
      .where(isNull(schema.aiCalls.userId));
    expect(jevCall.promptVersion).toBe("jev_judgments_v3");

    expect(recheck).toMatchObject({
      userId,
      marketId: ids.ouMarketId,
      marketParams: { line: 2.5 },
      bookmaker: "Casa Nova",
      isLive: false,
      modelVersion: `${MODEL_VERSION};recheck=lineup_v1`,
      // A chamada JEV deste run (de sistema), nunca a narradora do pai.
      aiCallId: jevCall.id,
    });
    expect(recheck.judgments).toMatchObject({
      engine: "code_jev",
      applied: true,
      narration: "lineup_recheck_template",
      aiCallId: jevCall.id,
      lambda: { source: "dixon_coles", base: { home: 1.7, away: 1.3 }, rho: -0.05 },
      lineup: {
        status: "announced",
        home: { changes: null, leftOut: 0 },
        away: { changes: null, leftOut: 0 },
      },
      recheck: {
        kind: "lineup",
        version: "lineup_v1",
        of: parentId,
        parentStateHash: "parent-hash",
        oddsFrom: "snapshot",
        oddsCapturedAt: snapshotAt.toISOString(),
        before: { recommendation: "pass", line: 2.5, confidencePct: 52, edgePct: null },
      },
    });
    expect(recheck.keyFactors.join(" ")).toContain(
      "1 jogador listado como desfalque está entre os titulares",
    );
    if (recheck.recommendation !== "pass") {
      expect(recheck.oddAtRecommendation).toBe(
        recheck.recommendation === "over" ? "2.100" : "1.750",
      );
    }

    // PSO: as duas seleções com as odds da captura da linha 2,5 (não as da 3,5).
    const pso = await realDb
      .select()
      .from(schema.predictionSelectionOdds)
      .where(eq(schema.predictionSelectionOdds.predictionId, recheck.id));
    expect(Object.fromEntries(pso.map((r) => [r.selectionId, r.odd]))).toEqual({
      [ids.over]: "2.100",
      [ids.under]: "1.750",
    });
    const probSum = pso.reduce((acc, r) => acc + Number(r.modelProbPct), 0);
    expect(probSum).toBeCloseTo(100, 0);

    // LGPD: o nome do jogador em nada gravado.
    expect(JSON.stringify(recheck)).not.toContain("Zézinho");

    // O pai deixou de ser candidato (DISTINCT ON: a reconferência é a mais nova).
    expect(await getLineupRecheckCandidates({ now: NOW })).toEqual([]);
    const again = await runLineupRechecks({ now: NOW });
    expect(again).toMatchObject({ candidates: 0, persisted: 0 });
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("sem captura recente no banco: odds congeladas do próprio pai", async () => {
    const parentId = await insertParent();
    const summary = await runLineupRechecks({ now: NOW });
    expect(summary).toMatchObject({ persisted: 1, oddsFromParent: 1, errors: 0 });
    const [recheck] = await realDb
      .select()
      .from(schema.predictions)
      .where(eq(schema.predictions.matchId, matchId))
      .then((rows) => rows.filter((r) => r.id !== parentId));
    expect(recheck.bookmaker).toBe("Casa Antiga");
    expect(recheck.judgments?.recheck).toMatchObject({
      oddsFrom: "parent",
      oddsCapturedAt: null,
    });
    const pso = await realDb
      .select()
      .from(schema.predictionSelectionOdds)
      .where(eq(schema.predictionSelectionOdds.predictionId, recheck.id));
    expect(Object.fromEntries(pso.map((r) => [r.selectionId, r.odd]))).toEqual({
      [ids.over]: "1.950",
      [ids.under]: "1.900",
    });
  });
});
