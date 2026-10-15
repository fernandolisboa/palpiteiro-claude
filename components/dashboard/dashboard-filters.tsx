import Link from "next/link";

import type { DashboardFilters } from "@/lib/dashboard/kpis";
import type { AvailableMarket } from "@/lib/dashboard/derive-view";
import { LEAGUE_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RESULT_LABEL } from "@/lib/view/result-state";
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
  // Página da tabela (#577): só entra na URL quando > 1.
  page?: number,
): string {
  const params = new URLSearchParams();
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.league !== "all") params.set("league", filters.league);
  if (filters.market !== "all") params.set("market", filters.market);
  if (page !== undefined && page > 1) params.set("page", String(page));
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
  // As palavras são as do selo de resultado (ResultBadge, ADR 0056); os valores da
  // URL (pending/won/lost/void/push) não mudam.
  { value: "pending", label: RESULT_LABEL.pending },
  { value: "won", label: RESULT_LABEL.won },
  { value: "lost", label: RESULT_LABEL.lost },
  { value: "void", label: RESULT_LABEL.void },
  // push = no-action (devolve stake, ADR 0016). Opção fixa; fica vazia enquanto o
  // settlement plugável não emitir push.
  { value: "push", label: RESULT_LABEL.push },
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
  return (
    // Muitas opções (status, ligas) rolam DENTRO do grupo no celular, sem estourar a
    // largura da página (#574 linha 5).
    <div className="flex min-w-0 max-w-full items-center gap-2">
      <span className="shrink-0 text-meta uppercase tracking-label text-muted-foreground">
        {label}
      </span>
      <nav className="inline-flex h-8 max-w-full items-center overflow-x-auto rounded-md border border-border bg-surface-2 p-1 [scrollbar-width:none]">
        {options.map((opt) => {
          const active = opt.value === current;
          return (
            <Link
              key={opt.value}
              href={buildDashboardHref(filters, dimension, opt.value, basePath)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "h-6 shrink-0 whitespace-nowrap rounded-sm px-2.5 text-meta font-medium leading-6 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
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

const ALL_DIMENSIONS: readonly FilterDimension[] = ["status", "league", "market"];

/**
 * Barra de filtros. `dimensions` escolhe quais grupos renderizar: o dashboard põe
 * liga+mercado no topo (recortam KPIs, gráfico e tabela) e status junto da tabela
 * (só ela) — #539. Grupo com uma opção real só ("Todas" + 1 liga) não filtra
 * nada e some; sem nenhum grupo visível, não renderiza nem o wrapper (evita um
 * gap vazio no layout).
 */
export function DashboardFiltersBar({
  filters,
  leagues,
  markets,
  basePath = "/dashboard",
  dimensions = ALL_DIMENSIONS,
}: {
  filters: DashboardFilters;
  leagues: LeagueKey[];
  markets: AvailableMarket[];
  basePath?: string;
  dimensions?: readonly FilterDimension[];
}) {
  const leagueOptions: Option[] = [
    { value: "all", label: "Todas" },
    ...leagues.map((k) => ({ value: k, label: LEAGUE_LABEL[k] })),
  ];
  // Dinâmico de availableMarkets (label de markets.label via join).
  const marketOptions: Option[] = [
    { value: "all", label: "Todos" },
    ...markets.map((m) => ({ value: m.key, label: m.label })),
  ];
  const groups: Record<FilterDimension, { label: string; options: Option[] }> = {
    status: { label: "status", options: STATUS_OPTIONS },
    league: { label: "liga", options: leagueOptions },
    market: { label: "mercado", options: marketOptions },
  };
  // > 2 = "Todas" + pelo menos duas opções reais. Filtro ativo fica visível mesmo
  // assim, senão não haveria pill pra voltar a "Todas".
  const visible = dimensions.filter(
    (d) => groups[d].options.length > 2 || filters[d] !== "all",
  );
  if (visible.length === 0) return null;
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-x-5 gap-y-3">
      {visible.map((d) => (
        <PillGroup
          key={d}
          label={groups[d].label}
          options={groups[d].options}
          current={filters[d]}
          dimension={d}
          filters={filters}
          basePath={basePath}
        />
      ))}
    </div>
  );
}
