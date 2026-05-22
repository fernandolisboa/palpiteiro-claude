import { inMemoryCache } from "@/lib/cache/in-memory";
import { upsertMatchesFromProvider } from "@/lib/db/queries/matches";
import { SUPPORTED_LEAGUES } from "@/lib/providers/sports-data/leagues";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type { NormalizedFixture } from "@/lib/providers/sports-data/types";

const SYNC_LOCK_TTL_MS = 60 * 60 * 1000; // 1h
const SYNC_LOCK_KEY = "sync:upcoming-fixtures:lock";
const SYNC_HORIZON_DAYS = 3;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function isoDateForDay(now: Date, dayOffset: number): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + dayOffset);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Sync sob demanda das fixtures das próximas 72h × ligas suportadas. Idempotente
 * (upsert por composite key). Lock processo-local de 1h em inMemoryCache:
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
    const days = Array.from({ length: SYNC_HORIZON_DAYS }, (_, i) =>
      isoDateForDay(now, i),
    );
    const calls: Promise<NormalizedFixture[]>[] = [];
    for (const date of days) {
      for (const league of SUPPORTED_LEAGUES) {
        calls.push(provider.getFixturesByDate(date, league));
      }
    }
    const settled = await Promise.allSettled(calls);
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
