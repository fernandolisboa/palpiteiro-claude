import { eq, sql } from "drizzle-orm";

import { providerQuota } from "@/db/schema";
import { db } from "@/lib/db";

// Boundary única de `provider_quota` (#509): último saldo mensal visto por provider.

export type ProviderQuotaReading = {
  monthlyUsed: number | null;
  monthlyRemaining: number | null;
};

export type ProviderQuotaRow = ProviderQuotaReading & {
  provider: string;
  observedAt: Date;
};

/**
 * Upsert da leitura de quota. Só sobrescreve quando `observedAt` é MAIS NOVO que o
 * gravado: dois crons concorrentes (prewarm e closing line) ou uma quota antiga de
 * lambda quente nunca regridem o saldo mostrado no admin.
 */
export async function recordProviderQuota(
  provider: string,
  reading: ProviderQuotaReading,
  observedAt: Date
): Promise<void> {
  await db
    .insert(providerQuota)
    .values({
      provider,
      monthlyUsed: reading.monthlyUsed,
      monthlyRemaining: reading.monthlyRemaining,
      observedAt,
    })
    .onConflictDoUpdate({
      target: providerQuota.provider,
      set: {
        monthlyUsed: sql`excluded.monthly_used`,
        monthlyRemaining: sql`excluded.monthly_remaining`,
        observedAt: sql`excluded.observed_at`,
      },
      setWhere: sql`${providerQuota.observedAt} < excluded.observed_at`,
    });
}

/** Última leitura persistida do provider, ou null se nunca houve fetch real gravado. */
export async function getProviderQuota(
  provider: string
): Promise<ProviderQuotaRow | null> {
  const [row] = await db
    .select()
    .from(providerQuota)
    .where(eq(providerQuota.provider, provider))
    .limit(1);
  return row ?? null;
}
