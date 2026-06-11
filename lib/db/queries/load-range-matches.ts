import {
  getMatchesInRange,
  type DbMatch,
} from "@/lib/db/queries/matches";
import { ensureUpcomingFixturesSynced } from "@/lib/sync/sync-upcoming-fixtures";

type RangeQuery = Parameters<typeof getMatchesInRange>[0];

/**
 * Carrega os jogos de um range disparando o sync da competição+temporada inteira
 * ANTES da query. `ensureUpcomingFixturesSynced` é idempotente (upsert por
 * composite key) e self-throttled (lock processo-local de 1h + cache ONE_HOUR no
 * provider), então isto é no máximo uma chamada getFixturesBySeason por liga por
 * hora por instância — barato o suficiente pra rodar em todo request.
 *
 * (#124: o guard antigo `dbMatches.length === 0` refletia a fatia *filtrada* do
 * range, não "DB vazio". Como o DB já tinha ~3 jogos da Copa, o length nunca era
 * 0 e o sync da competição inteira nunca rodava — o schedule completo nunca
 * carregava. Agora o sync roda sempre, deduplicado pelo lock.)
 *
 * Best-effort: uma falha no provider degrada pra renderizar o que já está no DB
 * em vez de derrubar a página (500).
 */
export async function loadRangeMatches(
  query: RangeQuery,
): Promise<DbMatch[]> {
  try {
    await ensureUpcomingFixturesSynced();
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "home-page",
        error: "sync_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
  return getMatchesInRange(query);
}
