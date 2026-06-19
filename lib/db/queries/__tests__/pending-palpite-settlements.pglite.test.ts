// @vitest-environment node
//
// getPendingPalpiteSettlements LATEST-ONLY (ADR 0030 / #353, blocker #2) contra
// Postgres REAL via pglite. Cada run do palpite-first grava um set novo → N sets/jogo;
// SÓ a última geração por (matchId,userId) deve liquidar (senão N badges/jogo). Roda
// em `node` (pglite falha sob jsdom).
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
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

import { getPendingPalpiteSettlements } from "@/lib/db/queries/palpites";

const ids: { userId: string; otherUserId: string } = {} as never;

// kickoff bem no passado pra cair sempre dentro do cutoff (kickoff < now - 150min).
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

// Semeia um set + 1 linha exact_score settleable; createdAt explícito p/ ordenar gerações.
async function seedSetWithScore(args: {
  matchId: string;
  userId: string;
  createdAt: Date;
  params: { home: number; away: number };
}): Promise<{ setId: string; palpiteId: string }> {
  const [s] = await realDb
    .insert(schema.palpiteSets)
    .values({
      matchId: args.matchId,
      userId: args.userId,
      aiCallId: null,
      modelVersion: "claude-haiku-4-5",
      promptVersion: "palpites_v2",
      createdAt: args.createdAt,
    })
    .returning({ id: schema.palpiteSets.id });
  const [p] = await realDb
    .insert(schema.palpites)
    .values({
      palpiteSetId: s.id,
      type: "exact_score",
      text: "stub",
      params: args.params,
      settleable: true,
    })
    .returning({ id: schema.palpites.id });
  return { setId: s.id, palpiteId: p.id };
}

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });

  const [u] = await realDb
    .insert(schema.users)
    .values({ email: "pending-latest@pglite.test", role: "user", allowed: true })
    .returning({ id: schema.users.id });
  ids.userId = u.id;
  const [u2] = await realDb
    .insert(schema.users)
    .values({ email: "pending-other@pglite.test", role: "user", allowed: true })
    .returning({ id: schema.users.id });
  ids.otherUserId = u2.id;
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

describe("getPendingPalpiteSettlements — latest-only", () => {
  it("2 sets no mesmo jogo/usuário → SÓ a linha da última geração é pendente", async () => {
    const matchId = await seedMatch("ext-2sets");
    const older = await seedSetWithScore({
      matchId,
      userId: ids.userId,
      createdAt: new Date("2026-05-14T10:00:00Z"),
      params: { home: 1, away: 0 },
    });
    const newer = await seedSetWithScore({
      matchId,
      userId: ids.userId,
      createdAt: new Date("2026-05-14T12:00:00Z"),
      params: { home: 2, away: 1 },
    });

    const pending = await getPendingPalpiteSettlements(NOW);
    const ids_ = pending.map((p) => p.palpiteId);
    expect(ids_).toContain(newer.palpiteId);
    expect(ids_).not.toContain(older.palpiteId);
    expect(pending).toHaveLength(1);
  });

  it("1 set → liquida normalmente (não filtra a única geração)", async () => {
    const matchId = await seedMatch("ext-1set");
    const only = await seedSetWithScore({
      matchId,
      userId: ids.userId,
      createdAt: new Date("2026-05-14T10:00:00Z"),
      params: { home: 0, away: 0 },
    });
    const pending = await getPendingPalpiteSettlements(NOW);
    expect(pending.map((p) => p.palpiteId)).toEqual([only.palpiteId]);
  });

  it("o filtro é por (matchId,userId): sets de OUTRO usuário no mesmo jogo não se cancelam", async () => {
    const matchId = await seedMatch("ext-2users");
    const mine = await seedSetWithScore({
      matchId,
      userId: ids.userId,
      createdAt: new Date("2026-05-14T10:00:00Z"),
      params: { home: 1, away: 1 },
    });
    const theirs = await seedSetWithScore({
      matchId,
      userId: ids.otherUserId,
      createdAt: new Date("2026-05-14T11:00:00Z"),
      params: { home: 2, away: 0 },
    });
    const pending = await getPendingPalpiteSettlements(NOW);
    const set = new Set(pending.map((p) => p.palpiteId));
    // Cada usuário tem 1 geração → ambas pendentes (latest-only é POR usuário).
    expect(set.has(mine.palpiteId)).toBe(true);
    expect(set.has(theirs.palpiteId)).toBe(true);
    expect(pending).toHaveLength(2);
  });
});
