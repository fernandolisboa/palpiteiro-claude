import { eq } from "drizzle-orm";

import { predictionOutcomes } from "@/db/schema";
import { db } from "@/lib/db";
import type { OutcomeResult } from "@/lib/settlement/compute";

export type DbPredictionOutcome = typeof predictionOutcomes.$inferSelect;

export type InsertOutcomeArgs = {
  predictionId: string;
  totalGoals: number;
  result: OutcomeResult;
  profitUnits: number;
};

/**
 * Idempotent settlement write. `predictionId` is UNIQUE, so a re-run hits the
 * conflict and does nothing — the cron can safely settle the same prediction
 * twice. Returns true iff a row was actually inserted.
 */
export async function insertOutcomeIfAbsent(
  args: InsertOutcomeArgs,
): Promise<boolean> {
  const inserted = await db
    .insert(predictionOutcomes)
    .values({
      predictionId: args.predictionId,
      totalGoals: args.totalGoals,
      result: args.result,
      profitUnits: args.profitUnits.toFixed(2),
    })
    .onConflictDoNothing({ target: predictionOutcomes.predictionId })
    .returning({ id: predictionOutcomes.id });
  return inserted.length > 0;
}

export type OverrideOutcomeArgs = InsertOutcomeArgs & {
  overrideByUserId: string;
};

/**
 * Manual override: upsert the outcome and stamp who overrode it. Unlike the
 * cron path this intentionally overwrites an existing auto-settled row (e.g. a
 * corrected scoreline), bumping settledAt.
 */
export async function upsertOutcomeOverride(
  args: OverrideOutcomeArgs,
): Promise<void> {
  await db
    .insert(predictionOutcomes)
    .values({
      predictionId: args.predictionId,
      totalGoals: args.totalGoals,
      result: args.result,
      profitUnits: args.profitUnits.toFixed(2),
      overrideByUserId: args.overrideByUserId,
    })
    .onConflictDoUpdate({
      target: predictionOutcomes.predictionId,
      set: {
        totalGoals: args.totalGoals,
        result: args.result,
        profitUnits: args.profitUnits.toFixed(2),
        overrideByUserId: args.overrideByUserId,
        settledAt: new Date(),
      },
    });
}

export async function getOutcomeByPredictionId(
  predictionId: string,
): Promise<DbPredictionOutcome | null> {
  const rows = await db
    .select()
    .from(predictionOutcomes)
    .where(eq(predictionOutcomes.predictionId, predictionId))
    .limit(1);
  return rows[0] ?? null;
}
