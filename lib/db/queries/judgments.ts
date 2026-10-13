import { and, desc, eq, gte, sql } from "drizzle-orm";

import { predictions } from "@/db/schema";
import type { PredictionJudgments } from "@/lib/ai/engine/types";
import { db } from "@/lib/db";
import { findReusableSnapshotJudgments } from "@/lib/db/queries/match-model-snapshots";

// O que o reuso lê do registro achado, comum às duas origens (predição e base do
// modelo, #555): as respostas, a chamada JEV de origem e a cadeia de reuso.
export type ReusableJudgmentsRecord = Pick<
  PredictionJudgments,
  | "answers"
  | "aiCallId"
  | "reusedFromPredictionId"
  | "reusedFromModelSnapshotId"
> & {
  versions: Pick<PredictionJudgments["versions"], "jevModel" | "jevModelServed">;
};

export type ReusableJudgments = {
  // Origem predição (null quando veio da base do modelo).
  predictionId: string | null;
  // Origem base do modelo (#555). Opcional: ausente = origem predição.
  modelSnapshotId?: string | null;
  judgments: ReusableJudgmentsRecord;
};

/**
 * Julgamentos JEV reaproveitáveis (ADR 0041 §1: uma chamada JEV por jogo, não por
 * mercado). 1) A predição code_jev mais recente do jogo cujo `judgments` foi aplicado
 * com as MESMAS versões (perguntas + pesos + modelo JEV) e o MESMO `stateHash`, criada a
 * partir de `since` (preferida). 2) Sem predição, a base do modelo do jogo (#555, ADR
 * 0052) com os mesmos filtros e `checked_at` a partir de `snapshotSince` (default
 * `since`). Não filtra por usuário: as respostas são sobre o jogo, não sobre quem
 * pediu. null = nenhuma → o chamador chama o JEV.
 */
export async function findReusableJudgments(args: {
  matchId: string;
  judgmentsVersion: string;
  weightsVersion: string;
  // Modelo JEV pinado (versions.jevModel): respostas de outro modelo não servem.
  jevModel: string;
  stateHash: string;
  since: Date;
  snapshotSince?: Date;
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
        sql`${predictions.judgments}->'versions'->>'weights' = ${args.weightsVersion}`,
        sql`${predictions.judgments}->'versions'->>'jevModel' = ${args.jevModel}`
      )
    )
    .orderBy(desc(predictions.createdAt))
    .limit(1);
  const row = rows[0];
  if (row?.judgments?.answers) {
    return { predictionId: row.id, judgments: row.judgments };
  }

  const snapshot = await findReusableSnapshotJudgments({
    matchId: args.matchId,
    judgmentsVersion: args.judgmentsVersion,
    weightsVersion: args.weightsVersion,
    jevModel: args.jevModel,
    stateHash: args.stateHash,
    since: args.snapshotSince ?? args.since,
  });
  if (!snapshot?.judgments.answers) return null;
  return {
    predictionId: null,
    modelSnapshotId: snapshot.snapshotId,
    judgments: snapshot.judgments,
  };
}
