// @vitest-environment node
//
// Leituras ao vivo (#580, ADR 0060 §6) fora da calibração, contra Postgres REAL (pglite).
// A calibração inclui `pass` de propósito, então uma leitura ao vivo (sempre `pass`)
// entraria se tivesse odd: o filtro `is_live = false` fica no `settledFilter`. E o PSO
// com `odd` NULL (a forma da leitura ao vivo) é tratado de propósito, não por acaso.
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

import {
  getMarketCalibrationRows,
  getOverUnderCalibrationRows,
} from "@/lib/db/queries/calibration";

const ids = {} as {
  userId: string;
  aiCallId: string;
  ouMarketId: string;
  over: string;
  under: string;
};

const STAMP = buildLiveStamp({
  source: "api_football",
  status: "2H",
  elapsed: 63,
  extra: null,
  minuteLabel: "63'",
  score: { home: 1, away: 0 },
  red: { home: 0, away: 0 },
  fetchedAt: new Date("2026-05-15T20:20:00Z"),
  recordedAt: new Date("2026-05-15T20:20:30Z"),
});

let seq = 0;
async function seedOverUnder(args: {
  live: boolean;
  recommendation: "over" | "pass";
  odds: { over: string | null; under: string | null };
}): Promise<void> {
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: `ext-cal-live-${seq++}`,
      league: "brasileirao_a",
      homeTeam: "Casa",
      awayTeam: "Fora",
      kickoffAt: new Date("2026-05-15T19:00:00Z"),
      status: "finished",
    })
    .returning({ id: schema.matches.id });
  const [p] = await realDb
    .insert(schema.predictions)
    .values({
      matchId: m.id,
      userId: ids.userId,
      aiCallId: ids.aiCallId,
      marketId: ids.ouMarketId,
      selectionId: args.recommendation === "pass" ? null : ids.over,
      recommendation: args.recommendation,
      confidencePct: "55.00",
      rationale: "r",
      keyFactors: ["f"],
      modelVersion: "m;engine=code_jev;lambda=dixon_coles",
      promptVersion: "over_under_v3.2",
      marketParams: { line: 2.5 },
      ...liveColumns(args.live ? STAMP : null),
    })
    .returning({ id: schema.predictions.id });
  await realDb.insert(schema.predictionOutcomes).values({
    predictionId: p.id,
    resultData: { homeScore: 2, awayScore: 1, totalGoals: 3 },
    result: args.recommendation === "pass" ? "void" : "won",
    profitUnits: "0",
  });
  await realDb.insert(schema.predictionSelectionOdds).values([
    {
      predictionId: p.id,
      selectionId: ids.over,
      odd: args.odds.over,
      modelProbPct: "58.00",
    },
    {
      predictionId: p.id,
      selectionId: ids.under,
      odd: args.odds.under,
      modelProbPct: "42.00",
    },
  ]);
}

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });

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
    .values({ email: "cal-live@example.com" })
    .returning({ id: schema.users.id });
  ids.userId = u.id;
  const [am] = await realDb
    .insert(schema.matches)
    .values({
      externalId: "ext-cal-live-aicall",
      league: "brasileirao_a",
      homeTeam: "Casa",
      awayTeam: "Fora",
      kickoffAt: new Date("2026-05-15T19:00:00Z"),
    })
    .returning({ id: schema.matches.id });
  const [ai] = await realDb
    .insert(schema.aiCalls)
    .values({
      userId: u.id,
      matchId: am.id,
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

  // Base de pré-jogo: uma aposta e um pass liquidados, com odds.
  await seedOverUnder({
    live: false,
    recommendation: "over",
    odds: { over: "1.900", under: "1.950" },
  });
  await seedOverUnder({
    live: false,
    recommendation: "pass",
    odds: { over: "2.000", under: "1.850" },
  });
}, 60_000);

afterAll(async () => {
  await client.close();
});

describe("calibração sem as leituras ao vivo (ADR 0060)", () => {
  it("leitura ao vivo liquidada não muda os pares, com ou sem odd", async () => {
    const before = await getMarketCalibrationRows();
    const ouBefore = await getOverUnderCalibrationRows();
    expect(before).toHaveLength(2);

    // A forma real: pass, PSO com odd NULL.
    await seedOverUnder({
      live: true,
      recommendation: "pass",
      odds: { over: null, under: null },
    });
    // Mesmo se um dia tiver odd: fica fora pelo filtro, não pelo acaso da odd.
    await seedOverUnder({
      live: true,
      recommendation: "pass",
      odds: { over: "1.500", under: "2.600" },
    });

    expect(await getMarketCalibrationRows()).toEqual(before);
    expect(await getOverUnderCalibrationRows()).toEqual(ouBefore);
  });

  it("PSO com odd NULL de pré-jogo: a predição sai (sem benchmark), sem quebrar", async () => {
    const before = await getMarketCalibrationRows();
    await seedOverUnder({
      live: false,
      recommendation: "pass",
      odds: { over: null, under: "1.900" },
    });
    expect(await getMarketCalibrationRows()).toEqual(before);
  });
});
