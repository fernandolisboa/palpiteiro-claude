import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  lt,
  ne,
} from "drizzle-orm";

import {
  aiCalls,
  marketSelections,
  markets,
  matches,
  predictionOutcomes,
  predictionSelectionOdds,
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
  // Identidade de mercado da predição, resolvida por LEFT JOIN (#170): a row só
  // carrega marketId nullable, não a key. `marketKey` alimenta o registry de
  // apresentação na view (labels/scenarioLabel); a seleção recomendada vem de
  // prediction.recommendation, então o join de market_selections é desnecessário.
  // Nullable em históricas sem mercado backfillado → o chamador faz coalesce
  // 'over_under'.
  marketKey: string | null;
  // Candidate set N-vias CONGELADO desta predição (#173), uma entrada por seleção
  // do mercado (key resolvida via market_selections). Alimenta a grade N-vias do
  // toAnalysisView ao REABRIR uma predição passada — sem ela a grade 1X2 não
  // renderiza. over/under tem 2 rows e cai no caminho binário; 1X2 tem 3 e dispara
  // o caminho N-vias. `modelProbPct` é NULLABLE (backfill histórico / over/under
  // pré-#173 não a grava). Vazio em predições antigas sem PSO. numeric → string no
  // Drizzle: Number() na fronteira (modelProbPct ausente coalesce null→0).
  selections: { key: string; modelProbPct: number; odd: number | null }[];
};

// Mapeia uma row de prediction_selection_odds pra a forma da view. Casa ÚNICA da
// regra (usada por getLatestPredictionForMatch + getPredictionHistoryForMatch):
// numeric → string no Drizzle → Number() na fronteira (gotcha
// drizzle-numeric-returns-string). modelProbPct nullable (over/under pré-#173 /
// históricas) → coalesce 0; `odd` PRESERVA null (Number(odd ?? 0) viraria um 0
// errado). A assimetria odd-null vs prob-coalesce mora aqui, não em 2 cópias.
function mapSelectionRow(s: {
  key: string;
  odd: string | null;
  modelProbPct: string | null;
}): { key: string; modelProbPct: number; odd: number | null } {
  return {
    key: s.key,
    modelProbPct: Number(s.modelProbPct ?? 0),
    odd: s.odd === null ? null : Number(s.odd),
  };
}

// PARKADA (#204): sem caller de produção depois que a match page passou a derivar a
// análise atual de getPredictionHistoryForMatch()[0]. Mantida + testada pro cluster
// de match-page UI #242–#245 (pode voltar a precisar de um read single-latest); se
// esses pousarem consumindo o histórico, remover esta função + seu teste pglite.
export async function getLatestPredictionForMatch(
  matchId: string,
  userId: string,
): Promise<PredictionWithAiCall | null> {
  const rows = await db
    .select({
      prediction: predictions,
      aiCall: aiCalls,
      // LEFT (não INNER): uma row sem mercado (histórica não backfillada) ainda
      // volta — key null, view coalesce.
      marketKey: markets.key,
    })
    .from(predictions)
    .leftJoin(aiCalls, eq(predictions.aiCallId, aiCalls.id))
    .leftJoin(markets, eq(predictions.marketId, markets.id))
    .where(
      and(eq(predictions.matchId, matchId), eq(predictions.userId, userId)),
    )
    .orderBy(desc(predictions.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  // Candidate set congelado em query SEPARADA (não um leftJoin no select acima:
  // PSO multiplica as rows por seleção e quebraria o limit(1) da predição mais
  // recente). Ordenado por market_selections.sort_order pra a grade vir na ordem
  // canônica (over,under / home,draw,away). model_prob_pct nullable → Number(null)
  // = 0; só vale como prob quando gravado (Fase 4). odd numeric → Number() (gotcha
  // drizzle-numeric-returns-string).
  const selRows = await db
    .select({
      key: marketSelections.key,
      sortOrder: marketSelections.sortOrder,
      odd: predictionSelectionOdds.odd,
      modelProbPct: predictionSelectionOdds.modelProbPct,
    })
    .from(predictionSelectionOdds)
    .innerJoin(
      marketSelections,
      eq(predictionSelectionOdds.selectionId, marketSelections.id),
    )
    .where(eq(predictionSelectionOdds.predictionId, row.prediction.id))
    .orderBy(asc(marketSelections.sortOrder));

  return {
    ...row,
    selections: selRows.map(mapSelectionRow),
  };
}

/**
 * Histórico COMPLETO de predições de um jogo para um usuário, mais recente
 * primeiro — a MESMA forma por-row de getLatestPredictionForMatch (marketKey +
 * candidate set congelado), mas SEM limit(1): o chamador recebe cada (re)análise.
 *
 * A match page mapeia cada row por toAnalysisView pra renderizar o MESMO
 * <AnalysisResult/> market-agnostic tanto da análise ATUAL (history[0]) quanto de
 * cada ANTERIOR (history.slice(1) — a seção colapsável "análises anteriores", #204).
 * Daí a forma rica: `marketKey` alimenta o registry de apresentação (NUNCA hardcodar
 * over/under) e `selections` alimenta a grade N-vias (1X2). Escopada por (matchId E
 * userId) — nunca vaza predições de outro usuário (AC2). Ordem DETERMINÍSTICA via o
 * tiebreak desc(id): a lista inteira é renderizada agora, então um empate de
 * createdAt não pode reordenar entre requests.
 */
export async function getPredictionHistoryForMatch(
  matchId: string,
  userId: string,
): Promise<PredictionWithAiCall[]> {
  const rows = await db
    .select({
      prediction: predictions,
      aiCall: aiCalls,
      // LEFT (não INNER): uma row sem mercado (histórica não backfillada) ainda
      // volta — key null, a view coalesce pra 'over_under'.
      marketKey: markets.key,
    })
    .from(predictions)
    .leftJoin(aiCalls, eq(predictions.aiCallId, aiCalls.id))
    .leftJoin(markets, eq(predictions.marketId, markets.id))
    .where(
      and(eq(predictions.matchId, matchId), eq(predictions.userId, userId)),
    )
    .orderBy(desc(predictions.createdAt), desc(predictions.id));

  if (rows.length === 0) return [];

  // Candidate set congelado de TODAS as predições numa query BATCHEADA (inArray) —
  // evita N+1 (uma query extra, independente do tamanho do histórico).
  // orderBy(asc(predictionId), asc(sortOrder)): predictionId agrupa as rows de cada
  // predição num bloco contíguo; sortOrder dá a ordem canônica DENTRO do bloco
  // (over,under / home,draw,away) sem depender de ordem de stream implícita.
  const predIds = rows.map((r) => r.prediction.id);
  const selRows = await db
    .select({
      predictionId: predictionSelectionOdds.predictionId,
      key: marketSelections.key,
      odd: predictionSelectionOdds.odd,
      modelProbPct: predictionSelectionOdds.modelProbPct,
    })
    .from(predictionSelectionOdds)
    .innerJoin(
      marketSelections,
      eq(predictionSelectionOdds.selectionId, marketSelections.id),
    )
    .where(inArray(predictionSelectionOdds.predictionId, predIds))
    .orderBy(
      asc(predictionSelectionOdds.predictionId),
      asc(marketSelections.sortOrder),
    );

  // Agrupa por predictionId; cada grupo já vem em sortOrder asc (orderBy acima).
  const selByPrediction = new Map<
    string,
    { key: string; modelProbPct: number; odd: number | null }[]
  >();
  for (const s of selRows) {
    const list = selByPrediction.get(s.predictionId) ?? [];
    list.push(mapSelectionRow(s));
    selByPrediction.set(s.predictionId, list);
  }

  return rows.map((r) => ({
    ...r,
    selections: selByPrediction.get(r.prediction.id) ?? [],
  }));
}

// Minimum elapsed time after kickoff before a fixture is worth polling for a
// settlement result: 90' + halftime + stoppage, with margin. Settlement reads
// the 90' regulation score, so we don't need to wait out extra time.
const SETTLEMENT_MIN_ELAPSED_MS = 150 * 60 * 1000;

export type PendingSettlement = {
  predictionId: string;
  recommendation: DbPrediction["recommendation"];
  // Dispatch do settlement plugável (#166): settlement_rule_key do mercado e a
  // key da seleção escolhida, resolvidos por LEFT JOIN. Nullable: uma row sem
  // mercado/seleção (não ocorre pós-backfill) NÃO some do pending set — chega ao
  // settle, que a bucketa.
  settlementRuleKey: string | null;
  selectionKey: string | null;
  marketParams: DbPrediction["marketParams"];
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
      // LEFT (não INNER): uma row sem mercado/seleção não é silenciosamente
      // dropada do pending set — chega ao settle, que a bucketa.
      settlementRuleKey: markets.settlementRuleKey,
      selectionKey: marketSelections.key,
      marketParams: predictions.marketParams,
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
    .leftJoin(markets, eq(predictions.marketId, markets.id))
    .leftJoin(
      marketSelections,
      eq(predictions.selectionId, marketSelections.id),
    )
    .leftJoin(
      predictionOutcomes,
      eq(predictionOutcomes.predictionId, predictions.id),
    )
    .where(
      and(isNull(predictionOutcomes.id), lt(matches.kickoffAt, cutoff)),
    )
    .orderBy(desc(matches.kickoffAt));
}

// Um jogo perto do kickoff com ≥1 predição non-pass, + as keys de mercado distintas
// dessas predições (pra resolver os descriptors a capturar). `match` é a row inteira
// (ensureOddsSnapshotsFresh a consome).
export type NearKickoffMatch = {
  match: DbMatch;
  marketKeys: string[];
};

/**
 * Jogos com KO em (now, now+lookahead] que têm ≥1 predição NON-PASS (CLV, #180).
 * Filtra `recommendation != 'pass'` E `selectionId IS NOT NULL` (sem captura pra
 * pass — economia de quota, AC do #180) e status scheduled/live (não captura jogo
 * cancelado/adiado/já-finalizado). Agrupa em JS as keys de mercado distintas por
 * jogo: o caller resolve os descriptors e captura SÓ esses mercados. Rows sem
 * marketKey (histórica não-backfillada) são dropadas (não há descriptor a buscar).
 */
export async function getNonPassPredictionsNearKickoff(args: {
  now?: Date;
  lookaheadMs: number;
}): Promise<NearKickoffMatch[]> {
  const now = args.now ?? new Date();
  const until = new Date(now.getTime() + args.lookaheadMs);

  const rows = await db
    .select({ match: matches, marketKey: markets.key })
    .from(predictions)
    .innerJoin(matches, eq(predictions.matchId, matches.id))
    .leftJoin(markets, eq(predictions.marketId, markets.id))
    .where(
      and(
        ne(predictions.recommendation, "pass"),
        isNotNull(predictions.selectionId),
        inArray(matches.status, ["scheduled", "live"]),
        gt(matches.kickoffAt, now),
        lte(matches.kickoffAt, until),
      ),
    )
    .orderBy(asc(matches.kickoffAt));

  // Agrupa por jogo, keys de mercado distintas (Set). Sem marketKey → ignora.
  const byMatch = new Map<string, { match: DbMatch; keys: Set<string> }>();
  for (const r of rows) {
    if (!r.marketKey) continue;
    const entry = byMatch.get(r.match.id);
    if (entry) entry.keys.add(r.marketKey);
    else byMatch.set(r.match.id, { match: r.match, keys: new Set([r.marketKey]) });
  }
  return [...byMatch.values()].map((e) => ({
    match: e.match,
    marketKeys: [...e.keys],
  }));
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

/**
 * Feed de "análises recentes" do usuário. NÃO deduplica por jogo — lista cada
 * reanálise — por decisão de produto (ADR 0020): é um feed de atividade ("o que
 * analisei recentemente"), não um resumo de performance. Diverge de propósito
 * dos KPIs do dashboard, que contam só a predição mais recente por jogo (#116).
 */
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
