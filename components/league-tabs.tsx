import Link from "next/link";

import { ACTIVE_LEAGUE_KEYS } from "@/lib/config/active-leagues";
import { cn } from "@/lib/utils";
import { buildLeagueHref } from "@/lib/view/range-href";
import type { RangePreset } from "@/lib/view/date-range";
import type { LeagueFilter } from "@/lib/view/types";

type Item = { value: LeagueFilter; label: string };
export type LeagueTabItem = Item & { active: boolean };

const ITEMS: Item[] = [
  { value: "all", label: "Todos" },
  { value: "bsa", label: "Brasileirão" },
  { value: "ucl", label: "Champions" },
  { value: "wc", label: "Copa do Mundo" },
];

/**
 * Todas as ligas suportadas, anotadas com `active` derivado das ligas ativas.
 * Cada liga (bsa/ucl/wc) sempre aparece; as inativas são renderizadas
 * desabilitadas. A aba "Todos" só aparece quando há mais de uma liga ativa.
 * Função pura (seam de teste sem precisar de @testing-library).
 */
export function visibleLeagueTabs(
  activeKeys: readonly LeagueFilter[] = ACTIVE_LEAGUE_KEYS,
): LeagueTabItem[] {
  return ITEMS.flatMap((item) => {
    if (item.value === "all") {
      return activeKeys.length > 1 ? [{ ...item, active: true }] : [];
    }
    return [{ ...item, active: activeKeys.includes(item.value) }];
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
          // sr-only comunicam o estado a leitores de tela. O guard em app/page.tsx
          // continua sendo o enforcement real ("?league=" inativa redireciona).
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
              <span className="sr-only"> (fora de temporada)</span>
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
