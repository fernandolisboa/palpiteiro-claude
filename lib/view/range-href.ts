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
 * Próxima escolha do usuário — ou um preset (today5/today14/season) ou um
 * range custom com `from`/`to` em `YYYY-MM-DD`.
 */
export type RangeChoice =
  | { preset: "today5" | "today14" | "season" }
  | { preset: "custom"; from: string; to: string };

/**
 * Href puro pra home autenticada (`/jogos`) preservando a liga atual e aplicando
 * a próxima escolha de range. `preset=today5` (default) não aparece na URL. A liga
 * vai SEMPRE explícita, inclusive `league=all`: o default de /jogos sem param
 * (DEFAULT_LEAGUE_FILTER) depende de quantas ligas estão ativas, então o href não
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

  // `today5` é o default — não polui a URL.
  if (next.preset !== "today5") {
    params.set("preset", next.preset);
    if (next.preset === "custom") {
      params.set("from", next.from);
      params.set("to", next.to);
    }
  }

  return `/jogos?${params.toString()}`;
}

/**
 * Href puro pra home preservando o range atual e trocando só a liga. Espelho
 * de `buildRangeHref` pro outro eixo (league-tabs); garante que os dois filtros
 * não se clobberem.
 */
export function buildLeagueHref(
  current: Pick<RangeNavState, "preset" | "from" | "to">,
  league: LeagueFilter,
): string {
  const choice: RangeChoice =
    current.preset === "custom" && current.from && current.to
      ? { preset: "custom", from: current.from, to: current.to }
      : current.preset === "custom"
        ? // custom sem from/to válidos cai pro default (today5)
          { preset: "today5" }
        : { preset: current.preset };
  return buildRangeHref({ league }, choice);
}

const DAY_LABEL: Record<"today5" | "today14", string> = {
  today5: "Próximos 5 dias",
  today14: "Próximos 14 dias",
};

function formatDayLabel(date: Date): string {
  const day = date.getUTCDate().toString().padStart(2, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${day}/${month}`;
}

/**
 * Rótulo derivado do range resolvido (não de literais espalhados pela page).
 * "Próximos 5 dias" / "Próximos 14 dias" / "Competição" / "DD/MM – DD/MM".
 */
export function rangeLabel(range: ResolvedRange): string {
  if (range.preset === "season") return "Competição";
  if (range.preset === "custom") {
    if (range.from && range.to) {
      return `${formatDayLabel(range.from)} – ${formatDayLabel(range.to)}`;
    }
    // custom que caiu no fallback today5 (datas inválidas) — usa rótulo de 5 dias.
    return DAY_LABEL.today5;
  }
  return DAY_LABEL[range.preset];
}

/**
 * Mensagem de empty-state sensível ao range: presets "próximos N dias" sugerem
 * voltar perto do jogo; season/custom indicam ausência no período escolhido.
 */
export function rangeEmptyMessage(range: ResolvedRange): {
  title: string;
  detail: string;
} {
  if (range.preset === "season") {
    return {
      title: "Nenhum jogo na competição",
      detail: "Sem partidas registradas para esta competição ainda.",
    };
  }
  if (range.preset === "custom") {
    return {
      title: "Nenhum jogo nesse período",
      detail: "Tente um intervalo diferente ou um dos períodos pré-definidos.",
    };
  }
  return {
    title: `Sem jogos — ${rangeLabel(range).toLowerCase()}`,
    detail:
      "Sem partidas agendadas nessa janela. Volte mais perto do próximo jogo.",
  };
}
