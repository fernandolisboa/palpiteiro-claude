import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

/** Plano grátis da The Odds API: créditos por mês (ADR 0044/0049). */
export const ODDS_API_MONTHLY_CREDITS = 500;

/**
 * Estimativa de créditos/mês da The Odds API que cada liga ATIVA custa só de
 * prewarm (cron 4×/dia, 2 créditos por liga por run com jogo nas próximas 24h),
 * num mês típico da temporada. Uso de página (~30–80/mês) e closing line ficam
 * fora. Números (pontos médios das faixas):
 * - Brasileirão ~190–220, Champions ~35–45, Premier League ~90–130,
 *   La Liga ~110–140: tabela do §5 da ADR 0049 (janela de 24h).
 * - Serie A / Bundesliga / Ligue 1: "liga de fim de semana ~120–160" (ADR 0044).
 * - Libertadores / Sul-Americana: ~40 cada em mata-mata (ADR 0045).
 * - Copa do Mundo: 0 — fora de temporada até 2030.
 * É referência pra decidir no /admin/leagues; a medição real é o
 * `quotaMonthlyUsed` do log `prewarm_odds.run_complete`.
 */
export const ODDS_CREDITS_PER_MONTH_ESTIMATE: Record<SupportedLeague, number> =
  {
    brasileirao_a: 200,
    champions_league: 40,
    world_cup: 0,
    serie_a: 140,
    bundesliga: 140,
    ligue_1: 140,
    copa_libertadores: 40,
    copa_sudamericana: 40,
    premier_league: 110,
    la_liga: 125,
  };

/** Soma da estimativa mensal sobre as ligas ativas. */
export function estimateMonthlyOddsCredits(
  activeLeagues: readonly SupportedLeague[]
): number {
  return activeLeagues.reduce(
    (sum, league) => sum + ODDS_CREDITS_PER_MONTH_ESTIMATE[league],
    0
  );
}
