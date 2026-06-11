import { leagueToKey } from "@/lib/format";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type { LeagueFilter } from "@/lib/view/types";

/**
 * TEMPORÁRIO (Copa 2026): só a Copa está ativa enquanto Brasileirão e Champions
 * estão fora de temporada (voltam jul/ago). Reativar uma liga de clube = adicionar
 * de volta abaixo (mudança de uma linha). NÃO deletar suporte em SUPPORTED_LEAGUES /
 * providers / DB enum / canonical teams — eles devem permanecer 100% intactos.
 *
 * Esta constante é a fonte de verdade única que dirige: (a) abas renderizadas em
 * league-tabs, (b) filtro default da home, (c) o que sync-upcoming-fixtures itera.
 */
export const ACTIVE_LEAGUES: readonly SupportedLeague[] = ["world_cup"];

// Janela default de EXIBIÇÃO da home (preset `today5`). NÃO dirige mais o sync:
// o sync busca a competição+temporada inteira via getFixturesBySeason.
export const LIST_WINDOW_HOURS = 120; // 5 dias

// Keys de filtro derivadas das ligas ativas (ex.: ['wc']).
export const ACTIVE_LEAGUE_KEYS = ACTIVE_LEAGUES.map(leagueToKey);

// Filtro default da home quando não há ?league= (primeira liga ativa).
// Guard de runtime: config vazia falha alto em vez de virar undefined silencioso
// (que causaria loop de redirect a cada request).
const firstActiveKey = ACTIVE_LEAGUE_KEYS[0];
if (!firstActiveKey) {
  throw new Error("ACTIVE_LEAGUES must contain at least one league");
}
export const DEFAULT_LEAGUE_FILTER: LeagueFilter = firstActiveKey;

/**
 * "all" só é considerado filtro ativo quando há mais de uma liga ativa (aí a aba
 * "Todos" faz sentido). Caso contrário, só keys de ligas ativas passam.
 */
export function isActiveLeagueFilter(f: LeagueFilter): boolean {
  if (f === "all") return ACTIVE_LEAGUES.length > 1;
  return (ACTIVE_LEAGUE_KEYS as string[]).includes(f);
}
