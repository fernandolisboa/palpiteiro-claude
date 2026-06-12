import {
  applyTableFilters,
  computeBankrollSeries,
  computeDashboardKpis,
  keepLatestPerMatch,
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
  // ADR 0020 / #116: conta no máximo uma predição por jogo (a mais recente) em
  // TODOS os outputs — KPIs, gráfico E tabela — pra reanálise não inflar nada.
  const deduped = keepLatestPerMatch(rows);
  // KPIs e gráfico sobre as linhas deduplicadas; a tabela filtra à parte.
  return {
    kpis: toDashboardKpiView(computeDashboardKpis(deduped)),
    series: computeBankrollSeries(deduped),
    tableRows: applyTableFilters(deduped, filters).map(toPredictionRowView),
    availableLeagues: [...new Set(deduped.map((r) => leagueToKey(r.league)))],
  };
}
