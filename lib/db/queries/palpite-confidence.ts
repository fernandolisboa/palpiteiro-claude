import { and, eq, gt, isNotNull, notExists, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  palpiteOutcomes,
  palpiteSets,
  palpites,
} from "@/db/schema";
import {
  toConfidenceRow,
  type PalpiteConfidenceRow,
} from "@/lib/calibration/palpite-confidence";
import { db } from "@/lib/db";

// Calibração da confiança do palpite (#649, ADR 0069). Uma row por palpite PRÉ-JOGO
// liquidado: o set mais novo de cada (jogo, usuário), o mesmo que a liquidação considera
// (getPendingPalpiteSettlements: notExists de um set mais novo do mesmo lado), com a
// linha exact_score e o placar de 90 minutos do outcome. Ao vivo fica fora: com o placar
// à vista a confiança satura e não mede o motor de pré-jogo.
export async function getPalpiteConfidenceRows(): Promise<PalpiteConfidenceRow[]> {
  const newerSet = alias(palpiteSets, "newer_set");
  const rows = await db
    .select({
      matchId: palpiteSets.matchId,
      headline: palpiteSets.headline,
      probableScore: palpites.params,
      resultData: palpiteOutcomes.resultData,
    })
    .from(palpiteSets)
    .innerJoin(palpites, eq(palpites.palpiteSetId, palpiteSets.id))
    .innerJoin(palpiteOutcomes, eq(palpiteOutcomes.palpiteId, palpites.id))
    .where(
      and(
        eq(palpiteSets.isLive, false),
        isNotNull(palpiteSets.headline),
        eq(palpites.type, "exact_score"),
        notExists(
          db
            .select({ one: newerSet.id })
            .from(newerSet)
            .where(
              and(
                eq(newerSet.matchId, palpiteSets.matchId),
                eq(newerSet.userId, palpiteSets.userId),
                eq(newerSet.isLive, false),
                or(
                  gt(newerSet.createdAt, palpiteSets.createdAt),
                  and(
                    eq(newerSet.createdAt, palpiteSets.createdAt),
                    gt(newerSet.id, palpiteSets.id),
                  ),
                ),
              ),
            ),
        ),
      ),
    );
  return rows.flatMap((r) => {
    const row = toConfidenceRow(r);
    return row ? [row] : [];
  });
}
