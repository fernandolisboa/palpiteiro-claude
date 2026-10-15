// @vitest-environment node
//
// ADR 0058 (#577): "Suas predições recentes" é um cartão por jogo. A query devolve os
// N jogos analisados por último pelo usuário (pela predição mais recente de cada um)
// e TODAS as predições dele nesses jogos. Postgres REAL (pglite) pro group by/max.
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

let realDb: PgliteDatabase<typeof schema>;
let client: PGlite;

vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        const v = Reflect.get(realDb, prop);
        return typeof v === "function" ? v.bind(realDb) : v;
      },
    }
  ),
}));

import { getRecentPredictedMatchesByUser } from "@/lib/db/queries/predictions";

const ids: {
  userId: string;
  otherUserId: string;
  aiCallId: string;
  matchIds: string[];
  mrMarketId: string;
  ouMarketId: string;
} = { userId: "", otherUserId: "", aiCallId: "", matchIds: [], mrMarketId: "", ouMarketId: "" };

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

  const users = await realDb
    .insert(schema.users)
    .values([
      { email: "recentes@pglite.test", role: "user", allowed: true },
      { email: "outro@pglite.test", role: "user", allowed: true },
    ])
    .returning({ id: schema.users.id });
  ids.userId = users[0].id;
  ids.otherUserId = users[1].id;

  const matchRows = await realDb
    .insert(schema.matches)
    .values(
      Array.from({ length: 7 }, (_, i) => ({
        externalId: `ext-recent-${i}`,
        league: "brasileirao_a" as const,
        homeTeam: "SE Palmeiras",
        awayTeam: "CR Flamengo",
        kickoffAt: new Date(Date.UTC(2026, 9, 10 + i, 19)),
      }))
    )
    .returning({ id: schema.matches.id });
  ids.matchIds = matchRows.map((m) => m.id);

  const [ac] = await realDb
    .insert(schema.aiCalls)
    .values({
      userId: ids.userId,
      matchId: ids.matchIds[0],
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
  ids.ouMarketId = await marketId("over_under");
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.predictions);
});

async function insertPrediction(values: {
  matchIndex: number;
  marketId: string;
  recommendation: string;
  createdAt: Date;
  userId?: string;
  isLive?: boolean;
}): Promise<string> {
  const [p] = await realDb
    .insert(schema.predictions)
    .values({
      matchId: ids.matchIds[values.matchIndex],
      userId: values.userId ?? ids.userId,
      aiCallId: ids.aiCallId,
      marketId: values.marketId,
      selectionId: null,
      recommendation: values.recommendation,
      confidencePct: "60.00",
      rationale: "r",
      keyFactors: ["a"],
      modelVersion: "claude-opus-4-8",
      promptVersion: "v1",
      isLive: values.isLive ?? false,
      liveState: values.isLive ? { v: 1 } : null,
      createdAt: values.createdAt,
    })
    .returning({ id: schema.predictions.id });
  return p.id;
}

const at = (hour: number) => new Date(Date.UTC(2026, 9, 1, hour));

describe("getRecentPredictedMatchesByUser (ADR 0058)", () => {
  it("devolve no máximo N jogos, pela análise mais recente de cada um", async () => {
    // Jogo i analisado na hora i: os 5 mais recentes são os jogos 2..6.
    for (let i = 0; i < 7; i++) {
      await insertPrediction({
        matchIndex: i,
        marketId: ids.mrMarketId,
        recommendation: "home",
        createdAt: at(i),
      });
    }
    // Reanálise do jogo 0 na hora 10: ele volta para o topo e o jogo 2 sai.
    await insertPrediction({
      matchIndex: 0,
      marketId: ids.ouMarketId,
      recommendation: "over",
      createdAt: at(10),
    });
    const rows = await getRecentPredictedMatchesByUser(ids.userId, 5);
    const matches = new Set(rows.map((r) => r.matchId));
    expect(matches.size).toBe(5);
    expect(matches).toEqual(
      new Set([0, 3, 4, 5, 6].map((i) => ids.matchIds[i]))
    );
  });

  it("empate no max(createdAt): o desempate por matchId desc fixa quais jogos entram", async () => {
    for (const i of [0, 1, 2, 3]) {
      await insertPrediction({ matchIndex: i, marketId: ids.mrMarketId, recommendation: "home", createdAt: at(5) });
    }
    const expected = [0, 1, 2, 3]
      .map((i) => ids.matchIds[i])
      .sort()
      .reverse()
      .slice(0, 2);
    for (let run = 0; run < 3; run++) {
      const rows = await getRecentPredictedMatchesByUser(ids.userId, 2);
      expect(rows.map((r) => r.matchId)).toEqual(expected);
    }
  });

  it("traz todas as predições do usuário nesses jogos (mercados e reanálises), mais novas primeiro, com a data do jogo", async () => {
    await insertPrediction({ matchIndex: 1, marketId: ids.mrMarketId, recommendation: "home", createdAt: at(1) });
    await insertPrediction({ matchIndex: 1, marketId: ids.ouMarketId, recommendation: "pass", createdAt: at(2) });
    await insertPrediction({ matchIndex: 1, marketId: ids.mrMarketId, recommendation: "away", createdAt: at(3) });
    const rows = await getRecentPredictedMatchesByUser(ids.userId, 5);
    expect(rows.map((r) => [r.marketKey, r.recommendation])).toEqual([
      ["match_result", "away"],
      ["over_under", "pass"],
      ["match_result", "home"],
    ]);
    expect(rows[0].kickoffAt).toEqual(new Date(Date.UTC(2026, 9, 11, 19)));
  });

  it("nada de outro usuário, nem nos jogos que o usuário analisou", async () => {
    await insertPrediction({ matchIndex: 0, marketId: ids.mrMarketId, recommendation: "home", createdAt: at(1) });
    await insertPrediction({
      matchIndex: 0,
      marketId: ids.ouMarketId,
      recommendation: "over",
      createdAt: at(5),
      userId: ids.otherUserId,
    });
    await insertPrediction({
      matchIndex: 4,
      marketId: ids.ouMarketId,
      recommendation: "over",
      createdAt: at(6),
      userId: ids.otherUserId,
    });
    const rows = await getRecentPredictedMatchesByUser(ids.userId, 5);
    expect(rows.map((r) => [r.matchId, r.recommendation])).toEqual([
      [ids.matchIds[0], "home"],
    ]);
  });

  it("traz isLive para o selo, sem filtrar as leituras ao vivo (ADR 0060)", async () => {
    await insertPrediction({ matchIndex: 2, marketId: ids.mrMarketId, recommendation: "home", createdAt: at(1) });
    await insertPrediction({
      matchIndex: 2,
      marketId: ids.mrMarketId,
      recommendation: "pass",
      createdAt: at(2),
      isLive: true,
    });
    const rows = await getRecentPredictedMatchesByUser(ids.userId, 5);
    expect(rows.map((r) => [r.recommendation, r.isLive])).toEqual([
      ["pass", true],
      ["home", false],
    ]);
  });

  it("sem análise, lista vazia", async () => {
    expect(await getRecentPredictedMatchesByUser(ids.userId, 5)).toEqual([]);
  });
});
