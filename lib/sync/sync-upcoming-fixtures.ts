import { upsertMatchesFromProvider } from "@/lib/db/queries/matches";
import { getActiveLeagues } from "@/lib/db/queries/league-settings";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type { NormalizedFixture } from "@/lib/providers/sports-data/types";
import {
  invalidateAnalyzedKickoffs,
  refreshAnalyzedKickoffs,
} from "@/lib/sync/analyzed-kickoffs";
import { acquireSyncLock, releaseSyncLock } from "@/lib/sync/lock";
import { reconcileRescheduledFixtures } from "@/lib/sync/rescheduled-fixtures";

// TTL do lock durável. DELIBERADAMENTE > a cadência do cron (a cada 6h — ver
// vercel.json / app/api/cron/sync-fixtures). Mantendo o TTL ≥ intervalo do cron,
// o lock fica continuamente segurado ENTRE as rodadas do cron: cada rodada
// `force`-refresca o lock (e o `force` bypassa qualquer lock — então um TTL
// longo nunca causa deadlock), e o trigger `after()` da home vira um no-op
// rápido, exceto num DB/KV genuinamente fresco. 7h cobre o gap de 6h com folga.
const SYNC_LOCK_TTL_MS = 7 * 60 * 60 * 1000; // 7h

/**
 * Sync das fixtures das ligas ativas (`league_settings`, lidas no início do run —
 * ADR 0050; `opts.leagues` injeta a lista em teste). Para cada liga ativa
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
  opts: { force?: boolean; leagues?: readonly SupportedLeague[] } = {}
): Promise<void> {
  const acquired = await acquireSyncLock({
    force: opts.force,
    ttlMs: SYNC_LOCK_TTL_MS,
  });
  if (!acquired) return;

  try {
    await syncFixturesForLeagues(opts.leagues ?? (await getActiveLeagues()));
  } catch (err) {
    await releaseSyncLock();
    throw err;
  }
}

/**
 * O fetch + upsert em si, sem o lock. Exportado pro toggle do /admin/leagues: ao
 * ligar uma liga, as fixtures dela entram na hora em vez de esperar até 6h pelo cron
 * (a final da Sul-Americana estaria encerrada antes). Não mexe no lock global de
 * propósito, pra não adiar o sync das outras ligas.
 */
export async function syncFixturesForLeagues(
  leagues: readonly SupportedLeague[]
): Promise<void> {
  const provider = getSportsDataProvider();
  const settled = await Promise.allSettled(
    leagues.map((league) => provider.getFixturesBySeason(league))
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
        })
      );
    }
  }
  // Índice do portão dos crons frequentes (#680, ADR 0074): o carimbo cai ANTES de
  // qualquer kickoff mudar e volta no rebuild do fim. Sync que lança ou morre no meio
  // deixa o portão em `null` (crons no caminho antigo), nunca com kickoff velho.
  await invalidateAnalyzedKickoffs();
  // Jogo remarcado antes do upsert: a row antiga herda a chave nova em vez de nascer
  // uma segunda. Falha aqui não segura o sync (a próxima rodada replaneja).
  try {
    await reconcileRescheduledFixtures(fixtures);
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "sync-upcoming-fixtures",
        error: "reschedule_reconcile_failed",
        message: err instanceof Error ? err.message : String(err),
      })
    );
  }
  await upsertMatchesFromProvider(fixtures);
  await refreshAnalyzedKickoffs();
}
