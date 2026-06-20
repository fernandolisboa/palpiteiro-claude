import Link from "next/link";
import { redirect } from "next/navigation";
import { Inbox } from "lucide-react";

import { BankrollChart } from "@/components/dashboard/bankroll-chart";
import {
  DashboardFiltersBar,
  currentDashboardHref,
} from "@/components/dashboard/dashboard-filters";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { MarketSegments } from "@/components/dashboard/market-segments";
import { PredictionsTable } from "@/components/dashboard/predictions-table";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { DesktopShell } from "@/components/desktop-shell";
import { auth } from "@/auth";
import {
  availableMarketKeys,
  deriveDashboardView,
  parseDashboardFilters,
} from "@/lib/dashboard/derive-view";
import { enrichDashboardRowsWithClosing } from "@/lib/dashboard/clv-enrich";
import { getUserDashboardRows } from "@/lib/db/queries/dashboard";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    status?: string;
    league?: string;
    market?: string;
  }>;
};

export default async function DashboardPage({ searchParams }: PageProps) {
  const { status, league, market } = await searchParams;

  // Middleware garante sessão; redirect defensivo caso o matcher mude.
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  // CLV (#180): anexa a closing line às rows que o dashboard conta (deduped+non-pass).
  const rows = await enrichDashboardRowsWithClosing(
    await getUserDashboardRows(session.user.id),
  );

  const filters = parseDashboardFilters(
    { status, league, market },
    availableMarketKeys(rows),
  );
  const { kpis, segments, series, tableRows, availableLeagues, availableMarkets } =
    deriveDashboardView(rows, filters);

  // URL filtrada atual — propagada aos links da tabela pra preservar a busca ao
  // abrir uma predição e voltar.
  const listHref = currentDashboardHref(filters);

  return (
    <DesktopShell>
      <div className="mx-auto w-full max-w-content px-5 pb-16 pt-8 lg:px-8 lg:pt-10">
        <div className="flex flex-col gap-1 pb-7">
          {/* 28px sem degrau na escala (gap display-md 26 → display-lg 32) — mantido como outlier heroic-display (espelha #246), sem cunhar token; lg sobe pro degrau exato */}
          <h1 className="text-[28px] font-medium leading-none tracking-tight lg:text-display-lg">
            Dashboard
          </h1>
          <p className="text-body tracking-tight text-muted-foreground">
            Seu tracking de over/under 2.5 — yield, racional e resultados.
          </p>
        </div>

        {rows.length === 0 ? (
          <Card className="px-8 py-16 text-center">
            <EmptyState
              className="max-w-form py-6"
              icon={<Inbox className="size-10" strokeWidth={1.25} />}
              title="Você ainda não tem predições"
              description="Gere uma análise num jogo pra começar a trackear seu yield."
              action={
                <Link
                  href="/jogos"
                  className="mt-1 rounded-sm text-body font-medium text-accent-fg hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  Ver próximos jogos →
                </Link>
              }
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-8">
            <KpiCards view={kpis} />

            <MarketSegments segments={segments} />

            <section className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                  bankroll hipotético (u)
                </span>
                <span className="font-mono text-eyebrow tabular-nums text-muted-foreground">
                  {series.length} liquidada{series.length === 1 ? "" : "s"}
                </span>
              </div>
              <BankrollChart data={series} />
            </section>

            <section className="flex flex-col gap-4">
              <DashboardFiltersBar
                filters={filters}
                leagues={availableLeagues}
                markets={availableMarkets}
              />
              <PredictionsTable rows={tableRows} listHref={listHref} />
            </section>
          </div>
        )}
      </div>
    </DesktopShell>
  );
}
