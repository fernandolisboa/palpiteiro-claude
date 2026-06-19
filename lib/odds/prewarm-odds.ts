import { ACTIVE_LEAGUES } from "@/lib/config/active-leagues";
import { getMatchesInLeagueWindow } from "@/lib/db/queries/matches";
import { ensureOddsSnapshotsFresh } from "@/lib/odds/fetch-and-snapshot";
import { PAGE_LIVE_MARKETS } from "@/lib/odds/live-card-markets";
import { getLastOddsApiQuota } from "@/lib/providers/odds-api";

// Pré-aquecimento de odds (#371). Um cron (a cada 6h) chama isto pra manter snapshots
// frescas dos mercados que a match page lê AO VIVO no load (PAGE_LIVE_MARKETS =
// over/under 2.5 + 1X2, ambos featured). Com snapshot fresca (< 30min) o load da
// página acha cache no DB e NÃO dispara fetch ao vivo da The Odds API — o cron eleva a
// taxa de acerto-fresco, não garante zero fetch (um load no gap stale entre runs ainda
// cai no fetch da request-path; #372 endurece esse caminho). ADR 0012 intacto: isto só
// captura snapshots no schedule; o congelamento de odd na recomendação não muda.

// Janela (horas) que limita SÓ a iteração — quais ligas têm jogo próximo (= trabalho).
// NÃO é a cobertura do snapshot nem o gasto de quota: a escrita interna cobre a janela
// HARDCODED de 7d dentro de `ensureOddsSnapshotsFresh` (fetch-and-snapshot.ts), que
// esta fase não edita. Não "consertar" este arg esperando mudar cobertura.
export const ODDS_PREWARM_WINDOW_HOURS = 48;

export type PrewarmOddsSummary = {
  consideredLeagues: number;
  consideredMatches: number;
  warmedLeagues: number;
  errors: number;
  // Crédito mensal da The Odds API após o run (medição de quota — AC do #371). Os logs
  // por-call do quota-logger já trazem a telemetria exata; isto é a linha de summary.
  // `null` = nenhum fetch real neste run (zero liga com jogo próximo, ou TUDO cache-hit
  // pelo gate de frescor — quota só é registrada em call não-cache-hit).
  quotaMonthlyRemaining: number | null;
  quotaMonthlyUsed: number | null;
};

/**
 * Pré-aquece as odds dos mercados AO VIVO (PAGE_LIVE_MARKETS) das ligas ativas com
 * jogo próximo, pra que o load da match page ache snapshot fresca e pule o fetch.
 *
 * SEQUENCIAL e UMA chamada por liga de propósito: `ensureOddsSnapshotsFresh` já faz
 * batch da liga INTEIRA (janela de 7d) numa única call featured, gravando snapshots
 * pra TODOS os jogos conhecidos da liga. Logo, basta aquecer UM jogo representativo
 * pra cobrir todos os próximos da mesma liga — iterar jogo a jogo só adiciona reads
 * redundantes do gate de frescor (os demais jogos já estariam frescos). Paralelo
 * entre ligas arriscaria bursts; sequencial mantém o gasto previsível.
 */
export async function prewarmOdds(
  opts: { now?: Date } = {},
): Promise<PrewarmOddsSummary> {
  const now = opts.now ?? new Date();

  let consideredMatches = 0;
  let warmedLeagues = 0;
  let errors = 0;

  for (const league of ACTIVE_LEAGUES) {
    const upcoming = await getMatchesInLeagueWindow({
      league,
      fromMs: now.getTime(),
      windowHours: ODDS_PREWARM_WINDOW_HOURS,
    });
    consideredMatches += upcoming.length;

    const firstUpcoming = upcoming[0];
    if (!firstUpcoming) continue; // sem jogo próximo nesta liga → nada a aquecer.

    try {
      // UMA call por liga: a escrita interna batcheia a liga inteira (7d), então um
      // jogo representativo aquece todos os próximos. Ignoramos o retorno (snapshot
      // over/under binário) — aquecemos por efeito colateral, não dependemos dele.
      await ensureOddsSnapshotsFresh(firstUpcoming, {
        markets: PAGE_LIVE_MARKETS,
        now,
      });
      warmedLeagues++;
    } catch (err) {
      errors++;
      console.error(
        JSON.stringify({
          scope: "prewarm_odds",
          event: "league_failed",
          league,
          matchId: firstUpcoming.id,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  const quota = getLastOddsApiQuota();
  const summary: PrewarmOddsSummary = {
    consideredLeagues: ACTIVE_LEAGUES.length,
    consideredMatches,
    warmedLeagues,
    errors,
    quotaMonthlyRemaining: quota?.monthlyRemaining ?? null,
    quotaMonthlyUsed: quota?.monthlyUsed ?? null,
  };
  console.log(
    JSON.stringify({
      scope: "prewarm_odds",
      event: "run_complete",
      ...summary,
    }),
  );
  return summary;
}
