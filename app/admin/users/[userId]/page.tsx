import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Inbox } from "lucide-react";

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
import { getUserById } from "@/lib/db/queries/users";
import { leagueToKey } from "@/lib/format";
import { toDashboardKpiView, toPredictionRowView } from "@/lib/view/dashboard";
import { parseLeagueFilter, type LeagueKey } from "@/lib/view/types";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{
    status?: string;
    league?: string;
    market?: string;
  }>;
};

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

// Gateado por app/admin/layout.tsx (role === "admin" → notFound pra outros).
export default async function AdminUserTrackingPage({
  params,
  searchParams,
}: PageProps) {
  const { userId } = await params;
  const { status, league, market } = await searchParams;

  // Re-check defensivo: lê predições de OUTRO usuário (cross-user). Defense-in-depth
  // — NÃO confiar só no gate do layout. Espelha costs/invites.
  const session = await auth();
  if (session?.user?.role !== "admin") notFound();

  // O alvo precisa existir (header com o e-mail + 404 se id inválido/inexistente).
  const targetUser = await getUserById(userId);
  if (!targetUser) notFound();

  // Reusa a query do #10 escopada por userId, passando o userId ALVO — só aqui,
  // dentro do caminho gateado por admin. Assinatura segue userId-OBRIGATÓRIO.
  const rows = await getUserDashboardRows(userId);

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

  const basePath = `/admin/users/${userId}`;

  return (
    <DesktopShell>
      <div className="mx-auto w-full max-w-[1040px] px-5 pb-16 pt-8 lg:px-8 lg:pt-10">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-2 pb-6 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          <span className="text-[12.5px] tracking-tight">usuários</span>
        </Link>

        <div className="flex flex-col gap-1 pb-7">
          <h1 className="text-[28px] font-medium leading-[1.05] tracking-[-0.035em] lg:text-[32px]">
            Tracking
          </h1>
          <p className="text-[13.5px] tracking-tight text-muted-foreground">
            {targetUser.email} — over/under 2.5, yield, racional e resultados.
          </p>
        </div>

        {rows.length === 0 ? (
          <Card className="px-8 py-16 text-center">
            <div className="mx-auto flex max-w-[380px] flex-col items-center gap-3">
              <span className="text-muted-fg-2">
                <Inbox className="size-10" strokeWidth={1.25} />
              </span>
              <span className="text-[15px] font-medium tracking-tight">
                Este usuário ainda não tem predições
              </span>
              <span className="text-[13px] tracking-tight text-muted-foreground">
                Nada pra trackear ainda.
              </span>
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
                basePath={basePath}
              />
              <PredictionsTable rows={tableRows} basePath={basePath} />
            </section>
          </div>
        )}
      </div>
    </DesktopShell>
  );
}
