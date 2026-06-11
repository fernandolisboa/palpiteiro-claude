import { inMemoryCache } from "@/lib/cache/in-memory";
import { ACTIVE_LEAGUES } from "@/lib/config/active-leagues";
import { upsertMatchesFromProvider } from "@/lib/db/queries/matches";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type { NormalizedFixture } from "@/lib/providers/sports-data/types";

const SYNC_LOCK_TTL_MS = 60 * 60 * 1000; // 1h
const SYNC_LOCK_KEY = "sync:upcoming-fixtures:lock";

/**
 * Sync sob demanda das fixtures das ligas ativas (ACTIVE_LEAGUES). Para cada
 * liga ativa busca a competição+temporada INTEIRA numa única chamada de provider
 * (getFixturesBySeason) em vez de iterar dia-a-dia. Idempotente (upsert por
 * composite key). Lock processo-local de 1h em inMemoryCache:
 *
 *   - Primeiro request escreve o lock ANTES de disparar fetch externo (evita
 *     stampede com requests concorrentes).
 *   - Segundo request concorrente durante sync em andamento retorna cedo e pode
 *     ver empty state se o DB ainda não foi populado — aceitável MVP
 *     single-instance.
 *   - Erro no fetch libera o lock pra retry imediato no próximo request.
 *
 * NÃO toca em odds. Odds são fetchadas sob demanda em /match/[id] via
 * ensureOddsSnapshotsFresh.
 */
export async function ensureUpcomingFixturesSynced(
  now: Date = new Date(),
): Promise<void> {
  const last = await inMemoryCache.get<number>(SYNC_LOCK_KEY);
  if (last !== undefined) return;
  await inMemoryCache.set(SYNC_LOCK_KEY, now.getTime(), SYNC_LOCK_TTL_MS);

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
              r.reason instanceof Error
                ? r.reason.message
                : String(r.reason),
          }),
        );
      }
    }
    await upsertMatchesFromProvider(fixtures);
  } catch (err) {
    await inMemoryCache.delete(SYNC_LOCK_KEY);
    throw err;
  }
}
