import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { parseLeagueFilter, type LeagueFilter } from "@/lib/view/types";

/**
 * Ligas ATIVAS: a fonte de verdade é o BANCO (tabela `league_settings`, ADR 0050),
 * ligada/desligada em /admin/leagues sem deploy. Leitura via
 * `getActiveLeagues()` (lib/db/queries/league-settings.ts), que dirige: (a) as
 * opções do seletor de liga (lib/view/league-picker.ts), (b) o filtro default da
 * home, (c) o que sync-upcoming-fixtures itera, (d) o que prewarm-odds aquece.
 *
 * Este módulo só guarda o FALLBACK e funções puras que recebem a lista ativa por
 * parâmetro. NÃO deletar suporte em SUPPORTED_LEAGUES / providers / DB enum /
 * canonical teams ao desligar uma liga — eles ficam 100% intactos (inclusive
 * `world_cup`), e o histórico de liga inativa segue renderizando.
 *
 * Ativar uma liga nova (checklist da ADR 0050): semear os times canônicos + ids
 * (scripts/generate-team-ids.ts) e fazer deploy UMA vez; depois é só o toggle no
 * admin. Orçamento da The Odds API: lib/config/odds-credits.ts.
 */

/**
 * Usado quando `league_settings` está vazia ou a leitura falha (DB fora, tabela
 * ainda não migrada): o par mais barato de manter na cota da Odds API.
 */
export const FALLBACK_ACTIVE_LEAGUES: readonly SupportedLeague[] = [
  "brasileirao_a",
  "champions_league",
];

// Janela default de EXIBIÇÃO da home (preset `today5`). NÃO dirige mais o sync:
// o sync busca a competição+temporada inteira via getFixturesBySeason.
export const LIST_WINDOW_HOURS = 120; // 5 dias

/**
 * Filtro default da home quando não há ?league=: "Todos" com >1 liga ativa (decisão
 * do dono, #491); com 1 liga só, a própria liga (aí "Todos" nem existe como aba).
 * Guard de runtime: lista vazia falha alto em vez de virar undefined silencioso
 * (que causaria loop de redirect a cada request). `getActiveLeagues()` nunca
 * devolve vazio (cai no fallback).
 */
export function defaultLeagueFilter(
  activeKeys: readonly LeagueFilter[]
): LeagueFilter {
  const first = activeKeys[0];
  if (!first) {
    throw new Error("active leagues must contain at least one league");
  }
  return activeKeys.length > 1 ? "all" : first;
}

/**
 * "all" só é considerado filtro ativo quando há mais de uma liga ativa (aí a aba
 * "Todos" faz sentido — ela lista só as ligas ATIVAS, nunca uma inativa como a
 * Copa). Caso contrário, só keys de ligas ativas passam.
 */
export function isActiveLeagueFilter(
  f: LeagueFilter,
  activeKeys: readonly LeagueFilter[]
): boolean {
  if (f === "all") return activeKeys.length > 1;
  return activeKeys.includes(f);
}

/**
 * Resolve o `?league=` da home (/jogos) pro filtro efetivo, ou `null` quando a
 * página deve redirecionar pra /jogos limpa. Sem param / param inválido → default
 * (`defaultLeagueFilter`, sempre ativo → nunca loop de redirect). `?league=all`
 * EXPLÍCITO = aba "Todos" (só vale com >1 liga ativa). Key válida-mas-inativa (ex.:
 * `?league=wc` bookmarkado da Copa) → `null` → redirect pro default.
 */
export function resolveHomeLeagueFilter(
  param: string | undefined,
  activeKeys: readonly LeagueFilter[]
): LeagueFilter | null {
  const parsed = parseLeagueFilter(param);
  const league: LeagueFilter =
    param === "all"
      ? "all"
      : parsed === "all"
        ? defaultLeagueFilter(activeKeys)
        : parsed;
  return isActiveLeagueFilter(league, activeKeys) ? league : null;
}
