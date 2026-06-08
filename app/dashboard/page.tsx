import Link from "next/link";
import { redirect } from "next/navigation";
import { Inbox } from "lucide-react";

import { BankrollChart } from "@/components/dashboard/bankroll-chart";
import { DashboardFiltersBar } from "@/components/dashboard/dashboard-filters";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { PredictionsTable } from "@/components/dashboard/predictions-table";
import { Card } from "@/components/ui/card";
import { DesktopShell } from "@/components/desktop-shell";
import { auth } from "@/auth";
import {
  applyTableFilters,
  computeBankrollSeries,
  computeDashboardKpis,
  type DashboardFilters,
  type MarketFilter,
  type StatusFilter,
} from "@/lib/dashboard/kpis";
import { getUserDashboardRows } from "@/lib/db/queries/dashboard";
import { leagueToKey } from "@/lib/format";
import {
  toDashboardKpiView,
  toPredictionRowView,
} from "@/lib/view/dashboard";
import { parseLeagueFilter, type LeagueKey } from "@/lib/view/types";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    status?: string;
    league?: string;
    market?: string;
  }>;
};

function parseStatus(value: string | undefined): StatusFilter {
  if (value === "pending" || value === "won" || value === "lost" || value === "void") {
    return value;
  }
  return "all";
}

function parseMarket(value: string | undefined): MarketFilter {
  return value === "over_under_2_5" ? "over_under_2_5" : "all";
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const { status, league, market } = await searchParams;

  // Middleware garante sessão; redirect defensivo caso o matcher mude.
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const rows = await getUserDashboardRows(session.user.id);

  const filters: DashboardFilters = {
    status: parseStatus(status),
    league: parseLeagueFilter(league),
    market: parseMarket(market),
  };

  // KPIs e gráfico sobre TODAS as linhas; a tabela filtra à parte.
  const kpis = toDashboardKpiView(computeDashboardKpis(rows));
  const series = computeBankrollSeries(rows);
  const tableRows = applyTableFilters(rows, filters).map(toPredictionRowView);

  const availableLeagues: LeagueKey[] = [
    ...new Set(rows.map((r) => leagueToKey(r.league))),
  ];

  return (
    <DesktopShell>
      <div className="mx-auto w-full max-w-[1040px] px-5 pb-16 pt-8 lg:px-8 lg:pt-10">
        <div className="flex flex-col gap-1 pb-7">
          <h1 className="text-[28px] font-medium leading-[1.05] tracking-[-0.035em] lg:text-[32px]">
            Dashboard
          </h1>
          <p className="text-[13.5px] tracking-tight text-muted-foreground">
            Seu tracking de over/under 2.5 — yield, racional e resultados.
          </p>
        </div>

        {rows.length === 0 ? (
          <Card className="px-8 py-16 text-center">
            <div className="mx-auto flex max-w-[380px] flex-col items-center gap-3">
              <span className="text-muted-fg-2">
                <Inbox className="size-10" strokeWidth={1.25} />
              </span>
              <span className="text-[15px] font-medium tracking-tight">
                Você ainda não tem predições
              </span>
              <span className="text-[13px] tracking-tight text-muted-foreground">
                Gere uma análise num jogo pra começar a trackear seu yield.
              </span>
              <Link
                href="/"
                className="mt-1 text-[13px] font-medium text-accent-fg hover:underline"
              >
                Ver próximos jogos →
              </Link>
            </div>
          </Card>
        ) : (
          <div className="flex flex-col gap-8">
            <KpiCards view={kpis} />

            <section className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground">
                  bankroll hipotético (u)
                </span>
                <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
                  {series.length} liquidada{series.length === 1 ? "" : "s"}
                </span>
              </div>
              <BankrollChart data={series} />
            </section>

            <section className="flex flex-col gap-4">
              <DashboardFiltersBar
                filters={filters}
                leagues={availableLeagues}
              />
              <PredictionsTable rows={tableRows} />
            </section>
          </div>
        )}
      </div>
    </DesktopShell>
  );
}
