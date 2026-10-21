// @vitest-environment node
//
// Registro do cupom (#556) contra Postgres REAL via pglite: vários slips + pernas numa
// ida (db.batch), com as colunas novas da migration 0054 congeladas.
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

import {
  getUserBetSlipsByIds,
  insertBetSlipsBatch,
  type NewBetLeg,
  type NewBetSlip,
} from "@/lib/db/queries/user-bets";

const ids = {} as { userId: string; matchId: string };

beforeAll(async () => {
  client = new PGlite();
  const base = drizzle(client, { schema, casing: "snake_case" });
  // pglite não tem batch: executa em ordem (o neon-http faz numa transação).
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
    .values({ email: "cupom@example.com" })
    .returning({ id: schema.users.id });
  ids.userId = u.id;
  const [m] = await base
    .insert(schema.matches)
    .values({
      externalId: "cupom-1",
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: new Date("2099-05-15T19:00:00Z"),
    })
    .returning({ id: schema.matches.id });
  ids.matchId = m.id;
});

afterAll(async () => {
  await client.close();
});

const leg = (over: Partial<NewBetLeg> = {}): NewBetLeg => ({
  kind: "match_result",
  params: { selection: "home" },
  userOdd: 2.1,
  modelProbPct: 52.346,
  gradeSource: "scoreline_model",
  gradeStatus: "graded",
  settleable: true,
  pinnedPredictionId: null,
  modelSource: "dixon_coles",
  referenceOdd: 2.05,
  marketImpliedPct: 47.5,
  stakeUnits: 1.5,
  suggestedStakeUnits: 1,
  ...over,
});

describe("insertBetSlipsBatch", () => {
  it("grava um slip por perna no modo simples, com as colunas do cupom", async () => {
    const { slipIds } = await insertBetSlipsBatch([
      {
        matchId: ids.matchId,
        userId: ids.userId,
        rawInput: null,
        parseAiCallId: null,
        comboUserOdd: null,
        jointProbPct: null,
        mode: "simples",
        stakeUnits: null,
        legs: [leg()],
      },
      {
        matchId: ids.matchId,
        userId: ids.userId,
        rawInput: null,
        parseAiCallId: null,
        comboUserOdd: null,
        jointProbPct: null,
        mode: "simples",
        stakeUnits: null,
        legs: [
          leg({
            kind: "over_under",
            params: { selection: "over", line: 2.5 },
            modelSource: "heuristic",
            referenceOdd: null,
            marketImpliedPct: null,
            stakeUnits: null,
            suggestedStakeUnits: null,
          }),
        ],
      },
    ]);
    expect(slipIds).toHaveLength(2);

    const legs = await realDb
      .select()
      .from(schema.betLegs)
      .where(eq(schema.betLegs.slipId, slipIds[0]));
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({
      modelProbPct: "52.35",
      modelSource: "dixon_coles",
      referenceOdd: "2.050",
      marketImpliedPct: "47.50",
      stakeUnits: "1.50",
      suggestedStakeUnits: "1.00",
    });
    const [slip] = await realDb
      .select()
      .from(schema.betSlips)
      .where(eq(schema.betSlips.id, slipIds[1]));
    expect(slip.mode).toBe("simples");
  });

  it("grava a combinada como um slip com todas as pernas e a conjunta", async () => {
    const { slipIds } = await insertBetSlipsBatch([
      {
        matchId: ids.matchId,
        userId: ids.userId,
        rawInput: "Flamengo e over",
        parseAiCallId: null,
        comboUserOdd: 3.4,
        jointProbPct: 31.2,
        mode: "combinada",
        stakeUnits: 2,
        legs: [leg(), leg({ kind: "btts", params: { selection: "yes" } })],
      },
    ]);
    const [slip] = await realDb
      .select()
      .from(schema.betSlips)
      .where(eq(schema.betSlips.id, slipIds[0]));
    expect(slip).toMatchObject({
      mode: "combinada",
      comboUserOdd: "3.400",
      jointProbPct: "31.20",
      stakeUnits: "2.00",
    });
    const legs = await realDb
      .select()
      .from(schema.betLegs)
      .where(eq(schema.betLegs.slipId, slipIds[0]));
    expect(legs).toHaveLength(2);
  });
});

describe("getUserBetSlipsByIds + model_snapshot_id (#562)", () => {
  const simples = (over: Partial<NewBetSlip> = {}): NewBetSlip => ({
    matchId: ids.matchId,
    userId: ids.userId,
    rawInput: null,
    parseAiCallId: null,
    comboUserOdd: null,
    jointProbPct: null,
    mode: "simples",
    stakeUnits: null,
    legs: [leg()],
    ...over,
  });

  it("devolve na ordem dos ids pedidos, com pernas e a base gravada", async () => {
    const [snap] = await realDb
      .insert(schema.matchModelSnapshots)
      .values({
        matchId: ids.matchId,
        modelVersion: "v",
        fingerprint: "f",
        lambdaSource: "dixon_coles",
        lambdaDegraded: false,
        neutral: false,
        lambdaHomeBase: 1.5,
        lambdaAwayBase: 1.1,
        lambdaHome: 1.5,
        lambdaAway: 1.1,
        jevStatus: "not_attempted",
        probabilities: {} as never,
        topScorelines: [],
      })
      .returning({ id: schema.matchModelSnapshots.id });
    const { slipIds } = await insertBetSlipsBatch([
      simples({ modelSnapshotId: snap.id }),
      simples({ modelSnapshotId: snap.id }),
    ]);
    const reversed = [...slipIds].reverse();
    const rows = await getUserBetSlipsByIds(ids.userId, reversed);
    expect(rows.map((r) => r.id)).toEqual(reversed);
    expect(rows.every((r) => r.legs.length === 1)).toBe(true);
    expect(rows[0].modelSnapshotId).toBe(snap.id);
  });

  it("ids de outro usuário não voltam (anti-IDOR)", async () => {
    const [other] = await realDb
      .insert(schema.users)
      .values({ email: "outro@example.com" })
      .returning({ id: schema.users.id });
    const { slipIds } = await insertBetSlipsBatch([simples({ userId: other.id })]);
    expect(await getUserBetSlipsByIds(ids.userId, slipIds)).toEqual([]);
    expect(await getUserBetSlipsByIds(other.id, slipIds)).toHaveLength(1);
  });

  it("lista vazia → sem query", async () => {
    expect(await getUserBetSlipsByIds(ids.userId, [])).toEqual([]);
  });
});
