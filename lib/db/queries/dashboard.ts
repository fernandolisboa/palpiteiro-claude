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

// `market` é nullable desde o expand multi-mercado (#173): rows de mercado novo
// gravam `market=null` (fonte de verdade = marketId, resolvido pelo LEFT JOIN
// acima). Aqui só importam as rows SEM marketId; null/desconhecido coalesce pra
// "over_under" exatamente como o enum legado — o caso real é só over/under.
export function marketEnumToKey(market: string | null): string {
  return (market !== null && MARKET_ENUM_TO_KEY[market]) || "over_under";
}

// Label de fallback espelha markets.label do seed 0009 (single-source quando o
// join resolve; defensivo aqui pra rows sem marketId).
const MARKET_KEY_TO_LABEL: Record<string, string> = {
  over_under: "Over/Under gols",
};

function marketLabelForKey(key: string): string {
  return MARKET_KEY_TO_LABEL[key] ?? key;
}

// Row crua do select (markets via LEFT JOIN → key/label NULL quando a row não tem
// marketId). `toDashboardRow` é PURA + exportada pra testar o coalesce — o caminho
// PRIMÁRIO de paridade (marketId null → over_under) — sem subir um banco.
export type RawUserDashboardRow = Omit<
  DashboardRow,
  "marketKey" | "marketLabel"
> & {
  market: string | null;
  marketKey: string | null;
  marketLabel: string | null;
};

export function toDashboardRow({
  market,
  marketKey,
  marketLabel,
  ...rest
}: RawUserDashboardRow): DashboardRow {
  const key = marketKey ?? marketEnumToKey(market);
  return {
    ...rest,
    marketKey: key,
    marketLabel: marketLabel ?? marketLabelForKey(key),
  };
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

  return rows.map(toDashboardRow);
}

export type DashboardDetail = {
  prediction: DbPrediction;
  match: DbMatch;
  outcome: DbPredictionOutcome | null;
  aiCall: DbAiCall | null;
  // Key CANÔNICA do mercado, resolvida por LEFT JOIN markets (espelha
  // getUserDashboardRows). Alimenta recToken/settlementMetricLabel da detail view
  // (1X2 → "Casa"/label do mercado, não o default over_under). Nullable em rows sem
  // marketId (históricas pré-backfill) → o chamador faz coalesce 'over_under'.
  marketKey: string | null;
};

/**
 * Detalhe de UMA predição pro drill-down. SCOPED: `predictions.id = ? AND
 * predictions.userId = ?` — retorna null se a predição não for do usuário, então
 * a página dá 404 e ninguém vê predição/payload de outro usuário.
 *
 * LEFT JOIN markets (espelha getUserDashboardRows / predictions.ts) resolve a key
 * canônica do mercado pra a detail view rotular 1X2 corretamente; null (row sem
 * marketId) cai no coalesce 'over_under' do view-mapper.
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
      marketKey: markets.key,
    })
    .from(predictions)
    .innerJoin(matches, eq(predictions.matchId, matches.id))
    .leftJoin(
      predictionOutcomes,
      eq(predictionOutcomes.predictionId, predictions.id),
    )
    .leftJoin(aiCalls, eq(predictions.aiCallId, aiCalls.id))
    .leftJoin(markets, eq(predictions.marketId, markets.id))
    .where(and(eq(predictions.id, predictionId), eq(predictions.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}
