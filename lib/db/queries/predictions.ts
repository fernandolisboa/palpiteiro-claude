import { and, desc, eq, isNull, lt } from "drizzle-orm";

import {
  aiCalls,
  matches,
  predictionOutcomes,
  predictions,
} from "@/db/schema";
import { db } from "@/lib/db";

export type DbPrediction = typeof predictions.$inferSelect;
export type DbAiCall = typeof aiCalls.$inferSelect;
export type DbMatch = typeof matches.$inferSelect;
export type DbPredictionOutcome = typeof predictionOutcomes.$inferSelect;

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

/**
 * Full prediction history for a match scoped to one user, newest first — the
 * same select/leftJoin shape as getLatestPredictionForMatch but WITHOUT limit(1),
 * so the caller gets every (re)analysis instead of only the latest. Scoped by
 * userId so it never leaks other users' predictions. Market-agnostic (selects
 * whole prediction rows), so it survives the multi-market pivot untouched.
 */
export async function getPredictionHistoryForMatch(
  matchId: string,
  userId: string,
): Promise<PredictionWithAiCall[]> {
  return db
    .select({
      prediction: predictions,
      aiCall: aiCalls,
    })
    .from(predictions)
    .leftJoin(aiCalls, eq(predictions.aiCallId, aiCalls.id))
    .where(
      and(eq(predictions.matchId, matchId), eq(predictions.userId, userId)),
    )
    .orderBy(desc(predictions.createdAt));
}

// Minimum elapsed time after kickoff before a fixture is worth polling for a
// settlement result: 90' + halftime + stoppage, with margin. Settlement reads
// the 90' regulation score, so we don't need to wait out extra time.
const SETTLEMENT_MIN_ELAPSED_MS = 150 * 60 * 1000;

export type PendingSettlement = {
  predictionId: string;
  recommendation: DbPrediction["recommendation"];
  oddAtRecommendation: DbPrediction["oddAtRecommendation"];
  stakeUnits: DbPrediction["stakeUnits"];
  matchId: string;
  league: DbMatch["league"];
  kickoffAt: Date;
  homeTeam: string;
  awayTeam: string;
};

/**
 * Predictions still awaiting settlement: no prediction_outcomes row yet and
 * their match kicked off long enough ago to have a 90' result. A prediction
 * already settled OR manually overridden has an outcome row, so the LEFT JOIN
 * IS NULL filter excludes it — i.e. a manual override always wins and is never
 * re-touched by the cron.
 */
export async function getPendingSettlementPredictions(
  now: Date = new Date(),
): Promise<PendingSettlement[]> {
  const cutoff = new Date(now.getTime() - SETTLEMENT_MIN_ELAPSED_MS);
  return db
    .select({
      predictionId: predictions.id,
      recommendation: predictions.recommendation,
      oddAtRecommendation: predictions.oddAtRecommendation,
      stakeUnits: predictions.stakeUnits,
      matchId: matches.id,
      league: matches.league,
      kickoffAt: matches.kickoffAt,
      homeTeam: matches.homeTeam,
      awayTeam: matches.awayTeam,
    })
    .from(predictions)
    .innerJoin(matches, eq(predictions.matchId, matches.id))
    .leftJoin(
      predictionOutcomes,
      eq(predictionOutcomes.predictionId, predictions.id),
    )
    .where(
      and(isNull(predictionOutcomes.id), lt(matches.kickoffAt, cutoff)),
    )
    .orderBy(desc(matches.kickoffAt));
}

export type PredictionForOverride = {
  prediction: DbPrediction;
  match: DbMatch;
  outcome: DbPredictionOutcome | null;
};

export async function getPredictionForOverride(
  predictionId: string,
): Promise<PredictionForOverride | null> {
  const rows = await db
    .select({
      prediction: predictions,
      match: matches,
      outcome: predictionOutcomes,
    })
    .from(predictions)
    .innerJoin(matches, eq(predictions.matchId, matches.id))
    .leftJoin(
      predictionOutcomes,
      eq(predictionOutcomes.predictionId, predictions.id),
    )
    .where(eq(predictions.id, predictionId))
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
