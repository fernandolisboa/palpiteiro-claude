import { and, desc, eq, gte, sql } from "drizzle-orm";

import { predictions } from "@/db/schema";
import type { PredictionJudgments } from "@/lib/ai/engine/types";
import { db } from "@/lib/db";

export type ReusableJudgments = {
  predictionId: string;
  judgments: PredictionJudgments;
};

/**
 * Julgamentos JEV reaproveitáveis (ADR 0041 §1: uma chamada JEV por jogo, não por
 * mercado). A predição code_jev mais recente do jogo cujo `judgments` foi aplicado
 * com as MESMAS versões (perguntas + pesos) e o MESMO `stateHash`, criada a partir
 * de `since`. Não filtra por usuário: as respostas são sobre o jogo, não sobre quem
 * pediu. null = nenhuma → o chamador chama o JEV.
 */
export async function findReusableJudgments(args: {
  matchId: string;
  judgmentsVersion: string;
  weightsVersion: string;
  stateHash: string;
  since: Date;
}): Promise<ReusableJudgments | null> {
  const rows = await db
    .select({ id: predictions.id, judgments: predictions.judgments })
    .from(predictions)
    .where(
      and(
        eq(predictions.matchId, args.matchId),
        gte(predictions.createdAt, args.since),
        sql`${predictions.judgments}->>'applied' = 'true'`,
        sql`${predictions.judgments}->>'stateHash' = ${args.stateHash}`,
        sql`${predictions.judgments}->'versions'->>'judgments' = ${args.judgmentsVersion}`,
        sql`${predictions.judgments}->'versions'->>'weights' = ${args.weightsVersion}`
      )
    )
    .orderBy(desc(predictions.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row?.judgments?.answers) return null;
  return { predictionId: row.id, judgments: row.judgments };
}
