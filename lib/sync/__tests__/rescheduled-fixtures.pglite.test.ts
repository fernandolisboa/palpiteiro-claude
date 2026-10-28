// @vitest-environment node
//
// Jogo remarcado contra Postgres real (pglite): o reconcile + o upsert do sync deixam
// UMA row por jogo, com o horário novo e o mesmo id (análises, apostas e bolão seguem
// apontando pra ela). Mesmo template de upsert-matches-crest.pglite.test.ts.
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { compositeFixtureKey, type NormalizedFixture } from "@/lib/providers/sports-data/types";

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

import { upsertMatchesFromProvider } from "@/lib/db/queries/matches";
import { reconcileRescheduledFixtures } from "@/lib/sync/rescheduled-fixtures";

const NOW = new Date("2026-10-28T23:30:00.000Z");
const OLD = "2026-10-28T21:00:00.000Z";
const NEW = "2026-10-29T00:30:00.000Z";

function fixture(kickoffAt: string, over: Partial<NormalizedFixture> = {}): NormalizedFixture {
  return {
    id: "x",
    league: "brasileirao_a",
    kickoffAt,
    kickoffTimestampMs: Date.parse(kickoffAt),
    homeTeam: "EC Bahia",
    awayTeam: "São Paulo FC",
    status: "scheduled",
    score: { home: null, away: null },
    ...over,
  };
}

// O que o sync faz por rodada.
async function syncRound(fixtures: NormalizedFixture[]) {
  await reconcileRescheduledFixtures(fixtures, NOW);
  await upsertMatchesFromProvider(fixtures);
}

async function allMatches() {
  return realDb
    .select({
      id: schema.matches.id,
      externalId: schema.matches.externalId,
      kickoffAt: schema.matches.kickoffAt,
      status: schema.matches.status,
    })
    .from(schema.matches)
    .orderBy(schema.matches.kickoffAt);
}

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });
});

beforeEach(async () => {
  await realDb.delete(schema.matches);
});

afterAll(async () => {
  await client.close();
});

describe("jogo remarcado no sync", () => {
  it("mantém uma row só, com o mesmo id e o horário novo", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    await syncRound([fixture(OLD)]);
    const [before] = await allMatches();

    await syncRound([fixture(NEW)]);

    const after = await allMatches();
    expect(after).toEqual([
      {
        id: before.id,
        externalId: compositeFixtureKey(fixture(NEW)),
        kickoffAt: new Date(NEW),
        status: "scheduled",
      },
    ]);
  });

  it("cópia velha já duplicada vira adiada e a nova segue intacta", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    // Estado de produção antes da correção: as duas rows, a velha ainda `scheduled`.
    await upsertMatchesFromProvider([fixture(OLD), fixture(NEW)]);

    await syncRound([fixture(NEW)]);

    const rows = await allMatches();
    expect(rows.map((r) => [r.externalId, r.status])).toEqual([
      [compositeFixtureKey(fixture(OLD)), "postponed"],
      [compositeFixtureKey(fixture(NEW)), "scheduled"],
    ]);

    // Rodada seguinte: nada muda (idempotente).
    await syncRound([fixture(NEW)]);
    expect((await allMatches()).map((r) => r.status)).toEqual(["postponed", "scheduled"]);
  });

  it("jogo encerrado com a chave sumida do provider não é tocado", async () => {
    await upsertMatchesFromProvider([fixture(OLD, { status: "finished", score: { home: 1, away: 0 } })]);
    await syncRound([fixture(NEW)]);
    const rows = await allMatches();
    const old = rows.find((r) => r.externalId === compositeFixtureKey(fixture(OLD)));
    expect(old?.status).toBe("finished");
    const [{ kickoffAt }] = await realDb
      .select({ kickoffAt: schema.matches.kickoffAt })
      .from(schema.matches)
      .where(eq(schema.matches.externalId, compositeFixtureKey(fixture(OLD))));
    expect(kickoffAt).toEqual(new Date(OLD));
  });
});
