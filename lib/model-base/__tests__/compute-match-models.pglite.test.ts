// @vitest-environment node
//
// Cron da base do modelo por jogo (#555, ADR 0052) contra Postgres REAL (pglite, com as
// migrations reais). Mocks só nas fronteiras de rede: provider esportivo, desfalques,
// JEV (TypeSafe) e Anthropic (narrador do predict no teste de paridade).
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
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
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
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

// JEV: o JudgmentProvider é a fronteira de rede (api.typesafe.ai).
const judge = vi.fn();
const hasKey = vi.fn(() => true);
vi.mock("@/lib/ai/judgments/provider", () => ({
  createTypeSafeJudgmentProvider: () => ({
    hasKey: () => hasKey(),
    judge: (...args: unknown[]) => judge(...args),
  }),
}));
const hasTypeSafeKey = vi.fn(() => true);
vi.mock("@/lib/ai/providers/typesafe/client", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/ai/providers/typesafe/client")
  >()),
  hasTypeSafeKey: () => hasTypeSafeKey(),
}));

// Liga cuja leitura de jogos lança (o resto usa a query real).
const failingLeagues = new Set<string>();
vi.mock("@/lib/db/queries/matches", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/lib/db/queries/matches")>();
  return {
    ...real,
    getMatchesInLeagueWindow: (
      args: Parameters<typeof real.getMatchesInLeagueWindow>[0],
    ) =>
      failingLeagues.has(args.league)
        ? Promise.reject(new Error("league read failed"))
        : real.getMatchesInLeagueWindow(args),
  };
});

// Narrador do predict (teste de paridade).
const anthropicCreate = vi.fn();
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({ messages: { create: anthropicCreate } }),
}));
vi.mock("@/lib/calibration/kelly-live", () => ({
  isKellyStakingActive: () => Promise.resolve(false),
}));

import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import { predict } from "@/lib/ai/predict";
import {
  COMPUTE_MATCH_MODELS_LOCK_KEY,
  computeMatchModels,
} from "@/lib/model-base/compute-match-models";
import { __setAbsencesProviderForTesting } from "@/lib/providers/absences";
import { __setSportsDataProviderForTesting } from "@/lib/providers/sports-data";
import { resetDixonColesFlagMemo } from "@/lib/ratings/model-scoreline";
import { acquireKvLock, releaseKvLock } from "@/lib/sync/lock";
import { resetAnalysisEngineMemo } from "@/lib/ai/engine/analysis-engine-flag";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BR = ["CR Flamengo", "Fluminense FC", "SE Palmeiras", "SC Corinthians"];
const ES = ["Real Madrid", "FC Barcelona"];

const split = (played: number, goalsFor: number, goalsAgainst: number) => ({
  played,
  wins: 0,
  draws: 0,
  losses: 0,
  goalsFor,
  goalsAgainst,
});

function standingsFor(league: SupportedLeague, teams: string[]): NormalizedStanding {
  return {
    league,
    season: 2026,
    tables: [
      {
        teams: teams.map((team, i) => ({
          position: i + 1,
          team,
          played: 12,
          won: 6,
          draw: 3,
          lost: 3,
          goalsFor: 18 - i,
          goalsAgainst: 12 + i,
          points: 21 - i,
          homeSplit: split(6, 10 - i, 5 + i),
          awaySplit: split(6, 8 - i, 7 + i),
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

const jevResult = () => ({
  answers: answers(),
  model: "jev-1.13.0",
  inputTokens: 1500,
  latencyMs: 110,
  requestPayload: { model: "jev-1.13.0" },
  responsePayload: { answers: {} },
});

const provider = {
  getFixturesByDate: vi.fn(),
  getFixturesBySeason: vi.fn(),
  getFixtureByMatch: vi.fn(),
  getFixtureResult: vi.fn(),
  getFixtureEvents: vi.fn(),
  getH2H: vi.fn(),
  getStandings: vi.fn(),
  getInjuriesByFixture: vi.fn(),
  getInjuriesByTeam: vi.fn(),
  getLineups: vi.fn(),
  getTeamForm: vi.fn(),
};
const absences = vi.fn();

const CAPS = {
  name: "mock",
  supportsInjuries: true,
  supportsLineups: true,
  supportsAbsences: true,
  supportedLeagues: new Set<SupportedLeague>(["brasileirao_a", "la_liga"]),
};

const HOUR = 3_600_000;
let NOW: Date;
const inHours = (h: number) => new Date(NOW.getTime() + h * HOUR);

let userId: string;

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
  const [u] = await realDb
    .insert(schema.users)
    .values({ email: "base@pglite.test", role: "admin", allowed: true })
    .returning({ id: schema.users.id });
  userId = u.id;
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
  failingLeagues.clear();
  for (const fn of Object.values(provider)) fn.mockReset();
  provider.getStandings.mockImplementation((league: SupportedLeague) =>
    Promise.resolve(standingsFor(league, league === "la_liga" ? ES : BR)),
  );
  provider.getTeamForm.mockResolvedValue([]);
  provider.getLineups.mockResolvedValue(undefined);
  absences.mockReset();
  absences.mockResolvedValue({ home: [], away: [] });
  __setSportsDataProviderForTesting({
    capabilities: CAPS,
    ...provider,
  } as unknown as SportsDataProvider);
  __setAbsencesProviderForTesting({
    capabilities: CAPS,
    getAbsencesByFixture: absences,
    getAbsencesByTeam: vi.fn(),
  });
  judge.mockReset();
  judge.mockResolvedValue(jevResult());
  hasKey.mockReturnValue(true);
  hasTypeSafeKey.mockReturnValue(true);
  resetDixonColesFlagMemo();

  await realDb.delete(schema.predictionSelectionOdds);
  await realDb.delete(schema.predictions);
  await realDb.delete(schema.aiCalls);
  await realDb.delete(schema.matchModelSnapshots);
  await realDb.delete(schema.selectionOddsSnapshots);
  await realDb.delete(schema.matches);
  await realDb.delete(schema.teamRatings);
  await realDb.delete(schema.teamRatingFits);
  await realDb
    .update(schema.aiConfig)
    .set({ enableMatchModelJev: true, enableDixonColes: true, analysisEngine: "llm" });

  // Fit fresco do Brasileirão com os quatro times (≥10 jogos cada); La Liga sem fit.
  await realDb.insert(schema.teamRatingFits).values({
    league: "brasileirao_a",
    homeAdvantage: 1.25,
    rho: -0.06,
    matchCount: 900,
    seasons: [2026, 2025],
    fittedAt: new Date(NOW.getTime() - HOUR),
  });
  await realDb.insert(schema.teamRatings).values(
    BR.map((team, i) => ({
      league: "brasileirao_a" as const,
      team,
      attack: 1.3 - i * 0.1,
      defence: 0.9 + i * 0.05,
      matches: 40,
    })),
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await releaseKvLock(COMPUTE_MATCH_MODELS_LOCK_KEY);
});

let seq = 0;
async function insertMatch(
  league: SupportedLeague,
  home: string,
  away: string,
  kickoffAt: Date,
  status: (typeof schema.matchStatusEnum.enumValues)[number] = "scheduled",
): Promise<string> {
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: `ext-${++seq}`,
      league,
      homeTeam: home,
      awayTeam: away,
      kickoffAt,
      status,
    })
    .returning({ id: schema.matches.id });
  return m.id;
}

const snapshotsOf = (matchId: string) =>
  realDb
    .select()
    .from(schema.matchModelSnapshots)
    .where(eq(schema.matchModelSnapshots.matchId, matchId));

// ─── Testes ──────────────────────────────────────────────────────────────────

describe("λ da base", () => {
  it("fit fresco → dixon_coles, sem buscar a tabela (jogo fora da janela JEV)", async () => {
    const id = await insertMatch("brasileirao_a", BR[0], BR[1], inHours(72));
    const summary = await computeMatchModels({
      now: NOW,
      leagues: ["brasileirao_a"],
    });

    expect(summary).toMatchObject({ considered: 1, inserted: 1, errors: 0 });
    expect(provider.getStandings).not.toHaveBeenCalled();
    expect(judge).not.toHaveBeenCalled();
    const [row] = await snapshotsOf(id);
    expect(row.lambdaSource).toBe("dixon_coles");
    expect(row.rho).toBe(-0.06);
    expect(row.jevStatus).toBe("not_attempted");
  });

  it("sem fit → heurístico da tabela com fallbackReason no_fit", async () => {
    const id = await insertMatch("la_liga", ES[0], ES[1], inHours(72));
    await computeMatchModels({ now: NOW, leagues: ["la_liga"] });

    expect(provider.getStandings).toHaveBeenCalledTimes(1);
    const [row] = await snapshotsOf(id);
    expect(row.lambdaSource).toBe("heuristic");
    expect(row.lambdaFallbackReason).toBe("no_fit");
    expect(row.rho).toBeNull();
  });

  it("jogo live/finished/passado fica de fora", async () => {
    const live = await insertMatch("brasileirao_a", BR[0], BR[1], inHours(1), "live");
    const fin = await insertMatch("brasileirao_a", BR[2], BR[3], inHours(2), "finished");
    const past = await insertMatch("brasileirao_a", BR[1], BR[2], inHours(-1));
    const summary = await computeMatchModels({
      now: NOW,
      leagues: ["brasileirao_a"],
    });
    expect(summary.considered).toBe(0);
    for (const id of [live, fin, past]) {
      expect(await snapshotsOf(id)).toHaveLength(0);
    }
  });

  it("liga que lança não derruba as outras", async () => {
    failingLeagues.add("la_liga");
    const id = await insertMatch("brasileirao_a", BR[0], BR[1], inHours(72));
    const summary = await computeMatchModels({
      now: NOW,
      leagues: ["la_liga", "brasileirao_a"],
    });
    expect(summary.errors).toBe(1);
    expect(summary.leagues).toEqual([
      { league: "la_liga", matches: 0, error: true },
      { league: "brasileirao_a", matches: 1, error: false },
    ]);
    expect(await snapshotsOf(id)).toHaveLength(1);
  });
});

describe("JEV da base", () => {
  it("jogo a +72h → JEV não chamado", async () => {
    await insertMatch("brasileirao_a", BR[0], BR[1], inHours(72));
    const summary = await computeMatchModels({
      now: NOW,
      leagues: ["brasileirao_a"],
    });
    expect(judge).not.toHaveBeenCalled();
    expect(summary.jev.queued).toBe(0);
  });

  it("flag OFF (+24h) → JEV não chamado, not_attempted", async () => {
    await realDb.update(schema.aiConfig).set({ enableMatchModelJev: false });
    const id = await insertMatch("brasileirao_a", BR[0], BR[1], inHours(24));
    const summary = await computeMatchModels({
      now: NOW,
      leagues: ["brasileirao_a"],
    });
    expect(summary.jevEnabled).toBe(false);
    expect(judge).not.toHaveBeenCalled();
    const [row] = await snapshotsOf(id);
    expect(row.jevStatus).toBe("not_attempted");
  });

  it("flag ON (+24h) → judgments gravados e ai_calls com user_id null; 2º run igual só faz heartbeat e reusa o JEV", async () => {
    const id = await insertMatch("brasileirao_a", BR[0], BR[1], inHours(24));
    const first = await computeMatchModels({
      now: NOW,
      leagues: ["brasileirao_a"],
    });
    expect(first.jev).toMatchObject({ queued: 1, applied: 1, reused: 0 });
    expect(judge).toHaveBeenCalledTimes(1);

    const [row] = await snapshotsOf(id);
    expect(row.jevStatus).toBe("applied");
    expect(row.judgments?.applied).toBe(true);
    expect(row.lambdaAway).toBeLessThan(row.lambdaAwayBase);
    const calls = await realDb
      .select()
      .from(schema.aiCalls)
      .where(eq(schema.aiCalls.matchId, id));
    expect(calls).toHaveLength(1);
    expect(calls[0].userId).toBeNull();
    expect(calls[0].provider).toBe("typesafe");
    expect(row.judgments?.aiCallId).toBe(calls[0].id);

    const later = new Date(NOW.getTime() + HOUR);
    const second = await computeMatchModels({
      now: later,
      leagues: ["brasileirao_a"],
    });
    expect(second).toMatchObject({ inserted: 0, unchanged: 1 });
    expect(second.jev.reused).toBe(1);
    expect(judge).toHaveBeenCalledTimes(1);
    const rows = await snapshotsOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].checkedAt.getTime()).toBe(later.getTime());
    expect(rows[0].computedAt.getTime()).toBe(row.computedAt.getTime());
  });

  it("predição recente com o mesmo stateHash → JEV não chamado, base aponta pra predição", async () => {
    const id = await insertMatch("brasileirao_a", BR[0], BR[1], inHours(24));
    await computeMatchModels({ now: NOW, leagues: ["brasileirao_a"] });
    const [first] = await snapshotsOf(id);
    const stateHash = first.judgments!.stateHash;

    await realDb.delete(schema.matchModelSnapshots);
    const [call] = await realDb
      .insert(schema.aiCalls)
      .values({
        userId,
        matchId: id,
        provider: "anthropic",
        model: "claude-sonnet-4-5-20250929",
        promptVersion: "narrator_v1",
        inputPayload: {},
        outputPayload: {},
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
        costUsd: "0.000001",
      })
      .returning({ id: schema.aiCalls.id });
    const [pred] = await realDb
      .insert(schema.predictions)
      .values({
        matchId: id,
        userId,
        aiCallId: call.id,
        recommendation: "pass",
        confidencePct: "50.00",
        rationale: "r",
        keyFactors: ["a"],
        modelVersion: "m",
        promptVersion: "narrator_v1",
        judgments: {
          engine: "code_jev",
          applied: true,
          answers: answers(),
          multipliers: null,
          lambda: {
            source: "dixon_coles",
            degraded: false,
            rho: -0.06,
            base: { home: 1, away: 1 },
            adjusted: { home: 1, away: 1 },
          },
          versions: {
            judgments: "jev_judgments_v1",
            weights: "judgment_weights_v1",
            narrator: "narrator_v1",
            jevModel: "jev-1.13.0",
            jevModelServed: "jev-1.13.0",
          },
          failure: null,
          stateHash,
          aiCallId: "call-pred",
          reusedFromPredictionId: null,
        },
      })
      .returning({ id: schema.predictions.id });
    judge.mockClear();

    await computeMatchModels({ now: NOW, leagues: ["brasileirao_a"] });
    expect(judge).not.toHaveBeenCalled();
    const [row] = await snapshotsOf(id);
    expect(row.judgments?.reusedFromPredictionId).toBe(pred.id);
    expect(row.judgments?.aiCallId).toBe("call-pred");
  });

  it("sem chave TypeSafe → nenhuma busca de dados do JEV, not_attempted, sem ai_calls, um warn por run", async () => {
    hasTypeSafeKey.mockReturnValue(false);
    hasKey.mockReturnValue(false);
    const warn = vi.mocked(console.warn);
    const a = await insertMatch("brasileirao_a", BR[0], BR[1], inHours(10));
    const b = await insertMatch("brasileirao_a", BR[2], BR[3], inHours(20));
    const summary = await computeMatchModels({
      now: NOW,
      leagues: ["brasileirao_a"],
    });

    expect(summary.jevMissingKey).toBe(true);
    expect(summary.jev).toMatchObject({ queued: 0, skippedMissingKey: 2 });
    expect(provider.getTeamForm).not.toHaveBeenCalled();
    expect(provider.getLineups).not.toHaveBeenCalled();
    expect(absences).not.toHaveBeenCalled();
    expect(judge).not.toHaveBeenCalled();
    for (const id of [a, b]) {
      const [row] = await snapshotsOf(id);
      expect(row.jevStatus).toBe("not_attempted");
    }
    expect(await realDb.select().from(schema.aiCalls)).toHaveLength(0);
    const missingKeyWarns = warn.mock.calls.filter((c) =>
      String(c[0]).includes("jev_skipped_missing_key"),
    );
    expect(missingKeyWarns).toHaveLength(1);
  });

  it("prazo estourado: jogo sem base ganha base sem JEV; jogo com última row applied fica intocado", async () => {
    const fresh = await insertMatch("brasileirao_a", BR[0], BR[1], inHours(10));
    const withJev = await insertMatch("brasileirao_a", BR[2], BR[3], inHours(20));
    // 1º run sem prazo: as duas ganham JEV.
    await computeMatchModels({ now: NOW, leagues: ["brasileirao_a"] });
    await realDb
      .delete(schema.matchModelSnapshots)
      .where(eq(schema.matchModelSnapshots.matchId, fresh));
    // O refit mexeu no λ: a base sem JEV acompanha, a com JEV não é rebaixada.
    await realDb
      .update(schema.teamRatingFits)
      .set({ homeAdvantage: 1.3 })
      .where(eq(schema.teamRatingFits.league, "brasileirao_a"));
    const [before] = await snapshotsOf(withJev);
    judge.mockClear();

    const realNow = Date.now;
    let t = realNow();
    vi.spyOn(Date, "now").mockImplementation(() => (t += 250_000));
    const summary = await computeMatchModels({
      now: NOW,
      leagues: ["brasileirao_a"],
    });
    vi.mocked(Date.now).mockRestore();

    expect(summary.jev.skippedDeadline).toBe(2);
    expect(judge).not.toHaveBeenCalled();
    const [freshRow] = await snapshotsOf(fresh);
    expect(freshRow.jevStatus).toBe("not_attempted");
    const after = await snapshotsOf(withJev);
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(before);
  });

  it("lock ocupado → skipped: locked, sem tocar provider nem DB", async () => {
    await insertMatch("brasileirao_a", BR[0], BR[1], inHours(10));
    expect(await acquireKvLock(COMPUTE_MATCH_MODELS_LOCK_KEY)).toBe(true);
    const summary = await computeMatchModels({
      now: NOW,
      leagues: ["brasileirao_a"],
    });
    expect(summary.skipped).toBe("locked");
    expect(provider.getStandings).not.toHaveBeenCalled();
    expect(provider.getTeamForm).not.toHaveBeenCalled();
    expect(await realDb.select().from(schema.matchModelSnapshots)).toHaveLength(0);
  });
});

describe("paridade cron → predict", () => {
  it("o predict em code_jev reusa as respostas da base: JEV chamado 1× no total", async () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    resetAnalysisEngineMemo();
    await realDb.update(schema.aiConfig).set({ analysisEngine: "code_jev" });
    const id = await insertMatch("brasileirao_a", BR[0], BR[1], inHours(24));

    await computeMatchModels({ now: NOW, leagues: ["brasileirao_a"] });
    expect(judge).toHaveBeenCalledTimes(1);
    const [snap] = await snapshotsOf(id);

    // Odds 1X2 frescas pra o predict (lidas do banco, sem The Odds API).
    const [market] = await realDb
      .select({ id: schema.markets.id })
      .from(schema.markets)
      .where(eq(schema.markets.key, "match_result"));
    const sels = await realDb
      .select({ id: schema.marketSelections.id, key: schema.marketSelections.key })
      .from(schema.marketSelections)
      .where(and(eq(schema.marketSelections.marketId, market.id)));
    const odd: Record<string, string> = { home: "2.600", draw: "3.400", away: "2.900" };
    await realDb.insert(schema.selectionOddsSnapshots).values(
      sels.map((s) => ({
        matchId: id,
        marketId: market.id,
        selectionId: s.id,
        bookmaker: "Pinnacle",
        odd: odd[s.key],
        overroundPct: "4.00",
      })),
    );
    provider.getFixtureByMatch.mockResolvedValue({
      id: "fx",
      league: "brasileirao_a",
      kickoffAt: inHours(24).toISOString(),
      kickoffTimestampMs: inHours(24).getTime(),
      homeTeam: BR[0],
      awayTeam: BR[1],
      status: "scheduled",
      score: { home: null, away: null },
      venue: "Maracanã",
    });
    provider.getH2H.mockResolvedValue([]);
    anthropicCreate.mockResolvedValue({
      id: "msg-1",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "tool_use",
      stop_sequence: null,
      content: [
        {
          type: "tool_use",
          id: "tu-1",
          name: "submit_narration",
          input: {
            rationale:
              "O CR Flamengo chega melhor e o modelo de placar vê o mandante na frente.",
            key_factors: ["Ataque forte em casa", "Defesa sólida"],
          },
        },
      ],
      usage: { input_tokens: 900, output_tokens: 200 },
    });

    const result = await predict({
      matchId: id,
      userId,
      isAdmin: true,
      marketKey: "match_result",
    });

    expect(judge).toHaveBeenCalledTimes(1);
    expect(result.prediction.judgments?.reusedFromModelSnapshotId).toBe(snap.id);
    expect(result.prediction.judgments?.reusedFromPredictionId).toBeNull();
    expect(result.prediction.judgments?.stateHash).toBe(snap.judgments?.stateHash);
  });
});
