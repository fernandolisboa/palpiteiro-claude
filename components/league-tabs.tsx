import Link from "next/link";

import { ACTIVE_LEAGUE_KEYS, ACTIVE_LEAGUES } from "@/lib/config/active-leagues";
import { cn } from "@/lib/utils";
import type { LeagueFilter } from "@/lib/view/types";

type Item = { value: LeagueFilter; label: string };

const ITEMS: Item[] = [
  { value: "all", label: "Todos" },
  { value: "bsa", label: "Brasileirão" },
  { value: "ucl", label: "Champions" },
  { value: "wc", label: "Copa do Mundo" },
];

/**
 * Abas visíveis derivadas das ligas ativas. "Todos" só aparece quando há mais de
 * uma liga ativa. Função pura (seam de teste sem precisar de @testing-library).
 */
export function visibleLeagueTabs(
  activeKeys: readonly LeagueFilter[] = ACTIVE_LEAGUE_KEYS,
): Item[] {
  return ITEMS.filter((item) => {
    if (item.value === "all") return ACTIVE_LEAGUES.length > 1;
    return activeKeys.includes(item.value);
  });
}

function buildHref(league: LeagueFilter): string {
  if (league === "all") return "/";
  const params = new URLSearchParams();
  params.set("league", league);
  return `/?${params.toString()}`;
}

type Props = {
  value: LeagueFilter;
  className?: string;
};

export function LeagueTabs({ value, className }: Props) {
  return (
    <nav
      className={cn(
        "inline-flex h-9 items-center rounded-md border border-border bg-surface-2 p-1",
        className,
      )}
      aria-label="Filtro de liga"
    >
      {visibleLeagueTabs().map((item) => {
        const active = item.value === value;
        return (
          <Link
            key={item.value}
            href={buildHref(item.value)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "h-7 rounded-[5px] px-3 text-[12px] font-medium leading-7 transition-colors",
              active
                ? "bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.4)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
