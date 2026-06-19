// @vitest-environment node
//
// Idempotência + concorrência das server actions de palpite (#315) contra pglite.
// generatePalpitesAction 2× → 1 set (2ª é no-op, provider chamado 1×); concorrência
// (Promise.all) documenta o comportamento observado (race aceito, sem UNIQUE no DB).
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import {
  afterAll,
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

// next/cache revalidatePath é no-op fora do request scope.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const authFn = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authFn() }));

const checkPalpitesRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkPalpitesRateLimit: (...a: unknown[]) => checkPalpitesRateLimit(...a),
}));

function fixture(home: string, away: string): NormalizedFixture {
  return {
    id: `${home}:${away}`,
    league: "brasileirao_a",
    kickoffAt: "2026-05-10T19:00:00.000Z",
    kickoffTimestampMs: Date.parse("2026-05-10T19:00:00.000Z"),
    homeTeam: home,
    awayTeam: away,
    status: "finished",
    score: { home: 1, away: 0 },
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

vi.mock("@/lib/db/queries/ai-config", () => ({
  getGenerationParams: vi.fn(() =>
    Promise.resolve({ maxTokens: 16000, effort: "high", temperature: 0.3 }),
  ),
}));

const runAnalysis = vi.fn();
const fakeProvider: AIProvider = {
  providerKey: "anthropic",
  hasKey: () => true,
  runAnalysis: (req: AnalysisRequest) => runAnalysis(req),
};
vi.mock("@/lib/ai/providers", () => ({
  getProviderForModel: vi.fn(() => fakeProvider),
}));

import {
  generatePalpitesAction,
  regeneratePalpitesAction,
} from "@/app/actions/palpites";
import { getPalpiteSetsForMatch } from "@/lib/db/queries/palpites";

const ids: { userId: string; matchId: string } = {} as never;

const validToolInput = {
  palpites: [
    { type: "exact_score", text: "2 a 1", params: { home: 2, away: 1 } },
    { type: "red_card", text: "vermelho!" },
  ],
};
function okResult(toolInput: unknown): AnalysisResult {
  return {
    ok: true,
    toolInput,
    usage: { inputTokens: 100, outputTokens: 50 },
    inputPayload: {},
    outputPayload: { content: [] },
    stopReason: "tool_use",
    latencyMs: 10,
  };
}

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });

  const [u] = await realDb
    .insert(schema.users)
    .values({ email: "action@pglite.test", role: "user", allowed: true })
    .returning({ id: schema.users.id });
  ids.userId = u.id;

  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: "ext-action-1",
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
  authFn.mockReset();
  authFn.mockResolvedValue({ user: { id: ids.userId, role: "user" } });
  checkPalpitesRateLimit.mockReset();
  checkPalpitesRateLimit.mockResolvedValue({ ok: true });
  runAnalysis.mockReset();
  runAnalysis.mockResolvedValue(okResult(validToolInput));
  getFixtureByMatch.mockResolvedValue(fixture("CR Flamengo", "Fluminense FC"));
  getTeamForm.mockResolvedValue([]);
  getH2H.mockResolvedValue([]);
  getStandings.mockResolvedValue({
    league: "brasileirao_a",
    season: 2026,
    tables: [{ teams: [] }],
  });
});

describe("generatePalpitesAction — idempotência", () => {
  it("2 chamadas sequenciais → 1 set, provider chamado 1× (0 token na 2ª)", async () => {
    const a = await generatePalpitesAction(ids.matchId);
    const b = await generatePalpitesAction(ids.matchId);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });

    const sets = await getPalpiteSetsForMatch(ids.matchId, ids.userId);
    expect(sets).toHaveLength(1);
    expect(runAnalysis).toHaveBeenCalledTimes(1);
  });

  it("falha silenciosa: erro de geração ainda retorna { ok: true }", async () => {
    runAnalysis.mockResolvedValue(okResult({ palpites: [] })); // inválido
    const res = await generatePalpitesAction(ids.matchId);
    expect(res).toEqual({ ok: true });
    const sets = await getPalpiteSetsForMatch(ids.matchId, ids.userId);
    expect(sets).toHaveLength(0);
  });

  it("rate-limit bloqueado → no-op silencioso (sem gasto, sem set)", async () => {
    checkPalpitesRateLimit.mockResolvedValue({ ok: false });
    const res = await generatePalpitesAction(ids.matchId);
    expect(res).toEqual({ ok: true });
    expect(runAnalysis).not.toHaveBeenCalled();
    const sets = await getPalpiteSetsForMatch(ids.matchId, ids.userId);
    expect(sets).toHaveLength(0);
  });

  it("sem login → no-op silencioso", async () => {
    authFn.mockResolvedValue(null);
    const res = await generatePalpitesAction(ids.matchId);
    expect(res).toEqual({ ok: true });
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  // Concorrência (PLAN §11): SEM UNIQUE(matchId,userId), duas chamadas simultâneas
  // sem ordenação do guard PODEM criar 2 sets (race aceito, teto de dano ~US$0.004).
  // Este teste DOCUMENTA o comportamento observado — não é um guard a corrigir.
  it("concorrência: Promise.all de 2 chamadas — documenta o race (≥1 set)", async () => {
    await Promise.all([
      generatePalpitesAction(ids.matchId),
      generatePalpitesAction(ids.matchId),
    ]);
    const sets = await getPalpiteSetsForMatch(ids.matchId, ids.userId);
    // Comportamento observado: o race PODE criar 1 ou 2 sets (sem UNIQUE no DB).
    expect(sets.length).toBeGreaterThanOrEqual(1);
    expect(sets.length).toBeLessThanOrEqual(2);
  });
});

describe("regeneratePalpitesAction — sem repetir", () => {
  it("gera um set novo passando os anteriores como exclusão; retorna setId", async () => {
    await generatePalpitesAction(ids.matchId); // 1º set
    runAnalysis.mockClear();
    const res = await regeneratePalpitesAction(ids.matchId);
    expect(res.ok).toBe(true);
    // O regen passou o set prévio como exclusão → o userMessage contém "Não repita".
    const req = runAnalysis.mock.calls[0][0] as AnalysisRequest;
    expect(req.userMessage).toContain("Não repita");

    const sets = await getPalpiteSetsForMatch(ids.matchId, ids.userId);
    expect(sets).toHaveLength(2); // regen cria set novo (sem guard de idempotência)
    if (res.ok) {
      expect(sets.map((s) => s.palpiteSet.id)).toContain(res.setId);
    }
  });

  it("rate-limit → { ok: false, error: 'rate' }", async () => {
    checkPalpitesRateLimit.mockResolvedValue({ ok: false });
    const res = await regeneratePalpitesAction(ids.matchId);
    expect(res).toEqual({ ok: false, error: "rate" });
  });

  it("erro de geração → { ok: false, error: 'generation_error' }", async () => {
    runAnalysis.mockResolvedValue(okResult({ palpites: [] }));
    const res = await regeneratePalpitesAction(ids.matchId);
    expect(res).toEqual({ ok: false, error: "generation_error" });
  });
});
