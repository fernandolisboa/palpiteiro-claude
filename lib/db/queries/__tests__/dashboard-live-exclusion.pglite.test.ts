// @vitest-environment node
//
// Achado 2 do PLAN-580 (ADR 0060 §6), contra Postgres REAL (pglite): o dedup do
// desempenho (`keepLatestPerMatch`, a mais nova por jogo e mercado) deixaria uma leitura
// ao vivo (`pass`, mais nova) apagar a aposta pré-jogo do mesmo jogo e mercado — nos
// KPIs, no CLV e no gate do Kelly. O filtro fica na query, antes do dedup.
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { buildLiveStamp, liveColumns } from "@/lib/live/stamp";

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

import { loadKellyGate } from "@/lib/calibration/kelly-live";
import { enrichDashboardRowsWithClosing } from "@/lib/dashboard/clv-enrich";
import { computeDashboardKpis, keepLatestPerMatch } from "@/lib/dashboard/kpis";
import {
  getAllDashboardRows,
  getUserDashboardRows,
} from "@/lib/db/queries/dashboard";

const KO = new Date("2026-05-15T19:00:00Z");
const ids = {} as {
  userId: string;
  matchId: string;
  aiCallId: string;
  ouMarketId: string;
  over: string;
  under: string;
};

async function insertPrediction(args: {
  live: boolean;
  recommendation: "over" | "pass";
  createdAt: Date;
}): Promise<string> {
  const stamp = args.live
    ? buildLiveStamp({
        source: "api_football",
        status: "2H",
        elapsed: 60,
        extra: null,
        minuteLabel: "60'",
        score: { home: 0, away: 0 },
        red: null,
        fetchedAt: args.createdAt,
        recordedAt: args.createdAt,
      })
    : null;
  const [p] = await realDb
    .insert(schema.predictions)
    .values({
      matchId: ids.matchId,
      userId: ids.userId,
      aiCallId: ids.aiCallId,
      marketId: ids.ouMarketId,
      selectionId: args.recommendation === "pass" ? null : ids.over,
      recommendation: args.recommendation,
      confidencePct: "56.00",
      rationale: "r",
      keyFactors: ["f"],
      oddAtRecommendation: args.live ? null : "1.950",
      impliedProbPct: args.live ? null : "50.00",
      edgePct: args.live ? null : "6.00",
      stakeUnits: "2.00",
      modelVersion: "m;engine=code_jev;lambda=dixon_coles",
      promptVersion: "over_under_v3.2",
      marketParams: { line: 2.5 },
      createdAt: args.createdAt,
      ...liveColumns(stamp),
    })
    .returning({ id: schema.predictions.id });
  await realDb.insert(schema.predictionOutcomes).values({
    predictionId: p.id,
    resultData: { homeScore: 2, awayScore: 1, totalGoals: 3 },
    result: args.recommendation === "pass" ? "void" : "won",
    profitUnits: args.recommendation === "pass" ? "0" : "1.90",
  });
  return p.id;
}

async function snapshot() {
  const userRows = keepLatestPerMatch(
    await enrichDashboardRowsWithClosing(await getUserDashboardRows(ids.userId))
  );
  return {
    kpis: computeDashboardKpis(userRows),
    gate: await loadKellyGate(),
    allRows: (await getAllDashboardRows()).map((r) => r.predictionId),
  };
}

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });

  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: "ext-dash-live",
      league: "brasileirao_a",
      homeTeam: "Casa",
      awayTeam: "Fora",
      kickoffAt: KO,
      status: "finished",
      homeScore: 2,
      awayScore: 1,
    })
    .returning({ id: schema.matches.id });
  ids.matchId = m.id;
  const [ou] = await realDb
    .select({ id: schema.markets.id })
    .from(schema.markets)
    .where(eq(schema.markets.key, "over_under"));
  ids.ouMarketId = ou.id;
  const sels = await realDb
    .select({
      id: schema.marketSelections.id,
      key: schema.marketSelections.key,
    })
    .from(schema.marketSelections)
    .where(eq(schema.marketSelections.marketId, ou.id));
  ids.over = sels.find((s) => s.key === "over")!.id;
  ids.under = sels.find((s) => s.key === "under")!.id;
  const [u] = await realDb
    .insert(schema.users)
    .values({ email: "dash-live@example.com" })
    .returning({ id: schema.users.id });
  ids.userId = u.id;
  const [ai] = await realDb
    .insert(schema.aiCalls)
    .values({
      userId: u.id,
      matchId: m.id,
      model: "m",
      promptVersion: "over_under_v3.2",
      inputPayload: {},
      outputPayload: {},
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
      costUsd: "0.000001",
    })
    .returning({ id: schema.aiCalls.id });
  ids.aiCallId = ai.id;

  // Closing line do over 2.5 dentro de [KO−40min, KO]: o CLV da aposta não é null.
  const closingAt = new Date(KO.getTime() - 10 * 60_000);
  await realDb.insert(schema.selectionOddsSnapshots).values(
    [
      { selectionId: ids.over, odd: "1.800" },
      { selectionId: ids.under, odd: "2.050" },
    ].map((s) => ({
      matchId: ids.matchId,
      marketId: ids.ouMarketId,
      selectionId: s.selectionId,
      marketParams: { line: 2.5 },
      odd: s.odd,
      overroundPct: "4.30",
      bookmaker: "x",
      capturedAt: closingAt,
    }))
  );

  // A aposta pré-jogo, uma hora antes do apito.
  await insertPrediction({
    live: false,
    recommendation: "over",
    createdAt: new Date(KO.getTime() - 60 * 60_000),
  });
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe("desempenho sem as leituras ao vivo (achado 2, ADR 0060)", () => {
  it("leitura ao vivo mais nova do mesmo jogo e mercado não muda KPIs, CLV nem o gate do Kelly", async () => {
    const before = await snapshot();
    expect(before.kpis.bets).toBe(1);
    expect(before.kpis.clvNoVigDelta.n).toBe(1);

    const liveId = await insertPrediction({
      live: true,
      recommendation: "pass",
      createdAt: new Date(KO.getTime() + 60 * 60_000),
    });

    const after = await snapshot();
    expect(after).toEqual(before);
    expect(after.allRows).not.toContain(liveId);
  });

  it("{ live: true } devolve só as leituras ao vivo", async () => {
    const live = await getUserDashboardRows(ids.userId, { live: true });
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ recommendation: "pass", isLive: true });
    const pre = await getUserDashboardRows(ids.userId);
    expect(pre.every((r) => !r.isLive)).toBe(true);
  });

  it("guarda do CLV: uma row ao vivo non-pass não recebe closing line", async () => {
    const [row] = await getUserDashboardRows(ids.userId);
    const out = await enrichDashboardRowsWithClosing([
      { ...row, predictionId: "fake-live", isLive: true },
    ]);
    expect(out[0].closingOdd).toBeNull();
  });
});
