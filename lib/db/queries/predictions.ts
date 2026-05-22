import { and, desc, eq } from "drizzle-orm";

import { aiCalls, matches, predictions } from "@/db/schema";
import { db } from "@/lib/db";

export type DbPrediction = typeof predictions.$inferSelect;
export type DbAiCall = typeof aiCalls.$inferSelect;
export type DbMatch = typeof matches.$inferSelect;

export type PredictionWithAiCall = {
  prediction: DbPrediction;
  aiCall: DbAiCall | null;
};

export async function getLatestPredictionForMatch(
  matchId: string,
  userId: string,
): Promise<PredictionWithAiCall | null> {
  const rows = await db
    .select({
      prediction: predictions,
      aiCall: aiCalls,
    })
    .from(predictions)
    .leftJoin(aiCalls, eq(predictions.aiCallId, aiCalls.id))
    .where(
      and(eq(predictions.matchId, matchId), eq(predictions.userId, userId)),
    )
    .orderBy(desc(predictions.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAiCallById(id: string): Promise<DbAiCall | null> {
  const rows = await db
    .select()
    .from(aiCalls)
    .where(eq(aiCalls.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export type RecentPredictionRow = {
  predictionId: string;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  league: DbMatch["league"];
  recommendation: DbPrediction["recommendation"];
  edgePct: DbPrediction["edgePct"];
  createdAt: Date;
};

export async function getRecentPredictionsByUser(
  userId: string,
  limit = 5,
): Promise<RecentPredictionRow[]> {
  const rows = await db
    .select({
      predictionId: predictions.id,
      matchId: predictions.matchId,
      homeTeam: matches.homeTeam,
      awayTeam: matches.awayTeam,
      league: matches.league,
      recommendation: predictions.recommendation,
      edgePct: predictions.edgePct,
      createdAt: predictions.createdAt,
    })
    .from(predictions)
    .innerJoin(matches, eq(predictions.matchId, matches.id))
    .where(eq(predictions.userId, userId))
    .orderBy(desc(predictions.createdAt))
    .limit(limit);
  return rows;
}
