import Link from "next/link";

import type { DashboardFilters } from "@/lib/dashboard/kpis";
import type { AvailableMarket } from "@/lib/dashboard/derive-view";
import { LEAGUE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LeagueKey } from "@/lib/view/types";

export type FilterDimension = "status" | "league" | "market";

/**
 * URL do dashboard pros filtros ATUAIS (omite os defaults "all"). Pura/testável.
 * Usada pra preservar o estado de busca ao abrir uma predição e voltar (param
 * `back` em PredictionsTable), e como base do `buildDashboardHref`.
 */
export function currentDashboardHref(
  filters: DashboardFilters,
  basePath = "/dashboard",
): string {
  const params = new URLSearchParams();
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.league !== "all") params.set("league", filters.league);
  if (filters.market !== "all") params.set("market", filters.market);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/**
 * Href preservando as outras dimensões; "all" limpa o param. Função pura
 * (testável sem render), espelha `buildLeagueHref` do seletor de liga.
 */
export function buildDashboardHref(
  current: DashboardFilters,
  dimension: FilterDimension,
  value: string,
  basePath = "/dashboard",
): string {
  return currentDashboardHref({ ...current, [dimension]: value }, basePath);
}

type Option = { value: string; label: string };

const STATUS_OPTIONS: Option[] = [
  { value: "all", label: "Todas" },
  { value: "pending", label: "Pendentes" },
  { value: "won", label: "Green" },
  { value: "lost", label: "Red" },
  { value: "void", label: "Anuladas" },
  // push = no-action (devolve stake, ADR 0016). Selecionável quando o settlement
  // plugável começar a emitir; com zero rows push o PillGroup nem aparece à parte.
  { value: "push", label: "Push" },
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
      <span className="font-mono text-eyebrow-xs uppercase tracking-label text-muted-foreground">
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
                "h-6 rounded-sm px-2.5 text-meta font-medium leading-6 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                active
                  ? "bg-card text-foreground shadow-sm"
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
  markets,
  basePath = "/dashboard",
}: {
  filters: DashboardFilters;
  leagues: LeagueKey[];
  markets: AvailableMarket[];
  basePath?: string;
}) {
  const leagueOptions: Option[] = [
    { value: "all", label: "Todas" },
    ...leagues.map((k) => ({ value: k, label: LEAGUE_LABEL[k] })),
  ];
  // Dinâmico de availableMarkets (label de markets.label via join). PillGroup
  // some quando há ≤1 mercado (≤1 opção real → options.length 1 com só "all").
  const marketOptions: Option[] = [
    { value: "all", label: "Todos" },
    ...markets.map((m) => ({ value: m.key, label: m.label })),
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
        options={marketOptions}
        current={filters.market}
        dimension="market"
        filters={filters}
        basePath={basePath}
      />
    </div>
  );
}
