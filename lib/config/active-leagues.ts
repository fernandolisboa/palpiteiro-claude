import { leagueToKey } from "@/lib/format";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { parseLeagueFilter, type LeagueFilter } from "@/lib/view/types";

/**
 * Ligas ATIVAS (temporada 2026/27, pós-Copa — #491): Brasileirão Série A,
 * Champions League, Premier League e La Liga (ADR 0049 — as duas europeias juntas
 * ficam no limite dos 500 créditos/mês da The Odds API; ver §5). A Copa do Mundo 2026 acabou e saiu daqui; o histórico dos
 * jogos da Copa segue renderizando normalmente (páginas de jogo, dashboard,
 * predições liquidadas) porque nada disso lê esta constante.
 *
 * Ativar/desativar uma liga = adicionar/remover abaixo (mudança de uma linha). NÃO
 * deletar suporte em SUPPORTED_LEAGUES / providers / DB enum / canonical teams —
 * eles devem permanecer 100% intactos (inclusive `world_cup`).
 *
 * Esta constante é a fonte de verdade única que dirige: (a) as opções ativas do
 * seletor de liga (lib/view/league-picker.ts), (b) filtro default da home, (c) o
 * que sync-upcoming-fixtures itera, (d) o que prewarm-odds aquece.
 */
export const ACTIVE_LEAGUES: readonly SupportedLeague[] = [
  "brasileirao_a",
  "champions_league",
  "premier_league",
  "la_liga",
];

// Janela default de EXIBIÇÃO da home (preset `today5`). NÃO dirige mais o sync:
// o sync busca a competição+temporada inteira via getFixturesBySeason.
export const LIST_WINDOW_HOURS = 120; // 5 dias

// Keys de filtro derivadas das ligas ativas (ex.: ['bsa', 'ucl']).
export const ACTIVE_LEAGUE_KEYS = ACTIVE_LEAGUES.map(leagueToKey);

/**
 * Filtro default da home quando não há ?league=: "Todos" com >1 liga ativa (decisão
 * do dono, #491); com 1 liga só, a própria liga (aí "Todos" nem existe como aba).
 * Guard de runtime: config vazia falha alto em vez de virar undefined silencioso
 * (que causaria loop de redirect a cada request).
 */
export function defaultLeagueFilter(
  activeKeys: readonly LeagueFilter[],
): LeagueFilter {
  const first = activeKeys[0];
  if (!first) {
    throw new Error("ACTIVE_LEAGUES must contain at least one league");
  }
  return activeKeys.length > 1 ? "all" : first;
}

export const DEFAULT_LEAGUE_FILTER: LeagueFilter =
  defaultLeagueFilter(ACTIVE_LEAGUE_KEYS);

/**
 * "all" só é considerado filtro ativo quando há mais de uma liga ativa (aí a aba
 * "Todos" faz sentido — ela lista só as ligas ATIVAS, nunca uma inativa como a
 * Copa). Caso contrário, só keys de ligas ativas passam.
 */
export function isActiveLeagueFilter(f: LeagueFilter): boolean {
  if (f === "all") return ACTIVE_LEAGUES.length > 1;
  return (ACTIVE_LEAGUE_KEYS as string[]).includes(f);
}

/**
 * Resolve o `?league=` da home (/jogos) pro filtro efetivo, ou `null` quando a
 * página deve redirecionar pra /jogos limpa. Sem param / param inválido → default
 * (DEFAULT_LEAGUE_FILTER, sempre ativo → nunca loop de redirect). `?league=all`
 * EXPLÍCITO = aba "Todos" (só vale com >1 liga ativa). Key válida-mas-inativa (ex.:
 * `?league=wc` bookmarkado da Copa) → `null` → redirect pro default.
 */
export function resolveHomeLeagueFilter(
  param: string | undefined,
): LeagueFilter | null {
  const parsed = parseLeagueFilter(param);
  const league: LeagueFilter =
    param === "all" ? "all" : parsed === "all" ? DEFAULT_LEAGUE_FILTER : parsed;
  return isActiveLeagueFilter(league) ? league : null;
}
