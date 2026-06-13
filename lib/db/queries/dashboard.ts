import { and, desc, eq } from "drizzle-orm";

import {
  aiCalls,
  markets,
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

// Fallback enum→key pras rows SEM marketId (históricas pré-backfill, e qualquer
// ambiente onde o backfill #162 — script manual, NÃO migration — não rodou: CI,
// pglite, preview fresh). O enum legado `over_under_2_5` (schema.ts) é a key de
// seed `over_under` (migration 0009). Coalesce SEMPRE pra uma key válida — nunca
// null/"unknown" — ou a paridade quebra.
const MARKET_ENUM_TO_KEY: Record<string, string> = {
  over_under_2_5: "over_under",
};

function marketEnumToKey(market: string): string {
  return MARKET_ENUM_TO_KEY[market] ?? "over_under";
}

// Label de fallback espelha markets.label do seed 0009 (single-source quando o
// join resolve; defensivo aqui pra rows sem marketId).
const MARKET_KEY_TO_LABEL: Record<string, string> = {
  over_under: "Over/Under gols",
};

function marketLabelForKey(key: string): string {
  return MARKET_KEY_TO_LABEL[key] ?? key;
}

/**
 * Todas as predições do usuário (+ outcome, se liquidado) pro dashboard. Lean:
 * só o necessário pra KPIs, gráfico e tabela. SCOPED por `userId` — base de toda
 * a privacidade per-user. Outcome via LEFT JOIN (null = pendente).
 *
 * LEFT JOIN markets (espelha o precedente em predictions.ts:120) resolve a key
 * CANÔNICA do mercado. `markets.key` null (row sem marketId) cai no fallback
 * enum→key, coalescendo pra `over_under` — o caminho PRIMÁRIO de paridade onde
 * o backfill não rodou, não só defensivo (R2).
 */
export async function getUserDashboardRows(
  userId: string,
): Promise<DashboardRow[]> {
  const rows = await db
    .select({
      predictionId: predictions.id,
      matchId: predictions.matchId,
      recommendation: predictions.recommendation,
      market: predictions.market,
      marketKey: markets.key,
      marketLabel: markets.label,
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
    .leftJoin(markets, eq(predictions.marketId, markets.id))
    .leftJoin(
      predictionOutcomes,
      eq(predictionOutcomes.predictionId, predictions.id),
    )
    .where(eq(predictions.userId, userId))
    .orderBy(desc(predictions.createdAt));

  return rows.map(({ market, marketKey, marketLabel, ...rest }) => {
    const key = marketKey ?? marketEnumToKey(market);
    return {
      ...rest,
      marketKey: key,
      marketLabel: marketLabel ?? marketLabelForKey(key),
    };
  });
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
