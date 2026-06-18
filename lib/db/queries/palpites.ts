import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { aiCalls, palpiteOutcomes, palpiteSets, palpites } from "@/db/schema";
import { db } from "@/lib/db";
import type { DbAiCall } from "@/lib/db/queries/predictions";

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
  // caminho de palpite só EMITE won/lost (PLAN §1.4) — afunilamos pro literal
  // estreito aqui (cast seguro: nenhum void/push é gravado em palpite_outcomes).
  const linesBySet = new Map<string, PalpiteSetWithLines["palpites"]>();
  for (const l of lines) {
    const list = linesBySet.get(l.palpite.palpiteSetId) ?? [];
    list.push({
      ...l.palpite,
      outcome:
        l.outcomeResult === null
          ? null
          : { result: l.outcomeResult as "won" | "lost" },
    });
    linesBySet.set(l.palpite.palpiteSetId, list);
  }

  return sets.map((s) => ({
    palpiteSet: s.palpiteSet,
    aiCall: s.aiCall,
    palpites: linesBySet.get(s.palpiteSet.id) ?? [],
  }));
}
