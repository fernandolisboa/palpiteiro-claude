// @vitest-environment node
//
// Testes contra Postgres REAL via pglite (WASM) pra getLatestPredictionForMatch,
// especificamente a sub-query do candidate set (prediction_selection_odds) que é a
// fonte da grade N-vias ao REABRIR uma predição (#173). As migrations rodam 1x e já
// seedam over_under (0009) e match_result+home/draw/away (0014); o setup só LÊ os ids.
// Roda em `node` (pglite falha sob jsdom: r.arrayBuffer is not a function).
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

// `@/lib/db` é mockado pra apontar pro pglite. `realDb` é preenchido no beforeAll
// (depois das migrations). O Proxy delega tudo ao realDb.
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

import { getLatestPredictionForMatch } from "@/lib/db/queries/predictions";

const ids: {
  userId: string;
  matchId: string;
  aiCallId: string;
  ouMarketId: string;
  ouOver: string;
  ouUnder: string;
  mrMarketId: string;
  mrHome: string;
  mrDraw: string;
  mrAway: string;
} = {} as never;

beforeAll(async () => {
  client = new PGlite();
  const base = drizzle(client, { schema, casing: "snake_case" });
  realDb = base;

  await migrate(base, { migrationsFolder: "./db/migrations" });

  const [u] = await base
    .insert(schema.users)
    .values({ email: "reopen@pglite.test", role: "admin", allowed: true })
    .returning({ id: schema.users.id });
  ids.userId = u.id;

  const [m] = await base
    .insert(schema.matches)
    .values({
      externalId: "ext-reopen-1",
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: new Date("2026-05-15T19:00:00Z"),
    })
    .returning({ id: schema.matches.id });
  ids.matchId = m.id;

  // ai_call (FK NOT NULL da prediction).
  const [ac] = await base
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

  // over_under (0009) e match_result (0014) já seedados — lê os ids das seleções.
  const [ou] = await base
    .select({ id: schema.markets.id })
    .from(schema.markets)
    .where(eq(schema.markets.key, "over_under"));
  ids.ouMarketId = ou.id;
  const ouSels = await base
    .select({ id: schema.marketSelections.id, key: schema.marketSelections.key })
    .from(schema.marketSelections)
    .where(eq(schema.marketSelections.marketId, ou.id));
  ids.ouOver = ouSels.find((s) => s.key === "over")!.id;
  ids.ouUnder = ouSels.find((s) => s.key === "under")!.id;

  const [mr] = await base
    .select({ id: schema.markets.id })
    .from(schema.markets)
    .where(eq(schema.markets.key, "match_result"));
  ids.mrMarketId = mr.id;
  const mrSels = await base
    .select({ id: schema.marketSelections.id, key: schema.marketSelections.key })
    .from(schema.marketSelections)
    .where(eq(schema.marketSelections.marketId, mr.id));
  ids.mrHome = mrSels.find((s) => s.key === "home")!.id;
  ids.mrDraw = mrSels.find((s) => s.key === "draw")!.id;
  ids.mrAway = mrSels.find((s) => s.key === "away")!.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.predictionSelectionOdds);
  await realDb.delete(schema.predictions);
});

async function insertPrediction(values: {
  marketId: string;
  selectionId: string;
  recommendation: "home" | "over";
  createdAt?: Date;
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
      createdAt: values.createdAt ?? new Date("2026-05-10T12:00:00Z"),
    })
    .returning({ id: schema.predictions.id });
  return p.id;
}

describe("getLatestPredictionForMatch — candidate set (PSO) sub-query", () => {
  it("match_result (3 PSO rows): retorna selections ordenadas por sort_order, com Number()'d prob/odd", async () => {
    const predictionId = await insertPrediction({
      marketId: ids.mrMarketId,
      selectionId: ids.mrHome,
      recommendation: "home",
    });
    // Inseridas FORA da ordem canônica de propósito — a sub-query ordena por
    // market_selections.sort_order (home, draw, away), não pela ordem de insert.
    await realDb.insert(schema.predictionSelectionOdds).values([
      {
        predictionId,
        selectionId: ids.mrAway,
        odd: "3.900",
        modelProbPct: "21.00",
      },
      {
        predictionId,
        selectionId: ids.mrHome,
        odd: "2.100",
        modelProbPct: "52.00",
      },
      {
        predictionId,
        selectionId: ids.mrDraw,
        odd: "3.400",
        modelProbPct: "27.00",
      },
    ]);

    const out = await getLatestPredictionForMatch(ids.matchId, ids.userId);
    expect(out).not.toBeNull();
    expect(out!.marketKey).toBe("match_result");
    expect(out!.selections).toHaveLength(3);
    // Ordem canônica (sort_order), não a de insert.
    expect(out!.selections.map((s) => s.key)).toEqual(["home", "draw", "away"]);
    // numeric → string no Drizzle → Number() na fronteira (gotcha
    // drizzle-numeric-returns-string): números, nunca "52.00".
    for (const s of out!.selections) {
      expect(typeof s.modelProbPct).toBe("number");
      expect(typeof s.odd).toBe("number");
    }
    expect(out!.selections.map((s) => s.modelProbPct)).toEqual([52, 27, 21]);
    expect(out!.selections.map((s) => s.odd)).toEqual([2.1, 3.4, 3.9]);
  });

  it("over_under (2 PSO rows): caminho binário ainda funciona — 2 selections em ordem", async () => {
    const predictionId = await insertPrediction({
      marketId: ids.ouMarketId,
      selectionId: ids.ouOver,
      recommendation: "over",
    });
    await realDb.insert(schema.predictionSelectionOdds).values([
      {
        predictionId,
        selectionId: ids.ouUnder,
        odd: "1.950",
        modelProbPct: "48.00",
      },
      {
        predictionId,
        selectionId: ids.ouOver,
        odd: "1.900",
        modelProbPct: "52.00",
      },
    ]);

    const out = await getLatestPredictionForMatch(ids.matchId, ids.userId);
    expect(out).not.toBeNull();
    expect(out!.marketKey).toBe("over_under");
    expect(out!.selections).toHaveLength(2);
    expect(out!.selections.map((s) => s.key)).toEqual(["over", "under"]);
    expect(out!.selections.map((s) => s.odd)).toEqual([1.9, 1.95]);
    expect(out!.selections.map((s) => s.modelProbPct)).toEqual([52, 48]);
  });

  it("modelProbPct NULL (over/under pré-#173 / backfill): coalesce null→0 na fronteira", async () => {
    const predictionId = await insertPrediction({
      marketId: ids.mrMarketId,
      selectionId: ids.mrHome,
      recommendation: "home",
    });
    await realDb.insert(schema.predictionSelectionOdds).values([
      { predictionId, selectionId: ids.mrHome, odd: "2.100", modelProbPct: null },
      { predictionId, selectionId: ids.mrDraw, odd: "3.400", modelProbPct: null },
      { predictionId, selectionId: ids.mrAway, odd: "3.900", modelProbPct: null },
    ]);

    const out = await getLatestPredictionForMatch(ids.matchId, ids.userId);
    expect(out!.selections.map((s) => s.modelProbPct)).toEqual([0, 0, 0]);
    // odd segue derivando mesmo sem modelProbPct.
    expect(out!.selections.map((s) => s.odd)).toEqual([2.1, 3.4, 3.9]);
  });
});
