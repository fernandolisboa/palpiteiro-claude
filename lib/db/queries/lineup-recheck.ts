import { and, asc, desc, eq, gt, isNotNull, lte, or, sql } from "drizzle-orm";

import {
  marketSelections,
  markets,
  matches,
  predictionSelectionOdds,
  predictions,
} from "@/db/schema";
import type { PredictionJudgments } from "@/lib/ai/engine/types";
import { db } from "@/lib/db";

import type { DbMatch, DbPrediction } from "./predictions";

// Reconferência com a escalação (#619, PR B). Queries do cron recheck-lineups e da
// guarda antes do insert. Só leitura: a reconferência grava pela porta do predict.

// Janela dos jogos reconferidos: KO em (agora + 5 min, agora + 75 min]. A escalação sai
// ~20–60 min antes do KO; abaixo de 5 min não dá tempo de agir no número.
export const LINEUP_RECHECK_MIN_LEAD_MS = 5 * 60_000;
export const LINEUP_RECHECK_MAX_LEAD_MS = 75 * 60_000;

export type LineupRecheckCandidate = {
  prediction: DbPrediction;
  match: DbMatch;
  marketKey: string;
};

/**
 * Elegível a reconferência (pura): motor code_jev com o λ de base gravado, ainda não é
 * uma reconferência, feita antes da escalação sair (`lineup` ausente nas rows v2 ou
 * `not_announced`) e sem contexto extra do usuário (#565: o número dela não é só do
 * modelo). Pass e aposta entram.
 */
export function isLineupRecheckEligible(prediction: {
  judgments: PredictionJudgments | null;
  isLive: boolean;
}): boolean {
  const j = prediction.judgments;
  if (prediction.isLive || !j || j.engine !== "code_jev") return false;
  if (j.recheck || j.userContext) return false;
  if (j.lineup?.status === "announced") return false;
  const base = j.lambda?.base;
  return (
    base !== undefined &&
    Number.isFinite(base.home) &&
    Number.isFinite(base.away) &&
    base.home > 0 &&
    base.away > 0
  );
}

/**
 * Pais da reconferência: por (jogo, usuário, mercado), só a predição de PRÉ-JOGO mais
 * recente dos jogos agendados com KO na janela, e só se ela for elegível. O DISTINCT ON
 * vem ANTES da elegibilidade (ADR 0020: a mais recente é a análise atual): um pai que
 * já tem reconferência fica atrás dela, e a reconferência não é elegível → 0 candidatos;
 * uma análise interativa feita depois da escalação também esconde o pai. Ordem: KO mais
 * próximo primeiro.
 */
export async function getLineupRecheckCandidates(args: {
  now?: Date;
}): Promise<LineupRecheckCandidate[]> {
  const now = args.now ?? new Date();
  const from = new Date(now.getTime() + LINEUP_RECHECK_MIN_LEAD_MS);
  const until = new Date(now.getTime() + LINEUP_RECHECK_MAX_LEAD_MS);
  const rows = await db
    .selectDistinctOn(
      [predictions.matchId, predictions.userId, predictions.marketId],
      { prediction: predictions, match: matches, marketKey: markets.key },
    )
    .from(predictions)
    .innerJoin(matches, eq(predictions.matchId, matches.id))
    .innerJoin(markets, eq(predictions.marketId, markets.id))
    .where(
      and(
        eq(matches.status, "scheduled"),
        gt(matches.kickoffAt, from),
        lte(matches.kickoffAt, until),
        eq(predictions.isLive, false),
        isNotNull(predictions.marketId),
      ),
    )
    .orderBy(
      predictions.matchId,
      predictions.userId,
      predictions.marketId,
      desc(predictions.createdAt),
      desc(predictions.id),
    );
  return rows
    .filter((r) => isLineupRecheckEligible(r.prediction))
    .sort(
      (a, b) =>
        a.match.kickoffAt.getTime() - b.match.kickoffAt.getTime() ||
        a.prediction.createdAt.getTime() - b.prediction.createdAt.getTime(),
    );
}

/**
 * Há predição de pré-jogo mais nova que o pai no mesmo balde (jogo, usuário, mercado)?
 * Guarda da corrida com a análise interativa (ou outro run), imediatamente antes do
 * insert: o pai deixou de ser a análise atual → a reconferência não grava. "Mais nova"
 * segue a ordem do display: createdAt maior, ou igual com id maior.
 */
export async function hasNewerPreMatchPrediction(parent: {
  id: string;
  matchId: string;
  userId: string;
  marketId: string;
  createdAt: Date;
}): Promise<boolean> {
  const rows = await db
    .select({ id: predictions.id })
    .from(predictions)
    .where(
      and(
        eq(predictions.matchId, parent.matchId),
        eq(predictions.userId, parent.userId),
        eq(predictions.marketId, parent.marketId),
        eq(predictions.isLive, false),
        or(
          gt(predictions.createdAt, parent.createdAt),
          and(
            eq(predictions.createdAt, parent.createdAt),
            sql`${predictions.id} > ${parent.id}`,
          ),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Odds congeladas do pai (prediction_selection_odds), keyed pela seleção: o fallback da
 * reconferência quando o banco não tem captura recente (zero crédito da The Odds API).
 * Seleção sem odd fica de fora.
 */
export async function getFrozenSelectionOdds(
  predictionId: string,
): Promise<{ key: string; odd: number }[]> {
  const rows = await db
    .select({ key: marketSelections.key, odd: predictionSelectionOdds.odd })
    .from(predictionSelectionOdds)
    .innerJoin(
      marketSelections,
      eq(predictionSelectionOdds.selectionId, marketSelections.id),
    )
    .where(eq(predictionSelectionOdds.predictionId, predictionId))
    .orderBy(asc(marketSelections.sortOrder));
  return rows.flatMap((r) =>
    r.odd === null ? [] : [{ key: r.key, odd: Number(r.odd) }],
  );
}
