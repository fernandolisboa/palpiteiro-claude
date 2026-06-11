import { ACTIVE_LEAGUES } from "@/lib/config/active-leagues";
import { upsertMatchesFromProvider } from "@/lib/db/queries/matches";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type { NormalizedFixture } from "@/lib/providers/sports-data/types";
import { acquireSyncLock, releaseSyncLock } from "@/lib/sync/lock";

// TTL do lock durável. DELIBERADAMENTE > a cadência do cron (a cada 6h — ver
// vercel.json / app/api/cron/sync-fixtures). Mantendo o TTL ≥ intervalo do cron,
// o lock fica continuamente segurado ENTRE as rodadas do cron: cada rodada
// `force`-refresca o lock (e o `force` bypassa qualquer lock — então um TTL
// longo nunca causa deadlock), e o trigger `after()` da home vira um no-op
// rápido, exceto num DB/KV genuinamente fresco. 7h cobre o gap de 6h com folga.
const SYNC_LOCK_TTL_MS = 7 * 60 * 60 * 1000; // 7h

/**
 * Sync das fixtures das ligas ativas (ACTIVE_LEAGUES). Para cada liga ativa
 * busca a competição+temporada INTEIRA numa única chamada de provider
 * (getFixturesBySeason) em vez de iterar dia-a-dia. Idempotente (upsert por
 * composite key). Deduplicado por um lock DURÁVEL em KV (`lib/sync/lock.ts`,
 * `SET NX EX`; fail-open pra in-memory quando o KV não está configurado):
 *
 *   - Adquire o lock ANTES de disparar o fetch externo (evita stampede com
 *     requests concorrentes — agora também entre instâncias serverless, já que
 *     o lock vive no KV e não mais por-processo).
 *   - Se o lock não é adquirido (outro já segura) retorna cedo (no-op).
 *   - `force: true` (usado pelo cron) bypassa o lock e sempre roda, refrescando
 *     o TTL.
 *   - Erro no fetch libera o lock pra retry imediato.
 *
 * NÃO toca em odds. Odds são fetchadas sob demanda em /match/[id] via
 * ensureOddsSnapshotsFresh.
 */
export async function ensureUpcomingFixturesSynced(
  opts: { force?: boolean } = {},
): Promise<void> {
  const acquired = await acquireSyncLock({
    force: opts.force,
    ttlMs: SYNC_LOCK_TTL_MS,
  });
  if (!acquired) return;

  try {
    const provider = getSportsDataProvider();
    const settled = await Promise.allSettled(
      ACTIVE_LEAGUES.map((league) => provider.getFixturesBySeason(league)),
    );
    const fixtures: NormalizedFixture[] = [];
    for (const r of settled) {
      if (r.status === "fulfilled") {
        fixtures.push(...r.value);
      } else {
        console.error(
          JSON.stringify({
            scope: "sync-upcoming-fixtures",
            error: "provider_call_failed",
            message:
              r.reason instanceof Error ? r.reason.message : String(r.reason),
          }),
        );
      }
    }
    await upsertMatchesFromProvider(fixtures);
  } catch (err) {
    await releaseSyncLock();
    throw err;
  }
}
