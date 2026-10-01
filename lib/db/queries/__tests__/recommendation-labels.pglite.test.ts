// @vitest-environment node
//
// #539: as queries do dashboard (lista + detalhe) e do feed de recentes juntam
// `market_selections` por selectionId pra a view mostrar "Casa" / o nome do
// jogador em vez da key crua. Postgres REAL (pglite) pra provar os LEFT JOINs:
// seleção presente, pass (selectionId null) e row legada sem marketId.
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
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
    }
  ),
}));

import {
  getPredictionDetailForUser,
  getUserDashboardRows,
} from "@/lib/db/queries/dashboard";
import { getRecentPredictionsByUser } from "@/lib/db/queries/predictions";

const ids: {
  userId: string;
  matchId: string;
  aiCallId: string;
  mrMarketId: string;
  mrHome: string;
  scorerMarketId: string;
  scorerPedro: string;
} = {} as never;

async function marketId(key: string): Promise<string> {
  const [m] = await realDb
    .select({ id: schema.markets.id })
    .from(schema.markets)
    .where(eq(schema.markets.key, key));
  return m.id;
}

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });

  const [u] = await realDb
    .insert(schema.users)
    .values({ email: "labels@pglite.test", role: "user", allowed: true })
    .returning({ id: schema.users.id });
  ids.userId = u.id;

  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: "ext-labels-1",
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: new Date("2026-09-20T19:00:00Z"),
    })
    .returning({ id: schema.matches.id });
  ids.matchId = m.id;

  const [ac] = await realDb
    .insert(schema.aiCalls)
    .values({
      userId: ids.userId,
      matchId: ids.matchId,
      provider: "anthropic",
      model: "claude-opus-4-8",
      promptVersion: "match_result_v1",
      inputPayload: {},
      outputPayload: {},
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 100,
      costUsd: "0.010000",
      status: "ok",
    })
    .returning({ id: schema.aiCalls.id });
  ids.aiCallId = ac.id;

  ids.mrMarketId = await marketId("match_result");
  const [home] = await realDb
    .select({ id: schema.marketSelections.id })
    .from(schema.marketSelections)
    .where(
      and(
        eq(schema.marketSelections.marketId, ids.mrMarketId),
        eq(schema.marketSelections.key, "home")
      )
    );
  ids.mrHome = home.id;

  // Seleções de jogador são materializadas lazy no predict (0031 não as seeda).
  ids.scorerMarketId = await marketId("anytime_scorer");
  const [pedro] = await realDb
    .insert(schema.marketSelections)
    .values({
      marketId: ids.scorerMarketId,
      key: "scorer_pedro",
      label: "Pedro",
    })
    .returning({ id: schema.marketSelections.id });
  ids.scorerPedro = pedro.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.predictions);
});

async function insertPrediction(values: {
  marketId: string | null;
  selectionId: string | null;
  recommendation: string;
  createdAt: Date;
}): Promise<string> {
  const [p] = await realDb
    .insert(schema.predictions)
    .values({
      matchId: ids.matchId,
      userId: ids.userId,
      aiCallId: ids.aiCallId,
      marketId: values.marketId,
      selectionId: values.selectionId,
      recommendation: values.recommendation,
      confidencePct: "60.00",
      rationale: "r",
      keyFactors: ["a"],
      modelVersion: "claude-opus-4-8",
      promptVersion: "v1",
      createdAt: values.createdAt,
    })
    .returning({ id: schema.predictions.id });
  return p.id;
}

async function seedThree() {
  const home = await insertPrediction({
    marketId: ids.mrMarketId,
    selectionId: ids.mrHome,
    recommendation: "home",
    createdAt: new Date("2026-09-19T12:00:00Z"),
  });
  const scorer = await insertPrediction({
    marketId: ids.scorerMarketId,
    selectionId: ids.scorerPedro,
    recommendation: "scorer_pedro",
    createdAt: new Date("2026-09-19T11:00:00Z"),
  });
  const legacyPass = await insertPrediction({
    marketId: null,
    selectionId: null,
    recommendation: "pass",
    createdAt: new Date("2026-09-19T10:00:00Z"),
  });
  return { home, scorer, legacyPass };
}

describe("selectionLabel via LEFT JOIN market_selections (#539)", () => {
  it("getUserDashboardRows traz o label da seleção e null sem seleção", async () => {
    await seedThree();
    const rows = await getUserDashboardRows(ids.userId);
    expect(
      rows.map((r) => [r.marketKey, r.recommendation, r.selectionLabel])
    ).toEqual([
      ["match_result", "home", "Casa"],
      ["anytime_scorer", "scorer_pedro", "Pedro"],
      ["over_under", "pass", null],
    ]);
  });

  it("getRecentPredictionsByUser traz mercado e seleção (null na row legada)", async () => {
    await seedThree();
    const rows = await getRecentPredictionsByUser(ids.userId, 5);
    expect(
      rows.map((r) => [r.marketKey, r.marketLabel, r.selectionLabel])
    ).toEqual([
      ["match_result", "Resultado (1X2)", "Casa"],
      ["anytime_scorer", "Artilheiro", "Pedro"],
      [null, null, null],
    ]);
  });

  it("getPredictionDetailForUser traz marketLabel e selectionLabel", async () => {
    const { scorer } = await seedThree();
    const detail = await getPredictionDetailForUser(scorer, ids.userId);
    expect(detail?.marketKey).toBe("anytime_scorer");
    expect(detail?.marketLabel).toBe("Artilheiro");
    expect(detail?.selectionLabel).toBe("Pedro");
  });
});
