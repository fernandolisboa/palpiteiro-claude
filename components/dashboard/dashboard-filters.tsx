import Link from "next/link";

import type { DashboardFilters } from "@/lib/dashboard/kpis";
import { LEAGUE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LeagueKey } from "@/lib/view/types";

export type FilterDimension = "status" | "league" | "market";

/**
 * Href preservando as outras dimensões; "all" limpa o param. Função pura
 * (testável sem render), espelha `buildHref` de `league-tabs`.
 */
export function buildDashboardHref(
  current: DashboardFilters,
  dimension: FilterDimension,
  value: string,
  basePath = "/dashboard",
): string {
  const next: DashboardFilters = { ...current, [dimension]: value };
  const params = new URLSearchParams();
  if (next.status !== "all") params.set("status", next.status);
  if (next.league !== "all") params.set("league", next.league);
  if (next.market !== "all") params.set("market", next.market);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

type Option = { value: string; label: string };

const STATUS_OPTIONS: Option[] = [
  { value: "all", label: "Todas" },
  { value: "pending", label: "Pendentes" },
  { value: "won", label: "Green" },
  { value: "lost", label: "Red" },
  { value: "void", label: "Anuladas" },
];

const MARKET_OPTIONS: Option[] = [
  { value: "all", label: "Todos" },
  { value: "over_under_2_5", label: "O/U 2.5" },
];

function PillGroup({
  label,
  options,
  current,
  dimension,
  filters,
  basePath,
}: {
  label: string;
  options: Option[];
  current: string;
  dimension: FilterDimension;
  filters: DashboardFilters;
  basePath: string;
}) {
  if (options.length <= 1) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <nav className="inline-flex h-8 items-center rounded-md border border-border bg-surface-2 p-1">
        {options.map((opt) => {
          const active = opt.value === current;
          return (
            <Link
              key={opt.value}
              href={buildDashboardHref(filters, dimension, opt.value, basePath)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "h-6 rounded-[5px] px-2.5 text-[11.5px] font-medium leading-6 transition-colors",
                active
                  ? "bg-card text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.4)]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {opt.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function DashboardFiltersBar({
  filters,
  leagues,
  basePath = "/dashboard",
}: {
  filters: DashboardFilters;
  leagues: LeagueKey[];
  basePath?: string;
}) {
  const leagueOptions: Option[] = [
    { value: "all", label: "Todas" },
    ...leagues.map((k) => ({ value: k, label: LEAGUE_LABEL[k] })),
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <PillGroup
        label="status"
        options={STATUS_OPTIONS}
        current={filters.status}
        dimension="status"
        filters={filters}
        basePath={basePath}
      />
      <PillGroup
        label="liga"
        options={leagueOptions}
        current={filters.league}
        dimension="league"
        filters={filters}
        basePath={basePath}
      />
      <PillGroup
        label="mercado"
        options={MARKET_OPTIONS}
        current={filters.market}
        dimension="market"
        filters={filters}
        basePath={basePath}
      />
    </div>
  );
}
