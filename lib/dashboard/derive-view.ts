import {
  applyTableFilters,
  computeBankrollSeries,
  computeDashboardKpis,
  type BankrollPoint,
  type DashboardFilters,
  type DashboardRow,
  type MarketFilter,
  type StatusFilter,
} from "@/lib/dashboard/kpis";
import { leagueToKey } from "@/lib/format";
import { toDashboardKpiView, toPredictionRowView } from "@/lib/view/dashboard";
import { parseLeagueFilter, type LeagueKey } from "@/lib/view/types";

function parseStatus(value: string | undefined): StatusFilter {
  if (
    value === "pending" ||
    value === "won" ||
    value === "lost" ||
    value === "void"
  ) {
    return value;
  }
  return "all";
}

function parseMarket(value: string | undefined): MarketFilter {
  return value === "over_under_2_5" ? "over_under_2_5" : "all";
}

export function parseDashboardFilters(sp: {
  status?: string;
  league?: string;
  market?: string;
}): DashboardFilters {
  return {
    status: parseStatus(sp.status),
    league: parseLeagueFilter(sp.league),
    market: parseMarket(sp.market),
  };
}

export type DashboardView = {
  kpis: ReturnType<typeof toDashboardKpiView>;
  series: BankrollPoint[];
  tableRows: ReturnType<typeof toPredictionRowView>[];
  availableLeagues: LeagueKey[];
};

export function deriveDashboardView(
  rows: DashboardRow[],
  filters: DashboardFilters,
): DashboardView {
  // KPIs e gráfico sobre TODAS as linhas; a tabela filtra à parte.
  return {
    kpis: toDashboardKpiView(computeDashboardKpis(rows)),
    series: computeBankrollSeries(rows),
    tableRows: applyTableFilters(rows, filters).map(toPredictionRowView),
    availableLeagues: [...new Set(rows.map((r) => leagueToKey(r.league)))],
  };
}
