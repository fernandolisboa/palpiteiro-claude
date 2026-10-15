import { and, asc, count, desc, eq, sql } from "drizzle-orm";

import {
  friendPoolEntries,
  friendPools,
  matches,
  type BetLegParams,
} from "@/db/schema";
import { db } from "@/lib/db";
import type { LiveStamp } from "@/lib/live/stamp";
import type { PoolBetKind } from "@/lib/pools/pool-schema";

// Bolão entre amigos (#567). Toda leitura e escrita filtra pelo `userId` da sessão
// (anti-IDOR): o id do bolão vem da URL/form, o dono vem sempre do `auth()`.

export type DbFriendPool = typeof friendPools.$inferSelect;
export type DbFriendPoolEntry = typeof friendPoolEntries.$inferSelect;
type DbMatch = typeof matches.$inferSelect;

export type FriendPoolListRow = {
  pool: DbFriendPool;
  match: DbMatch;
  entryCount: number;
};

const LIST_LIMIT = 100;

export async function listFriendPools(userId: string): Promise<FriendPoolListRow[]> {
  const entryCount = db
    .select({ poolId: friendPoolEntries.poolId, n: count().as("n") })
    .from(friendPoolEntries)
    .innerJoin(friendPools, eq(friendPools.id, friendPoolEntries.poolId))
    .where(eq(friendPools.userId, userId))
    .groupBy(friendPoolEntries.poolId)
    .as("entry_count");
  const rows = await db
    .select({
      pool: friendPools,
      match: matches,
      entryCount: sql<number>`coalesce(${entryCount.n}, 0)`.mapWith(Number),
    })
    .from(friendPools)
    .innerJoin(matches, eq(matches.id, friendPools.matchId))
    .leftJoin(entryCount, eq(entryCount.poolId, friendPools.id))
    .where(eq(friendPools.userId, userId))
    .orderBy(desc(friendPools.createdAt))
    .limit(LIST_LIMIT);
  return rows;
}

export type FriendPoolDetail = {
  pool: DbFriendPool;
  match: DbMatch;
  entries: DbFriendPoolEntry[];
};

export async function getFriendPool(
  poolId: string,
  userId: string,
): Promise<FriendPoolDetail | null> {
  const [head] = await db
    .select({ pool: friendPools, match: matches })
    .from(friendPools)
    .innerJoin(matches, eq(matches.id, friendPools.matchId))
    .where(and(eq(friendPools.id, poolId), eq(friendPools.userId, userId)))
    .limit(1);
  if (!head) return null;
  const entries = await db
    .select()
    .from(friendPoolEntries)
    .where(eq(friendPoolEntries.poolId, poolId))
    .orderBy(asc(friendPoolEntries.createdAt), asc(friendPoolEntries.id));
  return { ...head, entries };
}

export async function insertFriendPool(input: {
  userId: string;
  matchId: string;
  title: string | null;
  entryAmountCents: number | null;
}): Promise<string> {
  const [row] = await db
    .insert(friendPools)
    .values(input)
    .returning({ id: friendPools.id });
  if (!row) throw new Error("insert friend_pools não devolveu id");
  return row.id;
}

/**
 * Grava a aposta de um apostador. O chamador já carregou o bolão com
 * `getFriendPool(poolId, userId)` (dono conferido, apostas abertas, teto de apostas).
 * Anotada ao vivo (#580): `isLive` + `liveState` vêm juntos de `liveColumns(stamp)`
 * (CHECK `is_live = false OR live_state IS NOT NULL`).
 */
export async function insertFriendPoolEntry(input: {
  poolId: string;
  bettorName: string;
  kind: PoolBetKind;
  params: BetLegParams;
  isLive?: boolean;
  liveState?: LiveStamp | null;
}): Promise<void> {
  await db.insert(friendPoolEntries).values(input);
}

/**
 * "Fechar apostas" do dono (#580): grava `bets_closed_at` e limpa a extensão (prazo e
 * quem estendeu). Só fecha; reabrir é só pela extensão do admin.
 */
export async function setFriendPoolBetsClosed(input: {
  poolId: string;
  userId: string;
  now: Date;
}): Promise<boolean> {
  const rows = await db
    .update(friendPools)
    .set({
      betsClosedAt: input.now,
      betsExtendedUntil: null,
      betsExtendedByUserId: null,
      updatedAt: input.now,
    })
    .where(and(eq(friendPools.id, input.poolId), eq(friendPools.userId, input.userId)))
    .returning({ id: friendPools.id });
  return rows.length > 0;
}

/**
 * "Estender prazo" do admin (#580), só nos próprios bolões (`userId` = dono): limpa o
 * fechamento do dono, grava até quando e quem estendeu.
 */
export async function setFriendPoolBetsExtended(input: {
  poolId: string;
  userId: string;
  until: Date;
  now: Date;
}): Promise<boolean> {
  const rows = await db
    .update(friendPools)
    .set({
      betsClosedAt: null,
      betsExtendedUntil: input.until,
      betsExtendedByUserId: input.userId,
      updatedAt: input.now,
    })
    .where(and(eq(friendPools.id, input.poolId), eq(friendPools.userId, input.userId)))
    .returning({ id: friendPools.id });
  return rows.length > 0;
}

export async function deleteFriendPoolEntry(input: {
  entryId: string;
  poolId: string;
  userId: string;
}): Promise<boolean> {
  const rows = await db
    .delete(friendPoolEntries)
    .where(
      and(
        eq(friendPoolEntries.id, input.entryId),
        eq(friendPoolEntries.poolId, input.poolId),
        sql`exists (select 1 from ${friendPools} where ${friendPools.id} = ${input.poolId} and ${friendPools.userId} = ${input.userId})`,
      ),
    )
    .returning({ id: friendPoolEntries.id });
  return rows.length > 0;
}

export async function setFriendPoolManualScore(input: {
  poolId: string;
  userId: string;
  score: { home: number; away: number } | null;
}): Promise<boolean> {
  const rows = await db
    .update(friendPools)
    .set({
      manualHomeScore: input.score?.home ?? null,
      manualAwayScore: input.score?.away ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(friendPools.id, input.poolId), eq(friendPools.userId, input.userId)))
    .returning({ id: friendPools.id });
  return rows.length > 0;
}

export async function deleteFriendPool(poolId: string, userId: string): Promise<boolean> {
  const rows = await db
    .delete(friendPools)
    .where(and(eq(friendPools.id, poolId), eq(friendPools.userId, userId)))
    .returning({ id: friendPools.id });
  return rows.length > 0;
}
