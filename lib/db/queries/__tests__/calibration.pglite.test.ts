// @vitest-environment node
//
// Harness de calibração (Report 03 rec. 3, ADR 0037) contra Postgres REAL via pglite.
// Cobre: monta os pares (modelPOver, marketPOver no-vig, overHappened) das predições
// over/under liquidadas; exclui as sem P(over) do modelo e as sem outcome; overHappened
// = totalGoals > line; agrupa por promptVersion. Roda em `node`.
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
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
    },
  ),
}));

import { getOverUnderCalibrationRows } from "@/lib/db/queries/calibration";

const ids: {
  userId: string;
  aiCallId: string;
  ouMarketId: string;
  ouOver: string;
  ouUnder: string;
} = {} as never;

let seq = 0;

async function seedOU(args: {
  promptVersion: string;
  line: number;
  totalGoals: number;
  overModelPct: number | null;
  overOdd: string;
  underOdd: string;
  withOutcome?: boolean;
  result?: "won" | "lost" | "void";
  recommendation?: "over" | "pass";
}): Promise<void> {
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: `ext-cal-${seq++}`,
      league: "brasileirao_a",
      homeTeam: "Casa",
      awayTeam: "Fora",
      kickoffAt: new Date("2026-05-15T19:00:00Z"),
    })
    .returning({ id: schema.matches.id });

  const [p] = await realDb
    .insert(schema.predictions)
    .values({
      matchId: m.id,
      userId: ids.userId,
      aiCallId: ids.aiCallId,
      marketId: ids.ouMarketId,
      selectionId: args.recommendation === "pass" ? null : ids.ouOver,
      recommendation: args.recommendation ?? "over",
      confidencePct: "55.00",
      rationale: "r",
      keyFactors: ["f"],
      modelVersion: "claude-sonnet-4-5-20250929",
      promptVersion: args.promptVersion,
      marketParams: { line: args.line },
    })
    .returning({ id: schema.predictions.id });

  if (args.withOutcome !== false) {
    await realDb.insert(schema.predictionOutcomes).values({
      predictionId: p.id,
      resultData: {
        homeScore: null,
        awayScore: null,
        totalGoals: args.totalGoals,
      },
      result: args.result ?? "won",
      profitUnits: "0",
    });
  }

  await realDb.insert(schema.predictionSelectionOdds).values([
    {
      predictionId: p.id,
      selectionId: ids.ouOver,
      odd: args.overOdd,
      modelProbPct:
        args.overModelPct === null ? null : args.overModelPct.toFixed(2),
    },
    {
      predictionId: p.id,
      selectionId: ids.ouUnder,
      odd: args.underOdd,
      modelProbPct: null,
    },
  ]);
}

beforeAll(async () => {
  client = new PGlite();
  const base = drizzle(client, { schema, casing: "snake_case" });
  realDb = base;
  await migrate(base, { migrationsFolder: "./db/migrations" });

  const [ou] = await base
    .select({ id: schema.markets.id })
    .from(schema.markets)
    .where(eq(schema.markets.key, "over_under"));
  ids.ouMarketId = ou.id;
  const sels = await base
    .select({
      id: schema.marketSelections.id,
      key: schema.marketSelections.key,
    })
    .from(schema.marketSelections)
    .where(eq(schema.marketSelections.marketId, ou.id));
  ids.ouOver = sels.find((s) => s.key === "over")!.id;
  ids.ouUnder = sels.find((s) => s.key === "under")!.id;

  const [u] = await base
    .insert(schema.users)
    .values({ email: "cal@example.com" })
    .returning({ id: schema.users.id });
  ids.userId = u.id;
  // ai_calls.match_id é NOT NULL — um match compartilhado só pro FK do aiCall.
  const [am] = await base
    .insert(schema.matches)
    .values({
      externalId: "ext-cal-aicall",
      league: "brasileirao_a",
      homeTeam: "Casa",
      awayTeam: "Fora",
      kickoffAt: new Date("2026-05-15T19:00:00Z"),
    })
    .returning({ id: schema.matches.id });
  const [ai] = await base
    .insert(schema.aiCalls)
    .values({
      userId: u.id,
      matchId: am.id,
      model: "claude-sonnet-4-5-20250929",
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
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.predictionOutcomes);
  await realDb.delete(schema.predictionSelectionOdds);
  await realDb.delete(schema.predictions);
});

describe("getOverUnderCalibrationRows", () => {
  it("sem predições liquidadas → vazio", async () => {
    expect(await getOverUnderCalibrationRows()).toEqual([]);
  });

  it("monta o par: modelPOver, marketPOver de-vigado, overHappened, versão", async () => {
    await seedOU({
      promptVersion: "over_under_v3.2",
      line: 2.5,
      totalGoals: 3, // > 2.5 → over aconteceu
      overModelPct: 60,
      overOdd: "1.900",
      underOdd: "1.950",
    });
    const rows = await getOverUnderCalibrationRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].promptVersion).toBe("over_under_v3.2");
    expect(rows[0].modelPOver).toBeCloseTo(0.6, 9);
    expect(rows[0].overHappened).toBe(1);
    expect(rows[0].isBet).toBe(true);
    // de-vig(1.90, 1.95): (1/1.9)/((1/1.9)+(1/1.95)) ≈ 0.5065
    expect(rows[0].marketPOver).toBeCloseTo(0.5065, 3);
  });

  it("overHappened = totalGoals > line (total 2, line 2.5 → 0)", async () => {
    await seedOU({
      promptVersion: "v",
      line: 2.5,
      totalGoals: 2,
      overModelPct: 40,
      overOdd: "2.100",
      underOdd: "1.750",
    });
    const rows = await getOverUnderCalibrationRows();
    expect(rows[0].overHappened).toBe(0);
  });

  it("exclui predição sem P(over) do modelo (modelProbPct null)", async () => {
    await seedOU({
      promptVersion: "v",
      line: 2.5,
      totalGoals: 3,
      overModelPct: null,
      overOdd: "1.900",
      underOdd: "1.950",
    });
    expect(await getOverUnderCalibrationRows()).toEqual([]);
  });

  it("inclui pass (void/0 com placar real) como isBet=false", async () => {
    await seedOU({
      promptVersion: "v",
      line: 2.5,
      totalGoals: 1,
      overModelPct: 45,
      overOdd: "1.900",
      underOdd: "1.950",
      result: "void",
      recommendation: "pass",
    });
    const rows = await getOverUnderCalibrationRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].isBet).toBe(false);
    expect(rows[0].overHappened).toBe(0);
    expect(rows[0].modelPOver).toBeCloseTo(0.45, 9);
  });

  it("exclui outcome 'void' de aposta (anulado pelo admin — rótulo sem sentido)", async () => {
    await seedOU({
      promptVersion: "v",
      line: 2.5,
      totalGoals: 3,
      overModelPct: 60,
      overOdd: "1.900",
      underOdd: "1.950",
      result: "void",
    });
    expect(await getOverUnderCalibrationRows()).toEqual([]);
  });

  it("exclui predição sem outcome (não liquidada)", async () => {
    await seedOU({
      promptVersion: "v",
      line: 2.5,
      totalGoals: 3,
      overModelPct: 60,
      overOdd: "1.900",
      underOdd: "1.950",
      withOutcome: false,
    });
    expect(await getOverUnderCalibrationRows()).toEqual([]);
  });
});
