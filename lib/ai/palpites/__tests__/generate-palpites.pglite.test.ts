// @vitest-environment node
//
// Write path REAL de generatePalpites contra Postgres via pglite (WASM): a
// sequência parent→child SEM transação (neon-http), settleable correto, e as DUAS
// assimetrias de partial-write (ai_call falha → set sobrevive com aiCallId=null;
// palpite_set falha → throw sem órfãos). Roda em `node` (pglite falha sob jsdom).
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
vi.mock("@/lib/db/queries/ai-config", () => ({
  getGenerationParams: (...args: unknown[]) => getGenerationParams(...args),
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

import { generatePalpites, PalpiteError } from "@/lib/ai/palpites";
import type { MarketAnalysisSummary } from "@/lib/ai/palpites/synthesis-input";
import { getPalpiteSetsForMatch } from "@/lib/db/queries/palpites";

const ids: { userId: string; matchId: string } = {} as never;

const analyses: MarketAnalysisSummary[] = [
  {
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
    predictionId: "00000000-0000-0000-0000-000000000abc",
    selections: [
      { key: "home", modelProbPct: 58 },
      { key: "draw", modelProbPct: 24 },
      { key: "away", modelProbPct: 18 },
    ],
  },
];

const validToolInput = {
  verdict: "Vai dar Flamengo",
  probableScore: { home: 2, away: 1 },
  firstHalfScore: { home: 1, away: 0 },
  firstToScore: "home",
  confidence: "alta",
  narrative: "O Fla vem voando em casa.",
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
    .values({ email: "gen@pglite.test", role: "user", allowed: true })
    .returning({ id: schema.users.id });
  ids.userId = u.id;

  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: "ext-gen-1",
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: new Date("2026-05-15T19:00:00Z"),
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
  hasKey.mockReset();
  hasKey.mockReturnValue(true);
  getFixtureByMatch.mockResolvedValue(
    fixture("CR Flamengo", "Fluminense FC", 0, 0),
  );
  getTeamForm.mockResolvedValue([fixture("CR Flamengo", "X", 2, 0)]);
  getH2H.mockResolvedValue([]);
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

afterEach(() => {
  failInsertTables.clear();
  vi.restoreAllMocks();
});

const call = (over?: Partial<Parameters<typeof generatePalpites>[0]>) =>
  generatePalpites({
    matchId: ids.matchId,
    userId: ids.userId,
    analyses,
    modelOverride: "claude-haiku-4-5",
    ...over,
  });

describe("generatePalpites (síntese) — write path real (pglite)", () => {
  it("ok: 1 set com headline + linhas settleable em batch (#354), aiCallId não-null", async () => {
    runAnalysis.mockResolvedValue(okResult(validToolInput));
    const res = await call();
    expect(res.aiCall).not.toBeNull();

    const sets = await getPalpiteSetsForMatch(ids.matchId, ids.userId);
    expect(sets).toHaveLength(1);
    expect(sets[0].aiCall).not.toBeNull();
    expect(sets[0].aiCall?.status).toBe("ok");
    // headline jsonb persistido (round-trip via Postgres real).
    expect(sets[0].palpiteSet.headline).toEqual({
      verdict: "Vai dar Flamengo",
      confidence: "alta",
      narrative: "O Fla vem voando em casa.",
      citedMarkets: ["Resultado (1X2)"],
      sourcePredictionIds: ["00000000-0000-0000-0000-000000000abc"],
    });
    // 2-1, HT 1-0, home 1º → exact_score + first_half_score + first_to_score
    // (margin pula <2; clean_sheet pula — away marcou). Nada de red_card/corners.
    const lines = sets[0].palpites;
    const byType = new Map(lines.map((l) => [l.type, l]));
    expect(new Set(byType.keys())).toEqual(
      new Set(["exact_score", "first_half_score", "first_to_score"]),
    );
    const exact = byType.get("exact_score")!;
    expect(exact.settleable).toBe(true);
    expect(exact.params).toEqual({ home: 2, away: 1 });
    expect(byType.get("first_half_score")!.params).toEqual({ home: 1, away: 0 });
    expect(byType.get("first_to_score")!.params).toEqual({ firstToScore: "home" });
  });

  it("assimetria: ai_call falha → set sobrevive com aiCallId=null", async () => {
    runAnalysis.mockResolvedValue(okResult(validToolInput));
    // Força SÓ o insert de ai_calls a rejeitar (o resto passa pro pglite real).
    failInsertTables.add(schema.aiCalls);

    const res = await call();
    // O set sobrevive; aiCall do retorno é null.
    expect(res.aiCall).toBeNull();

    const sets = await getPalpiteSetsForMatch(ids.matchId, ids.userId);
    expect(sets).toHaveLength(1);
    expect(sets[0].palpiteSet.aiCallId).toBeNull();
    expect(sets[0].aiCall).toBeNull();
    // As linhas settleable ainda foram escritas (batch).
    expect(sets[0].palpites.length).toBeGreaterThanOrEqual(1);
    expect(sets[0].palpites.some((l) => l.type === "exact_score")).toBe(true);
  });

  it("assimetria: palpite_set falha → throw, NENHUMA row órfã", async () => {
    runAnalysis.mockResolvedValue(okResult(validToolInput));
    failInsertTables.add(schema.palpiteSets);

    await expect(call()).rejects.toBeInstanceOf(PalpiteError);

    // Nenhum set, nenhuma linha órfã. (O ai_call OK pode ter sido escrito — é
    // auditoria do custo, não um órfão de domínio.)
    const sets = await getPalpiteSetsForMatch(ids.matchId, ids.userId);
    expect(sets).toHaveLength(0);
    const orphanLines = await realDb.select().from(schema.palpites);
    expect(orphanLines).toHaveLength(0);
  });
});
