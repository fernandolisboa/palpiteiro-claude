import { and, asc, desc, eq, gt, inArray, isNull, lt, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  aiCalls,
  matches,
  palpiteOutcomes,
  palpiteSets,
  palpites,
} from "@/db/schema";
import { db } from "@/lib/db";
import {
  SETTLEMENT_MIN_ELAPSED_MS,
  type DbAiCall,
  type DbMatch,
} from "@/lib/db/queries/predictions";

export type DbPalpiteSet = typeof palpiteSets.$inferSelect;
export type DbPalpite = typeof palpites.$inferSelect;
export type DbPalpiteOutcome = typeof palpiteOutcomes.$inferSelect;

export type PalpiteSetWithLines = {
  palpiteSet: DbPalpiteSet;
  // Nullable: aiCallId é NULLABLE em palpite_sets (divergência deliberada vs
  // predictions.aiCallId notNull — a auto-geração #315 pode falhar e ainda
  // produzir um set válido). LEFT join → null quando não há ai_call. O consumidor
  // (#316) trata.
  aiCall: DbAiCall | null;
  // Linhas do set + outcome estreito. `outcome` é null quando a linha não é
  // settleable (red_card/corners) OU ainda não foi liquidada (exact_score
  // pendente). O literal "won" | "lost" é a forma ESTREITA (PLAN §1.4) — void/push
  // nunca alcançam palpite.
  palpites: (DbPalpite & {
    outcome: { result: "won" | "lost" } | null;
  })[];
};

/**
 * Histórico COMPLETO de palpite_sets de um jogo para um usuário, mais recente
 * primeiro — espelha getPredictionHistoryForMatch (lib/db/queries/predictions.ts):
 * escopo por (matchId AND userId) (nunca vaza palpites de outro usuário), ordem
 * newest-first DETERMINÍSTICA via tiebreak desc(id) (a lista inteira é renderizada
 * agora, então um empate de createdAt não pode reordenar entre requests), SEM
 * limit, e as linhas BATCHEADAS via inArray (sem N+1, uma 2ª query independente do
 * tamanho do histórico).
 *
 * Retorna SEMPRE `[]` quando vazio (nunca null). Consumida por #316 (UI) e pelo
 * gerador de #315 (contexto de exclusão).
 */
export async function getPalpiteSetsForMatch(
  matchId: string,
  userId: string
): Promise<PalpiteSetWithLines[]> {
  // Query 1: sets + aiCall. LEFT join — aiCallId nullable → aiCall pode ser null.
  const sets = await db
    .select({ palpiteSet: palpiteSets, aiCall: aiCalls })
    .from(palpiteSets)
    .leftJoin(aiCalls, eq(palpiteSets.aiCallId, aiCalls.id))
    .where(
      and(eq(palpiteSets.matchId, matchId), eq(palpiteSets.userId, userId))
    )
    .orderBy(desc(palpiteSets.createdAt), desc(palpiteSets.id));
  if (sets.length === 0) return [];

  // Query 2: linhas + outcome de TODOS os sets numa query BATCHEADA (inArray) —
  // evita N+1. orderBy(asc(palpiteSetId), asc(createdAt), asc(id)): palpiteSetId
  // agrupa cada set num bloco contíguo; createdAt+id dão ordem canônica e
  // determinística DENTRO do bloco. outcomeResult vem do LEFT join (null em
  // settleable=false ou ainda-pendente).
  const setIds = sets.map((s) => s.palpiteSet.id);
  const lines = await db
    .select({ palpite: palpites, outcomeResult: palpiteOutcomes.result })
    .from(palpites)
    .leftJoin(palpiteOutcomes, eq(palpiteOutcomes.palpiteId, palpites.id))
    .where(inArray(palpites.palpiteSetId, setIds))
    .orderBy(
      asc(palpites.palpiteSetId),
      asc(palpites.createdAt),
      asc(palpites.id)
    );

  // Agrupa as linhas por palpiteSetId (mesmo padrão de selByPrediction em
  // predictions.ts). `result` da coluna é o pgEnum amplo (won/lost/void/push); o
  // caminho de palpite só EMITE won/lost (PLAN §1.4). Afunilamos por NARROW
  // explícito em runtime (não cast): qualquer coisa fora de won/lost — incluindo
  // null, ou um void/push hipotético de mau-uso futuro do enum — vira outcome null.
  const linesBySet = new Map<string, PalpiteSetWithLines["palpites"]>();
  for (const l of lines) {
    const list = linesBySet.get(l.palpite.palpiteSetId) ?? [];
    list.push({
      ...l.palpite,
      outcome:
        l.outcomeResult === "won" || l.outcomeResult === "lost"
          ? { result: l.outcomeResult }
          : null,
    });
    linesBySet.set(l.palpite.palpiteSetId, list);
  }

  return sets.map((s) => ({
    palpiteSet: s.palpiteSet,
    aiCall: s.aiCall,
    palpites: linesBySet.get(s.palpiteSet.id) ?? [],
  }));
}

export type PendingPalpiteSettlement = {
  palpiteId: string;
  params: DbPalpite["params"];
  matchId: string;
  league: DbMatch["league"];
  kickoffAt: Date;
  homeTeam: string;
  awayTeam: string;
};

/**
 * Palpites de placar exato ainda aguardando liquidação: sem palpite_outcomes row
 * E o jogo começou há tempo suficiente pra ter um placar de 90'. Espelha
 * getPendingSettlementPredictions (lib/db/queries/predictions.ts) — mesmo cutoff
 * SETTLEMENT_MIN_ELAPSED_MS (importado, NÃO duplicado), mesmo LEFT-join IS NULL
 * (um palpite já liquidado/overridden tem outcome row → excluído).
 *
 * O filtro `type='exact_score' AND settleable=true` é o GATE que honra "prefer
 * skip over silent wrong settle" (ADR 0028 §3): red_card/corners (settleable=false)
 * NUNCA entram no pending set, nunca recebem outcome. Gate duplo (type E
 * settleable) — defense-in-depth contra uma escrita errada.
 *
 * LATEST-ONLY (ADR 0030 / #353, blocker #2): cada run do palpite-first grava um
 * `palpite_set` novo (semântica de regen, sets imutáveis newest-first), então um jogo
 * pode ter N sets/usuário. SÓ a ÚLTIMA geração por (matchId,userId) liquida —
 * `notExists` de um set mais novo do mesmo (match,user). Mantém paridade com o display,
 * que já mostra `sets[0]`. Sem isso, N badges/jogo apareceriam.
 */
export async function getPendingPalpiteSettlements(
  now: Date = new Date()
): Promise<PendingPalpiteSettlement[]> {
  const cutoff = new Date(now.getTime() - SETTLEMENT_MIN_ELAPSED_MS);
  const newerSet = alias(palpiteSets, "newer_set");
  return db
    .select({
      palpiteId: palpites.id,
      params: palpites.params,
      matchId: matches.id,
      league: matches.league,
      kickoffAt: matches.kickoffAt,
      homeTeam: matches.homeTeam,
      awayTeam: matches.awayTeam,
    })
    .from(palpites)
    .innerJoin(palpiteSets, eq(palpites.palpiteSetId, palpiteSets.id))
    .innerJoin(matches, eq(palpiteSets.matchId, matches.id))
    .leftJoin(palpiteOutcomes, eq(palpiteOutcomes.palpiteId, palpites.id))
    .where(
      and(
        eq(palpites.type, "exact_score"),
        eq(palpites.settleable, true),
        isNull(palpiteOutcomes.id),
        lt(matches.kickoffAt, cutoff),
        // Só a última geração por (matchId,userId): não existe um set mais novo do
        // MESMO match+user. Tiebreak por id (createdAt pode empatar em writes do
        // mesmo instante) — espelha o desc(createdAt), desc(id) do display.
        notExists(
          db
            .select({ one: newerSet.id })
            .from(newerSet)
            .where(
              and(
                eq(newerSet.matchId, palpiteSets.matchId),
                eq(newerSet.userId, palpiteSets.userId),
                gt(newerSet.createdAt, palpiteSets.createdAt)
              )
            )
        )
      )
    )
    .orderBy(desc(matches.kickoffAt));
}
