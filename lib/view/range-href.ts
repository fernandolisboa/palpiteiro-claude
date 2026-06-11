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
 * Href puro pra home preservando a liga atual e aplicando a próxima escolha de
 * range. Espelha `buildHref`/`buildDashboardHref`: omite params no default
 * (`league=all` e `preset=today5` não aparecem na URL → home limpa).
 *
 * Função pura (seam de teste sem @testing-library).
 */
export function buildRangeHref(
  current: Pick<RangeNavState, "league">,
  next: RangeChoice,
): string {
  const params = new URLSearchParams();

  if (current.league !== "all") params.set("league", current.league);

  // `today5` é o default — não polui a URL (mesma convenção de league=all).
  if (next.preset !== "today5") {
    params.set("preset", next.preset);
    if (next.preset === "custom") {
      params.set("from", next.from);
      params.set("to", next.to);
    }
  }

  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
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
      "Copa do Mundo sem partidas agendadas nessa janela. Volte mais perto do próximo jogo.",
  };
}
