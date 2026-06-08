import { and, desc, eq } from "drizzle-orm";

import {
  aiCalls,
  matches,
  predictionOutcomes,
  predictions,
} from "@/db/schema";
import { db } from "@/lib/db";
import type { DashboardRow } from "@/lib/dashboard/kpis";

import type {
  DbAiCall,
  DbMatch,
  DbPrediction,
  DbPredictionOutcome,
} from "./predictions";

/**
 * Todas as predições do usuário (+ outcome, se liquidado) pro dashboard. Lean:
 * só o necessário pra KPIs, gráfico e tabela. SCOPED por `userId` — base de toda
 * a privacidade per-user. Outcome via LEFT JOIN (null = pendente).
 */
export async function getUserDashboardRows(
  userId: string,
): Promise<DashboardRow[]> {
  return db
    .select({
      predictionId: predictions.id,
      recommendation: predictions.recommendation,
      market: predictions.market,
      league: matches.league,
      homeTeam: matches.homeTeam,
      awayTeam: matches.awayTeam,
      stakeUnits: predictions.stakeUnits,
      oddAtRecommendation: predictions.oddAtRecommendation,
      edgePct: predictions.edgePct,
      confidencePct: predictions.confidencePct,
      createdAt: predictions.createdAt,
      result: predictionOutcomes.result,
      profitUnits: predictionOutcomes.profitUnits,
      settledAt: predictionOutcomes.settledAt,
    })
    .from(predictions)
    .innerJoin(matches, eq(predictions.matchId, matches.id))
    .leftJoin(
      predictionOutcomes,
      eq(predictionOutcomes.predictionId, predictions.id),
    )
    .where(eq(predictions.userId, userId))
    .orderBy(desc(predictions.createdAt));
}

export type DashboardDetail = {
  prediction: DbPrediction;
  match: DbMatch;
  outcome: DbPredictionOutcome | null;
  aiCall: DbAiCall | null;
};

/**
 * Detalhe de UMA predição pro drill-down. SCOPED: `predictions.id = ? AND
 * predictions.userId = ?` — retorna null se a predição não for do usuário, então
 * a página dá 404 e ninguém vê predição/payload de outro usuário.
 */
export async function getPredictionDetailForUser(
  predictionId: string,
  userId: string,
): Promise<DashboardDetail | null> {
  const rows = await db
    .select({
      prediction: predictions,
      match: matches,
      outcome: predictionOutcomes,
      aiCall: aiCalls,
    })
    .from(predictions)
    .innerJoin(matches, eq(predictions.matchId, matches.id))
    .leftJoin(
      predictionOutcomes,
      eq(predictionOutcomes.predictionId, predictions.id),
    )
    .leftJoin(aiCalls, eq(predictions.aiCallId, aiCalls.id))
    .where(and(eq(predictions.id, predictionId), eq(predictions.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}
