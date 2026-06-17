// @vitest-environment node
//
// Settlement de scorer/assist (#290) contra Postgres REAL via pglite. Exercita a
// spine skip-over-wrong-settle de settle.ts (fetch extra de getFixtureEvents
// per-match, merge via spread sem re-parse, regra event-backed) e o ROUND-TRIP:
// o resultData persistido CONTÉM scorers[] + eventsAvailable (C8 — não basta o
// computeSettlement retornar won/lost). Seed o mercado scorer aqui (migration 0031
// não existe neste commit).
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
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

import { __setSportsDataProviderForTesting } from "@/lib/providers/sports-data";
import type {
  FixtureRef,
  NormalizedFixtureEvents,
  NormalizedFixtureResult,
  SportsDataProvider,
} from "@/lib/providers/sports-data/types";
import { settlePendingPredictions } from "@/lib/settlement/settle";

const ids: {
  userId: string;
  scorerMarketId: string;
  selPedro: string;
  selArrascaeta: string;
} = {} as never;

const KICKOFF = new Date("2026-05-15T19:00:00Z");
const NOW = new Date("2026-05-16T00:00:00Z");

async function seedMatch(externalId: string): Promise<string> {
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId,
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: KICKOFF,
    })
    .returning({ id: schema.matches.id });
  return m.id;
}

async function seedAiCall(matchId: string): Promise<string> {
  const [c] = await realDb
    .insert(schema.aiCalls)
    .values({
      userId: ids.userId,
      matchId,
      model: "stub",
      promptVersion: "anytime_scorer_v1",
      inputPayload: {},
      outputPayload: {},
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      costUsd: "0",
    })
    .returning({ id: schema.aiCalls.id });
  return c.id;
}

async function seedScorerPrediction(args: {
  matchId: string;
  aiCallId: string;
  recommendation: string;
  selectionId: string;
}): Promise<string> {
  const [p] = await realDb
    .insert(schema.predictions)
    .values({
      matchId: args.matchId,
      userId: ids.userId,
      aiCallId: args.aiCallId,
      marketId: ids.scorerMarketId,
      selectionId: args.selectionId,
      marketParams: null,
      recommendation: args.recommendation,
      confidencePct: "52",
      rationale: "stub",
      keyFactors: ["stub"],
      oddAtRecommendation: "2.500",
      stakeUnits: "1",
      modelVersion: "stub",
      promptVersion: "anytime_scorer_v1",
    })
    .returning({ id: schema.predictions.id });
  return p.id;
}

function installProvider(opts: {
  events?: (ref: FixtureRef) => NormalizedFixtureEvents | undefined;
  eventsThrows?: boolean;
}): void {
  __setSportsDataProviderForTesting({
    getFixtureResult: vi.fn(
      async (): Promise<NormalizedFixtureResult> => ({
        status: "finished",
        regulationScore: { home: 2, away: 1 },
      }),
    ),
    getFixtureEvents: vi.fn(async (ref: FixtureRef) => {
      if (opts.eventsThrows) throw new Error("provider down");
      return opts.events ? opts.events(ref) : undefined;
    }),
  } as unknown as SportsDataProvider);
}

beforeAll(async () => {
  client = new PGlite();
  const base = drizzle(client, { schema, casing: "snake_case" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (base as any).batch = async (qs: unknown[]) => {
    const out: unknown[] = [];
    for (const q of qs) out.push(await q);
    return out;
  };
  realDb = base;
  await migrate(base, { migrationsFolder: "./db/migrations" });

  const [u] = await base
    .insert(schema.users)
    .values({ email: "scorer@example.com" })
    .returning({ id: schema.users.id });
  ids.userId = u.id;

  // anytime_scorer já é seedado pela migration 0031 (markets row, SEM seleções).
  const [m] = await base
    .select({ id: schema.markets.id })
    .from(schema.markets)
    .where(eq(schema.markets.key, "anytime_scorer"));
  ids.scorerMarketId = m.id;

  // As seleções por jogador crescem lazy em produção (ensureScorerSelections);
  // aqui o teste de settlement as cria diretamente.
  const sels = await base
    .insert(schema.marketSelections)
    .values([
      { marketId: m.id, key: "scorer_pedro", label: "Pedro" },
      { marketId: m.id, key: "scorer_arrascaeta", label: "Arrascaeta" },
    ])
    .returning({ id: schema.marketSelections.id, key: schema.marketSelections.key });
  ids.selPedro = sels.find((s) => s.key === "scorer_pedro")!.id;
  ids.selArrascaeta = sels.find((s) => s.key === "scorer_arrascaeta")!.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.predictionOutcomes);
  await realDb.delete(schema.predictions);
  await realDb.delete(schema.aiCalls);
  await realDb.delete(schema.matches);
});

afterEach(() => {
  __setSportsDataProviderForTesting(undefined);
  vi.restoreAllMocks();
});

function goal(
  name: string,
  over: Partial<NormalizedFixtureEvents["goals"][number]> = {},
): NormalizedFixtureEvents["goals"][number] {
  return {
    playerId: null,
    playerName: name,
    teamSide: "home",
    minute: 30,
    isPenalty: false,
    isOwnGoal: false,
    isRegulation: true,
    ...over,
  };
}

async function outcomeFor(predictionId: string) {
  const rows = await realDb
    .select()
    .from(schema.predictionOutcomes)
    .where(eq(schema.predictionOutcomes.predictionId, predictionId));
  return rows[0];
}

describe("settle scorer — real Postgres (pglite)", () => {
  it("WON + round-trip: resultData persistido CONTÉM scorers[] + eventsAvailable", async () => {
    const matchId = await seedMatch("ext-scorer-won");
    const aiCallId = await seedAiCall(matchId);
    const predId = await seedScorerPrediction({
      matchId,
      aiCallId,
      recommendation: "scorer_pedro",
      selectionId: ids.selPedro,
    });
    installProvider({
      events: () => ({
        fixtureStatus: "finished",
        eventsAvailable: true,
        goals: [goal("Pedro")],
        assists: [],
      }),
    });

    const s = await settlePendingPredictions(NOW);
    expect(s.settled).toBe(1);

    const o = await outcomeFor(predId);
    expect(o?.result).toBe("won");
    // C8: o jsonb persistido contém scorers[] + eventsAvailable (não só won/lost).
    expect(o?.resultData?.eventsAvailable).toBe(true);
    expect(o?.resultData?.scorers).toEqual([
      { playerId: null, canonicalName: "Pedro" },
    ]);
  });

  it("LOST quando o jogador recomendado não marcou", async () => {
    const matchId = await seedMatch("ext-scorer-lost");
    const aiCallId = await seedAiCall(matchId);
    const predId = await seedScorerPrediction({
      matchId,
      aiCallId,
      recommendation: "scorer_arrascaeta",
      selectionId: ids.selArrascaeta,
    });
    installProvider({
      events: () => ({
        fixtureStatus: "finished",
        eventsAvailable: true,
        goals: [goal("Pedro")],
        assists: [],
      }),
    });
    await settlePendingPredictions(NOW);
    expect((await outcomeFor(predId))?.result).toBe("lost");
  });

  it("PENDING (errors, sem outcome row) quando getFixtureEvents falha", async () => {
    const matchId = await seedMatch("ext-scorer-unavail");
    const aiCallId = await seedAiCall(matchId);
    const predId = await seedScorerPrediction({
      matchId,
      aiCallId,
      recommendation: "scorer_pedro",
      selectionId: ids.selPedro,
    });
    installProvider({ eventsThrows: true });
    const s = await settlePendingPredictions(NOW);
    expect(s.settled).toBe(0);
    expect(s.errors).toBeGreaterThanOrEqual(1);
    expect(await outcomeFor(predId)).toBeUndefined(); // fica pendente
  });

  it("own goals e gols de prorrogação NÃO creditam o autor (LOST se foi só isso)", async () => {
    const matchId = await seedMatch("ext-scorer-og-et");
    const aiCallId = await seedAiCall(matchId);
    const predId = await seedScorerPrediction({
      matchId,
      aiCallId,
      recommendation: "scorer_pedro",
      selectionId: ids.selPedro,
    });
    installProvider({
      events: () => ({
        fixtureStatus: "finished",
        eventsAvailable: true,
        // Pedro só fez gol contra (own) + um gol na prorrogação → não credita.
        goals: [
          goal("Pedro", { isOwnGoal: true }),
          goal("Pedro", { isRegulation: false, minute: 105 }),
        ],
        assists: [],
      }),
    });
    await settlePendingPredictions(NOW);
    const o = await outcomeFor(predId);
    expect(o?.result).toBe("lost");
    // own goal + ET foram filtrados → scorers vazio.
    expect(o?.resultData?.scorers).toEqual([]);
  });
});
