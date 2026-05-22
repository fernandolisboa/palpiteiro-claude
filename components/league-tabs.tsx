import Link from "next/link";

import { cn } from "@/lib/utils";
import type { LeagueFilter } from "@/lib/fixtures";

type Item = { value: LeagueFilter; label: string };

const ITEMS: Item[] = [
  { value: "all", label: "Todos" },
  { value: "bsa", label: "Brasileirão" },
  { value: "ucl", label: "Champions" },
];

function buildHref(league: LeagueFilter, preserveState: string | null): string {
  const params = new URLSearchParams();
  if (league !== "all") params.set("league", league);
  if (preserveState) params.set("state", preserveState);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

type Props = {
  value: LeagueFilter;
  /** When set, links preserve `?state=...` so the user can swap leagues inside a preview state. */
  preserveState?: string | null;
  className?: string;
};

export function LeagueTabs({ value, preserveState = null, className }: Props) {
  return (
    <div
      className={cn(
        "inline-flex h-9 items-center rounded-md border border-border bg-surface-2 p-1",
        className,
      )}
      role="tablist"
      aria-label="Filtro de liga"
    >
      {ITEMS.map((item) => {
        const active = item.value === value;
        return (
          <Link
            key={item.value}
            role="tab"
            aria-selected={active}
            href={buildHref(item.value, preserveState)}
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
    </div>
  );
}
