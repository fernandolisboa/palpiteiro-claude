// @vitest-environment node
//
// Palpite AO VIVO (#594): generateLivePalpites contra Postgres via pglite. O set grava
// is_live + o carimbo; só exact_score/margin/clean_sheet; placar provável abaixo do
// atual falha fechado; sem forma/confrontos/tabela nem notícias; e o
// set ao vivo convive com o de pré-jogo (os dois liquidam).
import { PGlite } from "@electric-sql/pglite";
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
  NormalizedFixture,
  ProviderCapabilities,
  SportsDataProvider,
} from "@/lib/providers/sports-data/types";
import type {
  AnalysisRequest,
  AnalysisResult,
  AIProvider,
} from "@/lib/ai/providers/types";

let realDb: PgliteDatabase<typeof schema>;
let client: PGlite;

// Tabela cujo ins() deve falhar no .returning() (injeção de partial-write). Como o
// `db` real é um Proxy (não dá pra vi.spyOn numa property dinâmica), o wrapper de
// `insert` consulta ESTE set e, batendo, devolve um stub que rejeita — todo o resto
// passa direto pro pglite real.
const failInsertTables = new Set<unknown>();

vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "insert") {
          return (table: unknown) => {
            if (failInsertTables.has(table)) {
              return {
                values: () => ({
                  returning: () =>
                    Promise.reject(new Error("forced insert failure")),
                }),
              };
            }
            return realDb.insert(table as never);
          };
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const v = (realDb as any)[prop];
        return typeof v === "function" ? v.bind(realDb) : v;
      },
    },
  ),
}));

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
// #380 — getEnableFidelityValidation mockado ON (default true). As fixtures deste suite
// são fidelity-clean: getH2H=[] (sem contagem de confronto) e validToolInput.narrative
// não cita contagem alguma → o validador default-ON aceita (não vira degrade silencioso).
const getEnableFidelityValidation = vi.fn(
  (..._args: unknown[]): Promise<boolean> => Promise.resolve(true),
);
vi.mock("@/lib/db/queries/ai-config", () => ({
  getGenerationParams: (...args: unknown[]) => getGenerationParams(...args),
  getEnableFidelityValidation: (...args: unknown[]) =>
    getEnableFidelityValidation(...args),
}));

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

// Provider de notícias (ADR 0032 / #377): mockado INERTE (sem notícia) — este teste
// foca na persistência real do palpite_set/palpites via pglite, não na busca de notícia
// (coberta no unit test do adapter). Não-mockar faria o adapter real chamar o seam
// mockado e consumir a fila de runAnalysis.
const getNewsByMatch = vi.fn(() =>
  Promise.resolve({ results: [], aiCall: null, unavailable: true }),
);
vi.mock("@/lib/providers/news", () => ({
  getNewsProvider: vi.fn(() => ({ getNewsByMatch })),
}));

import { generateLivePalpites, generatePalpites } from "@/lib/ai/palpites";
import { PALPITES_LIVE_VERSION } from "@/lib/ai/palpites/cartridges/live";
import type { MarketAnalysisSummary } from "@/lib/ai/palpites/synthesis-input";
import {
  getPalpiteSetsForMatch,
  getPendingPalpiteSettlements,
} from "@/lib/db/queries/palpites";
import { readLiveStamp } from "@/lib/live/stamp";
import { inPlayScoreline } from "@/lib/quant/in-play";
import { scorelineMatrix } from "@/lib/quant/scoreline-model";
import { eq } from "drizzle-orm";

const ids: { userId: string; matchId: string } = {} as never;
const NOW = new Date("2026-05-15T20:10:00.000Z");

const STATE = {
  statusShort: "2H",
  elapsed: 63,
  extra: null,
  minuteLabel: "63'",
  score: { home: 1, away: 0 },
  red: { home: 0, away: 0 },
  fetchedAt: new Date(NOW.getTime() - 20_000),
};

const SCORELINE = inPlayScoreline(
  {
    source: "dixon_coles",
    degraded: false,
    lambdaHome: 1.5,
    lambdaAway: 1.1,
    rho: -0.1,
    matrix: scorelineMatrix(1.5, 1.1, { rho: -0.1 }),
  },
  STATE,
)!;

const analyses: MarketAnalysisSummary[] = [
  {
    marketKey: "match_result",
    marketLabel: "Resultado (1X2)",
    recommendation: "pass",
    recommendedLabel: null,
    isPass: true,
    modelProbPct: null,
    edgePct: null,
    confidencePct: null,
    oddAtRecommendation: null,
    rationale: "Leitura ao vivo.",
    predictionId: "00000000-0000-0000-0000-000000000abc",
    selections: [
      { key: "home", modelProbPct: 70 },
      { key: "draw", modelProbPct: 20 },
      { key: "away", modelProbPct: 10 },
    ],
  },
];

const liveToolInput = {
  verdict: "O Flamengo segura a vantagem",
  probableScore: { home: 2, away: 0 },
  confidence: "media",
  narrative: "Aos 63', com 1 a 0 no placar, o Fla tem 70% de chance de vencer.",
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

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
  const [u] = await realDb
    .insert(schema.users)
    .values({ email: "live@pglite.test", role: "user", allowed: true })
    .returning({ id: schema.users.id });
  ids.userId = u.id;
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: "ext-live-1",
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: new Date("2026-05-15T19:00:00Z"),
      status: "live",
    })
    .returning({ id: schema.matches.id });
  ids.matchId = m.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.palpiteOutcomes);
  await realDb.delete(schema.palpites);
  await realDb.delete(schema.palpiteSets);
  await realDb.delete(schema.aiCalls);
  runAnalysis.mockReset();
  getTeamForm.mockReset();
  getH2H.mockReset();
  getStandings.mockReset();
  getFixtureByMatch.mockReset();
  getNewsByMatch.mockClear();
  hasKey.mockReturnValue(true);
  getGenerationParams.mockResolvedValue({
    maxTokens: 16000,
    effort: "high",
    temperature: 0.3,
  });
});

afterEach(() => {
  failInsertTables.clear();
});

const callLive = () =>
  generateLivePalpites({
    matchId: ids.matchId,
    userId: ids.userId,
    analyses,
    live: { state: STATE, scoreline: SCORELINE, moment: "aos 63'", now: NOW },
    modelOverride: "claude-haiku-4-5",
  });

describe("generateLivePalpites (palpites_live_v1) — pglite", () => {
  it("grava is_live + carimbo, versão ao vivo e só exact_score/margin/clean_sheet", async () => {
    runAnalysis.mockResolvedValue(okResult(liveToolInput));
    const res = await callLive();
    expect(res.palpiteSet.isLive).toBe(true);
    const stamp = readLiveStamp(res.palpiteSet.liveState);
    expect(stamp?.minuteLabel).toBe("63'");
    expect(stamp?.score).toEqual({ home: 1, away: 0 });

    const sets = await getPalpiteSetsForMatch(ids.matchId, ids.userId);
    expect(sets).toHaveLength(1);
    const types = new Set(sets[0].palpites.map((l) => l.type));
    // 2–0: exact_score + margin (vitória por 2+) + clean_sheet (visitante zerado).
    expect(types).toEqual(new Set(["exact_score", "margin", "clean_sheet"]));
    const call = await realDb
      .select()
      .from(schema.aiCalls)
      .where(eq(schema.aiCalls.id, res.aiCall!.id));
    expect(call[0].promptVersion).toBe(PALPITES_LIVE_VERSION);
  });

  it("não toca forma/confrontos/tabela nem notícias", async () => {
    runAnalysis.mockResolvedValue(okResult(liveToolInput));
    await callLive();
    expect(getTeamForm).not.toHaveBeenCalled();
    expect(getH2H).not.toHaveBeenCalled();
    expect(getStandings).not.toHaveBeenCalled();
    expect(getFixtureByMatch).not.toHaveBeenCalled();
    expect(getNewsByMatch).not.toHaveBeenCalled();
    const req = runAnalysis.mock.calls[0][0] as AnalysisRequest;
    expect(JSON.stringify(req)).toContain("Situação do jogo");
  });

  it("placar provável abaixo do atual falha fechado (o veredito foi escrito pra ele): invalid_output, sem set", async () => {
    runAnalysis.mockResolvedValue(
      okResult({ ...liveToolInput, probableScore: { home: 0, away: 0 } }),
    );
    await expect(callLive()).rejects.toThrow(/Zod/);
    expect(runAnalysis).toHaveBeenCalledTimes(1);
    expect(await getPalpiteSetsForMatch(ids.matchId, ids.userId)).toHaveLength(0);
    const calls = await realDb
      .select()
      .from(schema.aiCalls)
      .where(eq(schema.aiCalls.matchId, ids.matchId));
    expect(calls.map((c) => c.status)).toEqual(["invalid_output"]);
    expect(calls[0].errorMessage).toContain("abaixo do placar atual");
  });

  it("saída com campo de pré-jogo (firstHalfScore) é rejeitada pelo .strict()", async () => {
    runAnalysis.mockResolvedValue(
      okResult({ ...liveToolInput, firstHalfScore: { home: 1, away: 0 } }),
    );
    await expect(callLive()).rejects.toThrow();
    expect(await getPalpiteSetsForMatch(ids.matchId, ids.userId)).toHaveLength(0);
  });

  it("o set ao vivo não cobre o de pré-jogo: os dois ficam pendentes de liquidação", async () => {
    runAnalysis.mockResolvedValueOnce(
      okResult({
        verdict: "Vai dar Flamengo",
        probableScore: { home: 2, away: 1 },
        firstHalfScore: { home: 1, away: 0 },
        firstToScore: "home",
        confidence: "alta",
        narrative: "O Fla vem voando em casa.",
        citedMarkets: ["Resultado (1X2)"],
      }),
    );
    getFixtureByMatch.mockResolvedValue(fixture("CR Flamengo", "Fluminense FC", 0, 0));
    getTeamForm.mockResolvedValue([fixture("CR Flamengo", "X", 2, 0)]);
    getH2H.mockResolvedValue([]);
    getStandings.mockResolvedValue({
      league: "brasileirao_a",
      season: 2026,
      tables: [{ teams: [] }],
    });
    const pre = await generatePalpites({
      matchId: ids.matchId,
      userId: ids.userId,
      analyses,
      modelOverride: "claude-haiku-4-5",
    });
    runAnalysis.mockResolvedValueOnce(okResult(liveToolInput));
    const live = await callLive();
    const pending = await getPendingPalpiteSettlements(
      new Date("2026-06-01T00:00:00Z"),
    );
    const pendingIds = new Set(pending.map((p) => p.palpiteId));
    expect(pre.palpites.some((l) => pendingIds.has(l.id))).toBe(true);
    expect(live.palpites.some((l) => pendingIds.has(l.id))).toBe(true);
  });
});
