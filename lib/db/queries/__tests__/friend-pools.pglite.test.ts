// @vitest-environment node
//
// Bolão entre amigos (#567) contra Postgres real (pglite): roda a migration 0056 de
// verdade e prova o escopo por dono (anti-IDOR), o CHECK do placar manual e a cascata
// das apostas. Mesmo template de accepted-terms.pglite.test.ts.
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq, sql } from "drizzle-orm";
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
  deleteFriendPool,
  deleteFriendPoolEntry,
  getFriendPool,
  insertFriendPool,
  insertFriendPoolEntry,
  listFriendPools,
  setFriendPoolManualScore,
} from "@/lib/db/queries/friend-pools";

let owner = "";
let other = "";
let matchId = "";

beforeAll(async () => {
  client = new PGlite();
  realDb = drizzle(client, { schema, casing: "snake_case" });
  await migrate(realDb, { migrationsFolder: "./db/migrations" });

  const users = await realDb
    .insert(schema.users)
    .values([
      { email: "dono@example.com", allowed: true },
      { email: "outro@example.com", allowed: true },
    ])
    .returning({ id: schema.users.id });
  owner = users[0]!.id;
  other = users[1]!.id;
  const [m] = await realDb
    .insert(schema.matches)
    .values({
      externalId: "bsa:2026-10-18:fla:pal",
      league: "brasileirao_a",
      homeTeam: "Flamengo",
      awayTeam: "Palmeiras",
      kickoffAt: new Date("2026-10-18T19:00:00Z"),
    })
    .returning({ id: schema.matches.id });
  matchId = m!.id;
});

afterAll(async () => {
  await client.close();
});

describe("friend_pools (pglite)", () => {
  it("cria, lista com contagem e lê só pro dono", async () => {
    const poolId = await insertFriendPool({
      userId: owner,
      matchId,
      title: "Sábado",
      entryAmountCents: 1000,
    });
    await insertFriendPoolEntry({
      poolId,
      bettorName: "Ana",
      kind: "exact_score",
      params: { home: 2, away: 1 },
    });
    await insertFriendPoolEntry({
      poolId,
      bettorName: "Bia",
      kind: "over_under",
      params: { selection: "over", line: 2.5 },
    });

    const list = await listFriendPools(owner);
    expect(list).toHaveLength(1);
    expect(list[0]!.entryCount).toBe(2);
    expect(list[0]!.match.homeTeam).toBe("Flamengo");
    expect(await listFriendPools(other)).toEqual([]);

    const detail = await getFriendPool(poolId, owner);
    expect(detail?.entries.map((e) => e.bettorName)).toEqual(["Ana", "Bia"]);
    expect(detail?.entries[1]!.params).toEqual({ selection: "over", line: 2.5 });
    expect(await getFriendPool(poolId, other)).toBeNull();
  });

  it("outro usuário não mexe no bolão alheio", async () => {
    const poolId = await insertFriendPool({ userId: owner, matchId, title: null, entryAmountCents: null });
    await insertFriendPoolEntry({ poolId, bettorName: "Caio", kind: "btts", params: { selection: "yes" } });
    const [entry] = (await getFriendPool(poolId, owner))!.entries;

    expect(await deleteFriendPoolEntry({ entryId: entry!.id, poolId, userId: other })).toBe(false);
    expect(await setFriendPoolManualScore({ poolId, userId: other, score: { home: 1, away: 0 } })).toBe(false);
    expect(await deleteFriendPool(poolId, other)).toBe(false);
    expect((await getFriendPool(poolId, owner))!.entries).toHaveLength(1);

    expect(await deleteFriendPoolEntry({ entryId: entry!.id, poolId, userId: owner })).toBe(true);
    expect((await getFriendPool(poolId, owner))!.entries).toHaveLength(0);
  });

  it("placar manual grava, limpa, e o banco veta meio placar", async () => {
    const poolId = await insertFriendPool({ userId: owner, matchId, title: null, entryAmountCents: null });
    expect(await setFriendPoolManualScore({ poolId, userId: owner, score: { home: 3, away: 3 } })).toBe(true);
    let pool = (await getFriendPool(poolId, owner))!.pool;
    expect([pool.manualHomeScore, pool.manualAwayScore]).toEqual([3, 3]);
    await setFriendPoolManualScore({ poolId, userId: owner, score: null });
    pool = (await getFriendPool(poolId, owner))!.pool;
    expect([pool.manualHomeScore, pool.manualAwayScore]).toEqual([null, null]);

    await expect(
      realDb
        .update(schema.friendPools)
        .set({ manualHomeScore: 1 })
        .where(eq(schema.friendPools.id, poolId)),
    ).rejects.toThrow();
  });

  it("excluir o bolão leva as apostas junto", async () => {
    const poolId = await insertFriendPool({ userId: owner, matchId, title: null, entryAmountCents: 500 });
    await insertFriendPoolEntry({ poolId, bettorName: "Duda", kind: "match_result", params: { selection: "draw" } });
    expect(await deleteFriendPool(poolId, owner)).toBe(true);
    const left = await realDb.execute(
      sql`select count(*)::int as n from friend_pool_entries where pool_id = ${poolId}`,
    );
    expect((left.rows[0] as { n: number }).n).toBe(0);
  });
});
