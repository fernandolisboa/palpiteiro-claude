import { eq, sql } from "drizzle-orm";

import { palpiteSettlementAttempts } from "@/db/schema";
import { db } from "@/lib/db";

// Limite de tentativas cross-tick da extração web-grounded de cartões (#394, ADR 0033).
// CAP=3: uma row que repete A≠B (ou contagem nula) é re-extraída no MÁXIMO 3 ticks (≤ 2
// web-searches por tick = ≤ 6 buscas por row stuck) e depois fica PENDENTE até override.
export const CARDS_SETTLEMENT_ATTEMPT_CAP = 3;

/**
 * Incrementa (ou cria) o contador de tentativas de UM palpite. Upsert idempotente por
 * PK — `attempts = attempts + 1`. Dispara ANTES da chamada paga, INCONDICIONALMENTE
 * (mesmo em A≠B/null): o cron é all-or-nothing + re-tentado SEM transação, então um
 * incremento-após-sucesso seria leaky/dead (não limitaria uma row perpetuamente flaky).
 */
export async function incrementAttempt(
  palpiteId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .insert(palpiteSettlementAttempts)
    .values({ palpiteId, attempts: 1, lastAttemptAt: now })
    .onConflictDoUpdate({
      target: palpiteSettlementAttempts.palpiteId,
      set: {
        attempts: sql`${palpiteSettlementAttempts.attempts} + 1`,
        lastAttemptAt: now,
      },
    });
}

/**
 * true sse o palpite já atingiu o cap (não deve mais ser extraído). Row ausente = 0
 * tentativas = não excedeu. Gateia o fan-out: `attempts < CAP` é a condição de fetch.
 */
export async function attemptsExceedCap(
  palpiteId: string,
  cap: number = CARDS_SETTLEMENT_ATTEMPT_CAP,
): Promise<boolean> {
  const [row] = await db
    .select({ attempts: palpiteSettlementAttempts.attempts })
    .from(palpiteSettlementAttempts)
    .where(eq(palpiteSettlementAttempts.palpiteId, palpiteId))
    .limit(1);
  return (row?.attempts ?? 0) >= cap;
}
