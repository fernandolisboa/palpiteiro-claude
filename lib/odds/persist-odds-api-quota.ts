import { recordProviderQuota } from "@/lib/db/queries/provider-quota";
import type { ObservedQuota } from "@/lib/providers/http/quota-logger";

/** Chave da The Odds API em `provider_quota` (mesmo nome do provider no quota-logger). */
export const ODDS_API_PROVIDER = "odds-api";

/**
 * Persiste a última quota da The Odds API vista neste processo (#509), pro
 * /admin/leagues mostrar o saldo real. Best-effort: falha de escrita só gera warn —
 * NUNCA derruba o cron que a chamou. Sem quota (nenhum fetch real) → no-op. Zero call
 * extra à API: reusa o header já lido pelo quota-logger.
 */
export async function persistOddsApiQuota(
  quota: ObservedQuota | null,
  scope: string
): Promise<void> {
  if (!quota) return;
  try {
    await recordProviderQuota(
      ODDS_API_PROVIDER,
      {
        monthlyUsed: quota.monthlyUsed,
        monthlyRemaining: quota.monthlyRemaining,
      },
      quota.observedAt
    );
  } catch (err) {
    console.warn(
      JSON.stringify({
        scope,
        event: "quota_persist_failed",
        message: err instanceof Error ? err.message : String(err),
      })
    );
  }
}
