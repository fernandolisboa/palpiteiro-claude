import { eq } from "drizzle-orm";

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

export type PalpiteOverrideOutcomeArgs = {
  palpiteId: string;
  // Operator-trust (#394): pode ser null (override sem fato de jogo) OU um
  // PalpiteResultData com yellowCardsTotal digitado à mão. NÃO é re-validado pela regra
  // pura contra `line` — o admin é a autoridade (espelha o override de predição).
  resultData: PalpiteResultData | null;
  // won/lost só (sem void/push: palpite não tem stake — ADR 0028 §1).
  result: "won" | "lost";
  overrideByUserId: string;
};

/**
 * Override MANUAL de liquidação de palpite (#394) — espelha upsertOutcomeOverride
 * (prediction-outcomes.ts) MENOS profitUnits. Ao contrário do cron
 * (insertPalpiteOutcomeIfAbsent / onConflictDoNothing), SOBRESCREVE intencionalmente uma
 * row existente (corrige um auto-settle errado) E carimba quem fez o override + bumpa
 * `settledAt`. É a ÚNICA saída pra rows stuck-PENDING (cap esgotado / A≠B perpétuo) e o
 * único conserto de um settle já errado.
 */
export async function upsertPalpiteOutcomeOverride(
  args: PalpiteOverrideOutcomeArgs,
): Promise<void> {
  await db
    .insert(palpiteOutcomes)
    .values({
      palpiteId: args.palpiteId,
      resultData: args.resultData,
      result: args.result,
      overrideByUserId: args.overrideByUserId,
    })
    .onConflictDoUpdate({
      target: palpiteOutcomes.palpiteId,
      set: {
        resultData: args.resultData,
        result: args.result,
        overrideByUserId: args.overrideByUserId,
        settledAt: new Date(),
      },
    });
}

export async function getPalpiteOutcomeById(
  palpiteId: string,
): Promise<DbPalpiteOutcome | null> {
  const rows = await db
    .select()
    .from(palpiteOutcomes)
    .where(eq(palpiteOutcomes.palpiteId, palpiteId))
    .limit(1);
  return rows[0] ?? null;
}

type DbPalpiteOutcome = typeof palpiteOutcomes.$inferSelect;
