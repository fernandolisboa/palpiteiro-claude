import { and, eq, isNotNull } from "drizzle-orm";

import { palpiteOutcomes, palpiteSets, palpites } from "@/db/schema";
import {
  toConfidenceRow,
  type PalpiteConfidenceRow,
} from "@/lib/calibration/palpite-confidence";
import { db } from "@/lib/db";
import { isNewestPalpiteSetOfSide } from "@/lib/db/queries/palpites";

export type PalpiteConfidenceRows = {
  rows: PalpiteConfidenceRow[];
  // Liquidados que ficaram fora: sem placar (override manual sem resultData) ou jsonb
  // ilegível. Contados pra a página dizer quantos, em vez de sumirem do n.
  skipped: number;
};

// Calibração da confiança do palpite (#649, ADR 0069). Uma row por palpite PRÉ-JOGO
// liquidado: o set mais novo de cada (jogo, usuário), pelo mesmo critério da liquidação
// (isNewestPalpiteSetOfSide), com a linha exact_score e o placar de 90 minutos do
// outcome. Ao vivo fica fora: com o placar à vista a confiança satura e não mede o
// motor de pré-jogo.
export async function getPalpiteConfidenceRows(): Promise<PalpiteConfidenceRows> {
  const raw = await db
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
        isNewestPalpiteSetOfSide(),
      ),
    );
  const rows = raw.flatMap((r) => {
    const row = toConfidenceRow(r);
    return row ? [row] : [];
  });
  return { rows, skipped: raw.length - rows.length };
}
