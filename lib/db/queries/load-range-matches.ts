import { after } from "next/server";

import { getMatchesInRange, type DbMatch } from "@/lib/db/queries/matches";
import { ensureUpcomingFixturesSynced } from "@/lib/sync/sync-upcoming-fixtures";

type RangeQuery = Parameters<typeof getMatchesInRange>[0];

/**
 * Carrega os jogos de um range. NÃO bloqueia o request no sync: a query do DB
 * roda e retorna imediatamente, enquanto o sync da competição+temporada inteira
 * é agendado via Next `after()` pra rodar PÓS-resposta.
 *
 * O DB é populado pelo cron (`/api/cron/sync-fixtures`, a cada 6h, `force`) +
 * pelo lock DURÁVEL em KV (`lib/sync/lock.ts`). Sem `force` aqui, o `after()`
 * é um no-op rápido enquanto o lock está segurado (TTL ≥ cadência do cron),
 * então o gatilho da home só faz trabalho real num DB/KV genuinamente fresco —
 * nunca na latência do usuário.
 *
 * (#124: o guard antigo `dbMatches.length === 0` refletia a fatia *filtrada* do
 * range, não "DB vazio", então o sync nunca rodava e o schedule completo nunca
 * carregava. #126: o sync saiu do caminho do request — cron + lock durável
 * populam o DB; este helper só garante um gatilho best-effort pós-resposta.)
 *
 * Best-effort: uma falha no sync agendado é engolida (log) e nunca rejeita
 * `loadRangeMatches` nem derruba a página.
 */
export async function loadRangeMatches(query: RangeQuery): Promise<DbMatch[]> {
  after(async () => {
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
  });
  return getMatchesInRange(query);
}
