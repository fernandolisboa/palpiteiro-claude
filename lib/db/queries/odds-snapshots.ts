import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { matchOddsSnapshots } from "@/db/schema";
import { db } from "@/lib/db";
import { ODDS_SNAPSHOT_FRESHNESS_MS } from "@/lib/odds/freshness-window";

export type DbOddsSnapshot = typeof matchOddsSnapshots.$inferSelect;

export async function getLatestOddsSnapshot(
  matchId: string,
): Promise<DbOddsSnapshot | null> {
  const rows = await db
    .select()
    .from(matchOddsSnapshots)
    .where(
      and(
        eq(matchOddsSnapshots.matchId, matchId),
        eq(matchOddsSnapshots.market, "over_under_2_5"),
      ),
    )
    .orderBy(desc(matchOddsSnapshots.capturedAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Snapshot mais recente do match SOMENTE se ainda fresca (< TTL externo de
 * 30min, mesma definição que ensureOddsSnapshotsFresh usa em isFresh()).
 * Retorna null se não há snapshot ou se a existente já está stale.
 *
 * Comparador `<` idêntico ao de isFresh() pra que predict() (reuso) e
 * ensureOddsSnapshotsFresh (refetch) nunca discordem na fronteira de idade.
 */
export async function getLatestFreshOddsSnapshot(
  matchId: string,
  now: Date = new Date(),
): Promise<DbOddsSnapshot | null> {
  const snapshot = await getLatestOddsSnapshot(matchId);
  if (!snapshot) return null;
  const ageMs = now.getTime() - snapshot.capturedAt.getTime();
  return ageMs < ODDS_SNAPSHOT_FRESHNESS_MS ? snapshot : null;
}

/**
 * Batch read das snapshots MAIS RECENTES de over/under 2.5 pra cada match.
 * Uma query só (DISTINCT ON via subquery), nunca dispara fetch externo.
 * Usada pela home pra evitar N+1. Matches sem snapshot ficam fora do Map.
 */
export async function getLatestOddsSnapshotsForMatches(
  matchIds: string[],
): Promise<Map<string, DbOddsSnapshot>> {
  if (matchIds.length === 0) return new Map();

  // Postgres DISTINCT ON: pra cada match_id, pega a row com captured_at mais
  // recente. ORDER BY match_id, captured_at DESC é obrigatório.
  const rows = await db
    .selectDistinctOn([matchOddsSnapshots.matchId])
    .from(matchOddsSnapshots)
    .where(
      and(
        inArray(matchOddsSnapshots.matchId, matchIds),
        eq(matchOddsSnapshots.market, "over_under_2_5"),
      ),
    )
    .orderBy(matchOddsSnapshots.matchId, desc(matchOddsSnapshots.capturedAt));

  const out = new Map<string, DbOddsSnapshot>();
  for (const row of rows) {
    out.set(row.matchId, row);
  }
  return out;
}

export type InsertOddsSnapshotArgs = {
  matchId: string;
  bookmaker: string;
  overOdd: number;
  underOdd: number;
  overroundPct: number;
};

export async function insertOddsSnapshot(
  args: InsertOddsSnapshotArgs,
): Promise<void> {
  await db.insert(matchOddsSnapshots).values({
    matchId: args.matchId,
    bookmaker: args.bookmaker,
    market: "over_under_2_5",
    line: "2.5",
    overOdd: args.overOdd.toFixed(3),
    underOdd: args.underOdd.toFixed(3),
    overroundPct: args.overroundPct.toFixed(2),
  });
}

export async function insertOddsSnapshotsBatch(
  rows: InsertOddsSnapshotArgs[],
): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(matchOddsSnapshots).values(
    rows.map((r) => ({
      matchId: r.matchId,
      bookmaker: r.bookmaker,
      market: "over_under_2_5" as const,
      line: "2.5",
      overOdd: r.overOdd.toFixed(3),
      underOdd: r.underOdd.toFixed(3),
      overroundPct: r.overroundPct.toFixed(2),
    })),
  );
}

// Re-export for callers that compose further
export { sql };
