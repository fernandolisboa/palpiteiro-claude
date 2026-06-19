import { palpiteOutcomes } from "@/db/schema";
import type { PalpiteResultData } from "@/db/schema";
import { db } from "@/lib/db";

export type InsertPalpiteOutcomeArgs = {
  palpiteId: string;
  // Forma estreita do resultData de palpite (PLAN §1.3) — {homeScore, awayScore,
  // totalGoals}, SEM scorers/assisters. Sem profitUnits: palpite não tem stake (ADR 0028 §1).
  resultData: PalpiteResultData;
  // Literal estreito, NUNCA DbOutcomeResult/outcomeResultEnum (PLAN §1.4): void/push
  // não se aplicam a placar exato; um deles perdido vira erro de tipo no boundary.
  result: "won" | "lost";
};

/**
 * Write idempotente de liquidação de palpite. `palpiteId` é UNIQUE, então um
 * re-run bate no conflito e não faz nada — o cron pode liquidar o mesmo palpite
 * 2x com segurança (mesmo contrato de insertOutcomeIfAbsent em
 * prediction-outcomes.ts). Retorna true sse uma row foi de fato inserida.
 */
export async function insertPalpiteOutcomeIfAbsent(
  args: InsertPalpiteOutcomeArgs
): Promise<boolean> {
  const inserted = await db
    .insert(palpiteOutcomes)
    .values({
      palpiteId: args.palpiteId,
      resultData: args.resultData,
      result: args.result,
    })
    .onConflictDoNothing({ target: palpiteOutcomes.palpiteId })
    .returning({ id: palpiteOutcomes.id });
  return inserted.length > 0;
}
