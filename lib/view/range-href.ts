import type { RangePreset, ResolvedRange } from "@/lib/view/date-range";
import type { LeagueFilter } from "@/lib/view/types";

/**
 * Estado de filtro que vive na query string da home: liga + range. Os dois
 * filtros compõem (trocar um preserva o outro). `from`/`to` só fazem sentido
 * com `preset === "custom"`.
 */
export type RangeNavState = {
  league: LeagueFilter;
  preset: RangePreset;
  from?: string;
  to?: string;
};

/**
 * Próxima escolha do usuário — a lista padrão (upcoming) ou um range custom com
 * `from`/`to` em `YYYY-MM-DD`.
 */
export type RangeChoice =
  | { preset: "upcoming" }
  | { preset: "custom"; from: string; to: string };

/**
 * Href puro pra home autenticada (`/jogos`) preservando a liga atual e aplicando
 * a próxima escolha de range. `upcoming` (default) não aparece na URL. A liga
 * vai SEMPRE explícita, inclusive `league=all`: o default de /jogos sem param
 * (`defaultLeagueFilter`) depende de quantas ligas estão ativas no banco, então o href não
 * pode assumir que omitir o param dá "Todos" (#491).
 * Aponta SEMPRE pra `/jogos`, nunca pra `/` — a raiz virou landing pública
 * estática (#373); apontar pra `/` joga o filtro na landing.
 *
 * Função pura (seam de teste sem @testing-library).
 */
export function buildRangeHref(
  current: Pick<RangeNavState, "league">,
  next: RangeChoice,
): string {
  const params = new URLSearchParams();

  params.set("league", current.league);

  // `upcoming` é o default — não polui a URL.
  if (next.preset === "custom") {
    params.set("preset", next.preset);
    params.set("from", next.from);
    params.set("to", next.to);
  }

  return `/jogos?${params.toString()}`;
}

/**
 * Href puro pra home preservando o range atual e trocando só a liga. Espelho
 * de `buildRangeHref` pro outro eixo (seletor de liga); garante que os dois filtros
 * não se clobberem.
 */
export function buildLeagueHref(
  current: Pick<RangeNavState, "preset" | "from" | "to">,
  league: LeagueFilter,
): string {
  // custom sem from/to válidos cai pro default (upcoming).
  const choice: RangeChoice =
    current.preset === "custom" && current.from && current.to
      ? { preset: "custom", from: current.from, to: current.to }
      : { preset: "upcoming" };
  return buildRangeHref({ league }, choice);
}

// "2026-10-18" → "18/10": o dia civil escolhido, sem passar por Date (sem fuso).
function formatDayLabel(day: string): string {
  const [, month, date] = day.split("-");
  return `${date}/${month}`;
}

/**
 * Rótulo derivado do range resolvido (não de literais espalhados pela page):
 * "Próximos jogos" ou, no custom, "DD/MM – DD/MM".
 */
export function rangeLabel(range: ResolvedRange): string {
  if (range.preset === "custom" && range.days) {
    return `${formatDayLabel(range.days.from)} – ${formatDayLabel(range.days.to)}`;
  }
  return "Próximos jogos";
}

/**
 * Mensagem de empty-state sensível ao range: a lista padrão diz que não há jogo
 * marcado e aponta pro Escolher datas; custom indica ausência no período escolhido.
 */
export function rangeEmptyMessage(range: ResolvedRange): {
  title: string;
  detail: string;
} {
  if (range.preset === "custom") {
    return {
      title: "Nenhum jogo nesse período",
      detail: "Tente um intervalo diferente ou limpe as datas pra voltar aos próximos jogos.",
    };
  }
  return {
    title: "Nenhum jogo marcado",
    detail:
      "Sem partidas agendadas daqui pra frente. Pra ver jogos que já passaram, use Escolher datas.",
  };
}
