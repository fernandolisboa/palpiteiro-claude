import Link from "next/link";

import { ACTIVE_LEAGUE_KEYS } from "@/lib/config/active-leagues";
import { cn } from "@/lib/utils";
import { buildLeagueHref } from "@/lib/view/range-href";
import type { RangePreset } from "@/lib/view/date-range";
import type { LeagueFilter } from "@/lib/view/types";

type Item = {
  value: LeagueFilter;
  label: string;
  // Liga de CLUBE (temporada anual): fora de temporada vira aba desabilitada
  // ("volta em agosto"). Torneio (Copa, a cada 4 anos) inativo é ESCONDIDO — uma
  // aba "volta em agosto" pra Copa seria mentira (#491).
  hideWhenInactive?: boolean;
};
export type LeagueTabItem = { value: LeagueFilter; label: string; active: boolean };

const ITEMS: Item[] = [
  { value: "all", label: "Todos" },
  { value: "bsa", label: "Brasileirão" },
  { value: "ucl", label: "Champions" },
  { value: "wc", label: "Copa do Mundo", hideWhenInactive: true },
];

/**
 * Ligas suportadas, anotadas com `active` derivado das ligas ativas. Ligas de
 * clube (bsa/ucl) sempre aparecem; inativas são renderizadas desabilitadas. A Copa
 * só aparece quando ativa. A aba "Todos" só aparece quando há mais de uma liga
 * ativa. Função pura (seam de teste sem precisar de @testing-library).
 */
export function visibleLeagueTabs(
  activeKeys: readonly LeagueFilter[] = ACTIVE_LEAGUE_KEYS,
): LeagueTabItem[] {
  return ITEMS.flatMap(({ value, label, hideWhenInactive }): LeagueTabItem[] => {
    if (value === "all") {
      return activeKeys.length > 1 ? [{ value, label, active: true }] : [];
    }
    const active = activeKeys.includes(value);
    if (!active && hideWhenInactive) return [];
    return [{ value, label, active }];
  });
}

type RangeState = {
  preset: RangePreset;
  from?: string;
  to?: string;
};

type Props = {
  value: LeagueFilter;
  /** Range atual — preservado ao trocar de liga (os dois filtros compõem). */
  range: RangeState;
  className?: string;
};

export function LeagueTabs({ value, range, className }: Props) {
  return (
    <nav
      className={cn(
        "inline-flex h-9 items-center rounded-md border border-border bg-surface-2 p-1",
        className,
      )}
      aria-label="Filtro de liga"
    >
      {visibleLeagueTabs().map(({ value: itemValue, label, active }) => {
        if (!active) {
          // Liga fora de temporada: afordância de UI desabilitada. Um <span> sem
          // href não é navegável nem focável (sem tabIndex); aria-disabled + texto
          // sr-only comunicam o estado a leitores de tela. O detalhe "volta em
          // agosto" vive no sr-only (não só no `title`, que é inalcançável no
          // touch/leitor de tela — #448); o `title` fica pro hover do desktop. O
          // guard em app/jogos/page.tsx continua sendo o enforcement real ("?league="
          // inativa redireciona).
          return (
            <span
              key={itemValue}
              aria-disabled="true"
              title="Fora de temporada — volta em agosto"
              className={cn(
                "h-7 cursor-not-allowed select-none rounded-sm px-3 text-body-sm font-medium leading-7 text-muted-foreground/50",
              )}
            >
              {label}
              <span className="sr-only"> (fora de temporada — volta em agosto)</span>
            </span>
          );
        }
        const selected = itemValue === value;
        return (
          <Link
            key={itemValue}
            href={buildLeagueHref(range, itemValue)}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "h-7 rounded-sm px-3 text-body-sm font-medium leading-7 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              selected
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
