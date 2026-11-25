// @vitest-environment node
//
// Fase de notícias do cron da base (#672, PLAN-672 §3 + ajustes 1, 2, 6, 7 e 8) contra
// Postgres REAL (pglite, migrations reais). Mocks só nas fronteiras de rede: RSS do ge
// (getNewsViaTeamFeeds; canonicalUrl real), extração Haiku (extractNewsClaims),
// provider esportivo, desfalques e JEV (TypeSafe). Nenhuma chamada real.
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
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
import type { NewsExtractResult } from "@/lib/ai/match-news/extract";
import type { NewsClaim } from "@/lib/match-news/types";
import type { TeamFeedsOutcome } from "@/lib/providers/news/ge-rss";
import type { NewsResult } from "@/lib/providers/news/types";
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

// RSS do ge: a fronteira de rede da fase. canonicalUrl segue real.
const feeds = vi.fn<(...args: unknown[]) => Promise<TeamFeedsOutcome>>();
vi.mock("@/lib/providers/news/ge-rss", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers/news/ge-rss")>()),
  getNewsViaTeamFeeds: (...args: unknown[]) => feeds(...args),
}));

// Extração Haiku (match_news_extract_v1): a fronteira de LLM da fase.
const extract = vi.fn<(...args: unknown[]) => Promise<NewsExtractResult>>();
vi.mock("@/lib/ai/match-news/extract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/match-news/extract")>()),
  extractNewsClaims: (...args: unknown[]) => extract(...args),
}));

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({ messages: { create: vi.fn() } }),
}));
vi.mock("@/lib/calibration/kelly-live", () => ({
  isKellyStakingActive: () => Promise.resolve(false),
}));

import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import { getLatestMatchModelSnapshot } from "@/lib/db/queries/match-model-snapshots";
import {
  COMPUTE_MATCH_MODELS_LOCK_KEY,
  computeMatchModels,
} from "@/lib/model-base/compute-match-models";
import { canFitCall } from "@/lib/ai/deadline";
import { UTILITY_EFFORT } from "@/lib/ai/models";
import {
  EXTRACT_CALL_CAP_MS,
  NEWS_EXTRACT_MAX_ATTEMPTS,
  NEWS_PHASE_BUDGET_MS,
} from "@/lib/model-base/news-phase";
import { matchModelJudgmentsSchema } from "@/lib/model-base/types";
import { __setAbsencesProviderForTesting } from "@/lib/providers/absences";
import { canonicalUrl } from "@/lib/providers/news/ge-rss";
import { __setSportsDataProviderForTesting } from "@/lib/providers/sports-data";
import { resetDixonColesFlagMemo } from "@/lib/ratings/model-scoreline";
import { releaseKvLock } from "@/lib/sync/lock";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BR = ["CR Flamengo", "Fluminense FC", "SE Palmeiras", "SC Corinthians"];
const HOUR = 3_600_000;
let NOW: Date;
const inHours = (h: number) => new Date(NOW.getTime() + h * HOUR);

const split = (played: number, goalsFor: number, goalsAgainst: number) => ({
  played,
  wins: 0,
  draws: 0,
  losses: 0,
  goalsFor,
  goalsAgainst,
});

function standings(league: SupportedLeague): NormalizedStanding {
  return {
    league,
    season: 2026,
    tables: [
      {
        teams: BR.map((team, i) => ({
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

// JEV: só o ataque do visitante enfraquecido; o resto "não".
function jevAnswers(): JudgmentAnswers {
  return Object.fromEntries(
    JUDGMENT_QUESTION_IDS.map((id) => [
      id,
      { value: id === "attack_weakened_away" ? 0.9 : 0.1, confidence: null },
    ]),
  ) as JudgmentAnswers;
}

const jevResult = () => ({
  answers: jevAnswers(),
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
  getUpcomingTeamFixtures: vi.fn(),
  getTopScorers: vi.fn(),
};
const absences = vi.fn();
const CAPS = {
  name: "mock",
  supportsInjuries: true,
  supportsLineups: true,
  supportsAbsences: true,
  supportedLeagues: new Set<SupportedLeague>(["brasileirao_a"]),
};

function ge(slug: string, title: string, hoursAgo: number, snippet = "Linha fina da matéria."): NewsResult {
  return {
    title,
    url: `https://ge.globo.com/futebol/times/flamengo/noticia/2026/11/${slug}.ghtml`,
    snippet,
    publishedAt: new Date(NOW.getTime() - hoursAgo * HOUR).toISOString(),
    source: "ge",
  };
}

function okFeeds(
  home: NewsResult[],
  away: NewsResult[] = [],
  over: Partial<Extract<TeamFeedsOutcome, { kind: "ok" }>> = {},
): TeamFeedsOutcome {
  return {
    kind: "ok",
    results: [...home, ...away],
    partial: false,
    unknownOpponent: false,
    sideByUrl: Object.fromEntries([
      ...home.map((r) => [canonicalUrl(r.url), "home"] as const),
      ...away.map((r) => [canonicalUrl(r.url), "away"] as const),
    ]),
    failedSides: [],
    ...over,
  };
}

// Desfalque do mandante fora da nossa lista (vazia) → não conferível, sinal pelo papel
// (attack_weakened_home 0,7 > JEV 0,1: move o fator).
function absenceClaim(sources: string[] = ["N1"]): NewsClaim {
  return {
    team: "home",
    topic: "absence",
    text: "atacante titular fora",
    players: ["Fulano de Tal"],
    role: "attack",
    sources,
  } as NewsClaim;
}

const okExtract = (claims: NewsClaim[] = [absenceClaim()]): NewsExtractResult => ({
  ok: true,
  claims,
  warnings: [],
  aiCallId: null,
});

const A1 = () => ge("a1", "Flamengo perde atacante para o clássico", 2);
const A2 = () => ge("a2", "Fluminense treina com novidades no meio", 3);
const B1 = () => ge("b1", "Técnico do Fluminense fala sobre o clássico", 4);

let seq = 0;
async function insertMatch(kickoffAt: Date): Promise<string> {
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: `news-${++seq}`,
      league: "brasileirao_a",
      homeTeam: BR[0],
      awayTeam: BR[1],
      kickoffAt,
      status: "scheduled",
    })
    .returning({ id: schema.matches.id });
  return m.id;
}

const snapshotsOf = (matchId: string) =>
  realDb
    .select()
    .from(schema.matchModelSnapshots)
    .where(eq(schema.matchModelSnapshots.matchId, matchId));
const batchesOf = (matchId: string) =>
  realDb
    .select()
    .from(schema.matchNewsBatches)
    .where(eq(schema.matchNewsBatches.matchId, matchId));
const newsOf = (matchId: string) =>
  realDb.select().from(schema.matchNews).where(eq(schema.matchNews.matchId, matchId));

const run = (now: Date = NOW) => computeMatchModels({ now, leagues: ["brasileirao_a"] });

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
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
  provider.getStandings.mockImplementation((league: SupportedLeague) =>
    Promise.resolve(standings(league)),
  );
  provider.getTeamForm.mockResolvedValue([]);
  provider.getLineups.mockResolvedValue(undefined);
  provider.getUpcomingTeamFixtures.mockResolvedValue([]);
  provider.getTopScorers.mockResolvedValue([]);
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
  feeds.mockReset();
  feeds.mockResolvedValue(okFeeds([A1(), A2()]));
  extract.mockReset();
  extract.mockResolvedValue(okExtract());
  resetDixonColesFlagMemo();

  await realDb.delete(schema.matchModelSnapshots);
  await realDb.delete(schema.matchNewsBatches);
  await realDb.delete(schema.matchNews);
  await realDb.delete(schema.aiCalls);
  await realDb.delete(schema.matches);
  await realDb.delete(schema.teamRatings);
  await realDb.delete(schema.teamRatingFits);
  await realDb.update(schema.aiConfig).set({
    enableMatchModelJev: true,
    enableDixonColes: true,
    analysisEngine: "llm",
    enableNewsFactors: true,
  });
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

// ─── Testes ──────────────────────────────────────────────────────────────────

describe("idempotência do lote", () => {
  it("2 runs com os mesmos feeds: 1 extração, 1 row da base + heartbeat, match_news estável", async () => {
    const id = await insertMatch(inHours(24));
    const first = await run();

    expect(first.newsEnabled).toBe(true);
    expect(first.news).toMatchObject({
      targets: 1,
      feedsOk: 1,
      itemsNew: 2,
      batchesNew: 1,
      extracted: 1,
      reusedBatches: 0,
      matchesWithEvidence: 1,
      movedFactors: 1,
    });
    expect(extract).toHaveBeenCalledTimes(1);
    const [row] = await snapshotsOf(id);
    const [batch] = await batchesOf(id);
    expect(batch).toMatchObject({ status: "ok", attempts: 1, partial: false });
    // λ do mandante = base × (JEV ∨ notícia); answers/applied SÓ do JEV (D4).
    expect(row.lambdaHome).toBeLessThan(row.lambdaHomeBase);
    expect(row.judgments?.answers).toEqual(jevAnswers());
    expect(row.judgments?.applied).toBe(true);
    expect(row.judgments?.news).toMatchObject({
      batchId: batch.id,
      itemsRead: 2,
      moved: ["attack_weakened_home"],
      evidence: { attack_weakened_home: 0.7 },
    });
    // Texto e jogadores da afirmação só internos: o jsonb da base guarda o conferido.
    expect(JSON.stringify(row.judgments?.news)).not.toContain("Fulano");
    expect(JSON.stringify(row.judgments?.news)).not.toContain("atacante titular fora");
    expect(matchModelJudgmentsSchema.parse(row.judgments).news?.batchId).toBe(batch.id);

    const later = new Date(NOW.getTime() + HOUR);
    const second = await run(later);
    expect(second).toMatchObject({ inserted: 0, unchanged: 1 });
    expect(second.news).toMatchObject({ itemsNew: 0, batchesNew: 0, extracted: 0, reusedBatches: 1 });
    // JEV reusado do snapshot com notícia: answers seguem só do JEV.
    expect(second.jev.reused).toBe(1);
    expect(judge).toHaveBeenCalledTimes(1);
    expect(extract).toHaveBeenCalledTimes(1);
    const rows = await snapshotsOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].checkedAt.getTime()).toBe(later.getTime());
    expect(rows[0].judgments?.answers).toEqual(jevAnswers());
    const batches = await batchesOf(id);
    expect(batches).toHaveLength(1);
    expect(batches[0].checkedAt.getTime()).toBe(later.getTime());
    expect(await newsOf(id)).toHaveLength(2);
  });

  it("notícia nova → 2ª extração e lote novo; row nova só quando evidência/fontes mudam", async () => {
    const id = await insertMatch(inHours(24));
    await run();
    feeds.mockResolvedValue(okFeeds([A1(), A2(), B1()]));
    // Mesma evidência, mesma fonte: lote novo, base só faz heartbeat.
    const second = await run(new Date(NOW.getTime() + HOUR));
    expect(extract).toHaveBeenCalledTimes(2);
    expect(second.news).toMatchObject({ itemsNew: 1, batchesNew: 1, extracted: 1 });
    expect(await batchesOf(id)).toHaveLength(2);
    expect(await snapshotsOf(id)).toHaveLength(1);

    // A notícia nova também move o fator: a URL citada muda → fingerprint muda.
    feeds.mockResolvedValue(
      okFeeds([A1(), A2(), B1(), ge("c1", "Flamengo confirma desfalque", 1)]),
    );
    extract.mockResolvedValue(okExtract([absenceClaim(["N1", "N4"])]));
    await run(new Date(NOW.getTime() + 2 * HOUR));
    expect(extract).toHaveBeenCalledTimes(3);
    const rows = await snapshotsOf(id);
    expect(rows).toHaveLength(2);
  });

  it("a mesma URL com ?utm não duplica nem re-extrai", async () => {
    const id = await insertMatch(inHours(24));
    await run();
    const utm = { ...A1(), url: `${A1().url}?utm_source=rss#topo` };
    feeds.mockResolvedValue(okFeeds([utm, A2()]));
    const second = await run(new Date(NOW.getTime() + HOUR));
    expect(second.news).toMatchObject({ itemsNew: 0, reusedBatches: 1 });
    expect(extract).toHaveBeenCalledTimes(1);
    expect(await newsOf(id)).toHaveLength(2);
  });

  it("a mesma URL com título novo atualiza match_news e re-extrai", async () => {
    const id = await insertMatch(inHours(24));
    await run();
    feeds.mockResolvedValue(
      okFeeds([{ ...A1(), title: "Flamengo perde atacante e meia para o clássico" }, A2()]),
    );
    await run(new Date(NOW.getTime() + HOUR));
    expect(extract).toHaveBeenCalledTimes(2);
    const news = await newsOf(id);
    expect(news).toHaveLength(2);
    expect(news.map((n) => n.title)).toContain("Flamengo perde atacante e meia para o clássico");
    expect(await batchesOf(id)).toHaveLength(2);
  });
});

describe("feed robusto (ajuste 2)", () => {
  it("todos os feeds falharam: o lote anterior fica e a base não muda", async () => {
    const id = await insertMatch(inHours(24));
    await run();
    const [before] = await snapshotsOf(id);
    feeds.mockResolvedValue({ kind: "all_failed" });
    const second = await run(new Date(NOW.getTime() + HOUR));
    expect(second.news.feedsFailed).toBe(1);
    expect(second).toMatchObject({ inserted: 0, unchanged: 1 });
    const rows = await snapshotsOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].fingerprint).toBe(before.fingerprint);
    expect(rows[0].judgments?.news?.batchId).toBe(before.judgments?.news?.batchId);
  });

  it("feed de um lado expira (partial): itens desse lado vêm de match_news; lote, evidência e fingerprint iguais", async () => {
    const id = await insertMatch(inHours(24));
    feeds.mockResolvedValue(okFeeds([A1(), A2()], [B1()]));
    await run();
    const [before] = await snapshotsOf(id);
    const [batchBefore] = await batchesOf(id);

    feeds.mockResolvedValue(
      okFeeds([A1(), A2()], [], { partial: true, failedSides: ["away"] }),
    );
    const second = await run(new Date(NOW.getTime() + HOUR));
    expect(extract).toHaveBeenCalledTimes(1);
    expect(second.news).toMatchObject({ reusedBatches: 1, batchesNew: 0, feedsFailed: 1 });
    const batches = await batchesOf(id);
    expect(batches).toHaveLength(1);
    expect(batches[0].id).toBe(batchBefore.id);
    const rows = await snapshotsOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].fingerprint).toBe(before.fingerprint);
    expect(rows[0].judgments?.news?.evidence).toEqual(before.judgments?.news?.evidence);
  });

  it("partial: a matéria prioritária do lado que caiu fica (ordem do lote, não published_at); hash igual (review #682)", async () => {
    const id = await insertMatch(inHours(24));
    // P: prioritária e mais velha que as outras do visitante (o ranking do ge a pôs no lote).
    const P = () => ge("p", "Fluminense confirma desfalque do capitão", 30);
    const X = (n: number, h: number) => ge(`x${n}`, `Fluminense: bastidor ${n}`, h);
    feeds.mockResolvedValue(okFeeds([A1(), A2()], [P(), X(1, 10), X(2, 9), X(3, 8), X(4, 7)]));
    await run();
    // 2º run: X4 saiu do feed, X5 (mais nova) entrou → lote novo com P.
    feeds.mockResolvedValue(okFeeds([A1(), A2()], [P(), X(1, 10), X(2, 9), X(3, 8), X(5, 1)]));
    await run(new Date(NOW.getTime() + HOUR));
    expect(extract).toHaveBeenCalledTimes(2);
    const second = (await batchesOf(id)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    expect(second.items.map((i) => i.url)).toContain(canonicalUrl(P().url));

    // 3º run: o feed do visitante cai. Os 5 itens mais novos guardados do visitante
    // seriam X5, X4, X3, X2, X1 (sem P): outro hash e nova extração. Do último lote: o mesmo.
    feeds.mockResolvedValue(okFeeds([A1(), A2()], [], { partial: true, failedSides: ["away"] }));
    const third = await run(new Date(NOW.getTime() + 2 * HOUR));
    expect(third.news).toMatchObject({ reusedBatches: 1, batchesNew: 0, extracted: 0 });
    expect(extract).toHaveBeenCalledTimes(2);
    const batches = await batchesOf(id);
    expect(batches).toHaveLength(2);
    expect(batches.find((b) => b.id === second.id)?.checkedAt.getTime()).toBe(
      NOW.getTime() + 2 * HOUR,
    );
  });

  it("feed ok sem item: lote empty sem chamada e sem notícia na base", async () => {
    const id = await insertMatch(inHours(24));
    feeds.mockResolvedValue(okFeeds([]));
    const summary = await run();
    expect(extract).not.toHaveBeenCalled();
    expect(summary.news).toMatchObject({ empty: 1, batchesNew: 1, extracted: 0 });
    const [batch] = await batchesOf(id);
    expect(batch.status).toBe("empty");
    const [row] = await snapshotsOf(id);
    expect(row.judgments?.news).toBeUndefined();
  });

  it("empty + adversário desconhecido não é usável: a base segue no último lote ok", async () => {
    const id = await insertMatch(inHours(24));
    await run();
    const [before] = await snapshotsOf(id);
    feeds.mockResolvedValue(okFeeds([], [], { unknownOpponent: true }));
    await run(new Date(NOW.getTime() + HOUR));
    const batches = await batchesOf(id);
    expect(batches.find((b) => b.status === "empty")?.unknownOpponent).toBe(true);
    const rows = await snapshotsOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].judgments?.news?.batchId).toBe(before.judgments?.news?.batchId);
  });
});

describe("extração que falha ou estoura o prazo (ajuste 6)", () => {
  it(`falha: no máximo ${NEWS_EXTRACT_MAX_ATTEMPTS} tentativas por lote, base sem notícia`, async () => {
    const id = await insertMatch(inHours(24));
    extract.mockResolvedValue({ ok: false, kind: "failed", message: "zod", aiCallId: null });
    const first = await run();
    expect(first.news.extractFailed).toBe(1);
    let [batch] = await batchesOf(id);
    expect(batch).toMatchObject({ status: "failed", attempts: 1 });
    expect((await snapshotsOf(id))[0].judgments?.news).toBeUndefined();

    await run(new Date(NOW.getTime() + HOUR));
    [batch] = await batchesOf(id);
    expect(batch.attempts).toBe(2);
    await run(new Date(NOW.getTime() + 2 * HOUR));
    expect(extract).toHaveBeenCalledTimes(NEWS_EXTRACT_MAX_ATTEMPTS);
    expect(await batchesOf(id)).toHaveLength(1);
  });

  it("falha depois de um lote ok: devolve o último lote usável (não null)", async () => {
    const id = await insertMatch(inHours(24));
    await run();
    const [before] = await snapshotsOf(id);
    feeds.mockResolvedValue(okFeeds([A1(), A2(), B1()]));
    extract.mockResolvedValue({ ok: false, kind: "failed", message: "boom", aiCallId: null });
    await run(new Date(NOW.getTime() + HOUR));
    const rows = await snapshotsOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].judgments?.news?.batchId).toBe(before.judgments?.news?.batchId);
  });

  it("estouro de prazo não grava failed nem gasta tentativa; o run seguinte extrai", async () => {
    const id = await insertMatch(inHours(24));
    extract.mockResolvedValueOnce({
      ok: false,
      kind: "deadline",
      message: "sem tempo",
      aiCallId: null,
    });
    const first = await run();
    expect(first.news).toMatchObject({ skippedDeadline: 1, extractFailed: 0 });
    expect(await batchesOf(id)).toHaveLength(0);

    await run(new Date(NOW.getTime() + HOUR));
    expect(extract).toHaveBeenCalledTimes(2);
    const [batch] = await batchesOf(id);
    expect(batch).toMatchObject({ status: "ok", attempts: 1 });
    const latest = await getLatestMatchModelSnapshot(id);
    expect(latest?.judgments?.news?.batchId).toBe(batch.id);
  });
});

describe("mecânica do run (ajustes 1 e 6)", () => {
  it("flag OFF: nenhuma fase, nenhum feed, base de hoje", async () => {
    await realDb.update(schema.aiConfig).set({ enableNewsFactors: false });
    const id = await insertMatch(inHours(24));
    const summary = await run();
    expect(summary.newsEnabled).toBe(false);
    expect(summary.news.targets).toBe(0);
    expect(feeds).not.toHaveBeenCalled();
    expect(extract).not.toHaveBeenCalled();
    expect(await batchesOf(id)).toHaveLength(0);
    expect((await snapshotsOf(id))[0].judgments?.news).toBeUndefined();
  });

  it("jogo fora da janela do JEV ou sem feed do ge não é alvo", async () => {
    await insertMatch(inHours(72));
    const summary = await run();
    expect(summary.news.targets).toBe(0);
    expect(feeds).not.toHaveBeenCalled();
  });

  // Feed lento: prova que o run espera a fase (os itens estão gravados quando ele volta).
  const slowFeeds = () =>
    feeds.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(okFeeds([A1(), A2()])), 50)),
    );

  it("flag do JEV OFF: a fase lê e guarda os feeds, é aguardada, e não extrai (review #682)", async () => {
    await realDb.update(schema.aiConfig).set({ enableMatchModelJev: false });
    const id = await insertMatch(inHours(24));
    slowFeeds();
    const summary = await run();
    expect(summary.jev.queued).toBe(0);
    expect(summary.news).toMatchObject({ feedsOk: 1, itemsNew: 2, skippedNoJev: 1, extracted: 0 });
    expect(extract).not.toHaveBeenCalled();
    expect(await newsOf(id)).toHaveLength(2);
    expect(await batchesOf(id)).toHaveLength(0);
    const [row] = await snapshotsOf(id);
    expect(row.jevStatus).toBe("not_attempted");
    expect(row.judgments).toBeNull();
  });

  it("fila do JEV vazia (sem chave): a fase roda, é aguardada e não extrai", async () => {
    hasTypeSafeKey.mockReturnValue(false);
    hasKey.mockReturnValue(false);
    const id = await insertMatch(inHours(24));
    slowFeeds();
    const summary = await run();
    expect(summary.jev.queued).toBe(0);
    expect(summary.news.skippedNoJev).toBe(1);
    expect(extract).not.toHaveBeenCalled();
    expect(await newsOf(id)).toHaveLength(2);
    expect(await batchesOf(id)).toHaveLength(0);
  });

  it("prazo do JEV estourado: a base fica sem JEV, mas o lote é gravado", async () => {
    const id = await insertMatch(inHours(24));
    const realNow = Date.now;
    let t = realNow();
    vi.spyOn(Date, "now").mockImplementation(() => (t += 250_000));
    const summary = await run();
    vi.mocked(Date.now).mockRestore();
    expect(summary.jev.skippedDeadline).toBe(1);
    expect(judge).not.toHaveBeenCalled();
    expect(await batchesOf(id)).toHaveLength(1);
    expect((await snapshotsOf(id))[0].jevStatus).toBe("not_attempted");
  });

  it("jogos do JEV que começam depois do prazo da fase ainda recebem o lote pronto (review #682)", async () => {
    const ids = [await insertMatch(inHours(30)), await insertMatch(inHours(20)), await insertMatch(inHours(10))];
    // Cada JEV "leva" 55 s: o 2º e o 3º jogos esperam o lote com o teto já esgotado.
    const realNow = Date.now.bind(Date);
    let offset = 0;
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + offset);
    let firstJudge = true;
    judge.mockImplementation(async () => {
      if (firstJudge) {
        firstJudge = false;
        // A fase (toda mockada) termina antes de o relógio andar.
        while ((await realDb.select().from(schema.matchNewsBatches)).length < 3) {
          await new Promise((r) => setTimeout(r, 5));
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      offset += 55_000;
      return jevResult();
    });
    const summary = await run();
    vi.mocked(Date.now).mockRestore();
    expect(summary.jev).toMatchObject({ applied: 3, skippedDeadline: 0 });
    expect(summary.news).toMatchObject({ batchesNew: 3, matchesWithEvidence: 3 });
    for (const id of ids) {
      const [batch] = await batchesOf(id);
      const [row] = await snapshotsOf(id);
      expect(row.judgments?.news?.batchId).toBe(batch.id);
      // A base viu o lote: checked_at ≥ quando ele ficou usável (a fila não o repete).
      expect(row.checkedAt.getTime()).toBeGreaterThanOrEqual(batch.usableAt!.getTime());
    }
  });

  it("alvos da fase em ordem de kickoff; extração com o prazo da fase e o teto de 30 s (review #682)", async () => {
    const late = await insertMatch(inHours(40));
    const early = await insertMatch(inHours(5));
    const before = Date.now();
    await run();
    const order = feeds.mock.calls.map((c) => (c[1] as { matchId: string }).matchId);
    expect(order).toEqual([early, late]);
    const [extractArgs] = extract.mock.calls[0] as [{ deadlineAt: number; maxCallMs: number }];
    expect(extractArgs.maxCallMs).toBe(EXTRACT_CALL_CAP_MS);
    expect(EXTRACT_CALL_CAP_MS).toBeGreaterThan(20_000);
    // O prazo passado é o da fase (início do run + 45 s), não "agora + teto": o
    // canFitCall real ainda deixa a chamada passar depois de 20 s de fila.
    expect(extractArgs.deadlineAt).toBeGreaterThanOrEqual(before + NEWS_PHASE_BUDGET_MS);
    expect(extractArgs.deadlineAt).toBeLessThanOrEqual(Date.now() + NEWS_PHASE_BUDGET_MS);
    expect(
      canFitCall(
        extractArgs.deadlineAt,
        { speed: "fast", maxTokens: 4096, effort: UTILITY_EFFORT },
        extractArgs.deadlineAt - NEWS_PHASE_BUDGET_MS + 20_000,
      ),
    ).toBe(true);
  });

  it("nova tentativa que deu ok marca usable_at e a base gravada no run a cobre", async () => {
    const id = await insertMatch(inHours(24));
    extract.mockResolvedValueOnce({ ok: false, kind: "failed", message: "zod", aiCallId: null });
    await run();
    let [batch] = await batchesOf(id);
    expect(batch.usableAt).toBeNull();
    const later = new Date(NOW.getTime() + HOUR);
    await run(later);
    [batch] = await batchesOf(id);
    expect(batch).toMatchObject({ status: "ok", attempts: 2 });
    expect(batch.usableAt!.getTime()).toBeGreaterThanOrEqual(later.getTime());
    expect(batch.createdAt.getTime()).toBe(NOW.getTime());
    const latest = await getLatestMatchModelSnapshot(id);
    expect(latest?.judgments?.news?.batchId).toBe(batch.id);
    expect(latest!.checkedAt.getTime()).toBeGreaterThanOrEqual(batch.usableAt!.getTime());
  });

  it("feed que lança não derruba o run nem conta erro", async () => {
    const id = await insertMatch(inHours(24));
    feeds.mockRejectedValue(new Error("boom"));
    const summary = await run();
    expect(summary.errors).toBe(0);
    const [row] = await snapshotsOf(id);
    expect(row.jevStatus).toBe("applied");
    expect(row.judgments?.news).toBeUndefined();
  });
});

describe("leitura da base com notícia (ajuste 8)", () => {
  it("news malformado no jsonb não derruba os julgamentos nem a base", async () => {
    const id = await insertMatch(inHours(24));
    await run();
    const [row] = await snapshotsOf(id);
    await realDb
      .update(schema.matchModelSnapshots)
      .set({
        judgments: { ...row.judgments!, news: { batchId: 42, evidence: "x" } as never },
      })
      .where(eq(schema.matchModelSnapshots.id, row.id));
    const snap = await getLatestMatchModelSnapshot(id);
    expect(snap).not.toBeNull();
    expect(snap?.judgments?.answers).toEqual(jevAnswers());
    expect(snap?.judgments?.news).toBeUndefined();
  });

  it("ida e volta: o snapshot com notícia lido pela query traz o news validado", async () => {
    const id = await insertMatch(inHours(24));
    await run();
    const snap = await getLatestMatchModelSnapshot(id);
    expect(snap?.judgments?.news?.moved).toEqual(["attack_weakened_home"]);
    expect(snap?.judgments?.news?.versions.newsEvidence).toBe("news_evidence_v1");
  });
});
