// @vitest-environment node
//
// Override manual de liquidação de palpite (#394) contra Postgres REAL (pglite). Cobre o
// insert (row stuck-PENDING) e o onConflictDoUpdate (row já liquidada errado → flipa
// result + carimba overrideByUserId + bumpa settledAt). É a única saída pra rows de
// cartão cap-esgotadas / A≠B perpétuo.
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  insertPalpiteOutcomeIfAbsent,
  getPalpiteOutcomeById,
  upsertPalpiteOutcomeOverride,
} from "@/lib/db/queries/palpite-outcomes";

const ids: { userId: string } = {} as never;

async function seedCardsPalpite(externalId: string): Promise<string> {
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId,
      league: "brasileirao_a",
      homeTeam: "CR Flamengo",
      awayTeam: "Fluminense FC",
      kickoffAt: new Date("2026-05-15T19:00:00Z"),
    })
    .returning({ id: schema.matches.id });
  const [s] = await realDb
    .insert(schema.palpiteSets)
    .values({
      matchId: m.id,
      userId: ids.userId,
      aiCallId: null,
      modelVersion: "claude-3-5-haiku-latest",
      promptVersion: "palpites_v8",
    })
    .returning({ id: schema.palpiteSets.id });
  const [p] = await realDb
    .insert(schema.palpites)
    .values({
      palpiteSetId: s.id,
      type: "cards",
      text: "4+ cartões amarelos",
      params: { line: 4, scope: "total" },
      settleable: true,
    })
    .returning({ id: schema.palpites.id });
  return p.id;
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
    .values({ email: "cards-override@example.com" })
    .returning({ id: schema.users.id });
  ids.userId = u.id;
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await realDb.delete(schema.palpiteOutcomes);
  await realDb.delete(schema.palpites);
  await realDb.delete(schema.palpiteSets);
  await realDb.delete(schema.matches);
});

describe("upsertPalpiteOutcomeOverride", () => {
  it("row stuck-PENDING (sem outcome) → INSERT com overrideByUserId + resultData", async () => {
    const palpiteId = await seedCardsPalpite("ovr-insert");
    await upsertPalpiteOutcomeOverride({
      palpiteId,
      result: "won",
      resultData: {
        homeScore: null,
        awayScore: null,
        totalGoals: 0,
        yellowCardsTotal: 6,
      },
      overrideByUserId: ids.userId,
    });
    const out = await getPalpiteOutcomeById(palpiteId);
    expect(out?.result).toBe("won");
    expect(out?.overrideByUserId).toBe(ids.userId);
    expect(out?.resultData?.yellowCardsTotal).toBe(6);
  });

  it("row já liquidada ERRADO → onConflictDoUpdate flipa result + bumpa settledAt", async () => {
    const palpiteId = await seedCardsPalpite("ovr-fix");
    // Auto-settle (cron) marcou lost.
    await insertPalpiteOutcomeIfAbsent({
      palpiteId,
      result: "lost",
      resultData: { homeScore: null, awayScore: null, totalGoals: 0 },
    });
    const before = await getPalpiteOutcomeById(palpiteId);
    expect(before?.result).toBe("lost");
    expect(before?.overrideByUserId).toBeNull();

    // Override corrige pra won.
    await upsertPalpiteOutcomeOverride({
      palpiteId,
      result: "won",
      resultData: null,
      overrideByUserId: ids.userId,
    });
    const after = await getPalpiteOutcomeById(palpiteId);
    expect(after?.result).toBe("won");
    expect(after?.overrideByUserId).toBe(ids.userId);
    expect(after?.resultData).toBeNull();
    // settledAt bumpado (>= o anterior; o update seta new Date()).
    expect(after!.settledAt.getTime()).toBeGreaterThanOrEqual(
      before!.settledAt.getTime(),
    );
  });

  it("idempotência do cron NÃO sobrescreve um override (onConflictDoNothing)", async () => {
    const palpiteId = await seedCardsPalpite("ovr-protect");
    await upsertPalpiteOutcomeOverride({
      palpiteId,
      result: "won",
      resultData: null,
      overrideByUserId: ids.userId,
    });
    // O cron tentaria liquidar lost — mas a row já existe → no-op.
    const inserted = await insertPalpiteOutcomeIfAbsent({
      palpiteId,
      result: "lost",
      resultData: { homeScore: null, awayScore: null, totalGoals: 0 },
    });
    expect(inserted).toBe(false);
    const out = await getPalpiteOutcomeById(palpiteId);
    expect(out?.result).toBe("won"); // override preservado
    expect(out?.overrideByUserId).toBe(ids.userId);
  });
});
