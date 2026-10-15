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
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { PredictionsTable } from "@/components/dashboard/predictions-table";
import { TablePagination } from "@/components/dashboard/table-pagination";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { MatchCollapsible } from "@/components/match-collapsible";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { auth } from "@/auth";
import {
  availableLeagueKeys,
  availableMarketKeys,
  deriveDashboardView,
  parseDashboardFilters,
} from "@/lib/dashboard/derive-view";
import { enrichDashboardRowsWithClosing } from "@/lib/dashboard/clv-enrich";
import { getRequestTimeZone } from "@/lib/server/request-timezone";
import { getUserDashboardRows } from "@/lib/db/queries/dashboard";
import { paginate } from "@/lib/view/paginate";

// Análises por página na tabela (#577). Só na página do usuário: o admin vê tudo.
const TABLE_PAGE_SIZE = 25;

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    status?: string;
    league?: string;
    market?: string;
    page?: string;
  }>;
};

export default async function DashboardPage({ searchParams }: PageProps) {
  const { status, league, market, page: rawPage } = await searchParams;

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
    availableLeagueKeys(rows),
  );
  // Fuso de exibição do usuário (#1) — coluna "data" da tabela no fuso do navegador.
  const timeZone = await getRequestTimeZone();
  const { kpis, segments, series, tableRows, availableLeagues, availableMarkets } =
    deriveDashboardView(rows, filters, timeZone);

  // A página corta o recorte DEPOIS do filtro de status: "Página N de M" é do recorte.
  const table = paginate(tableRows, rawPage, TABLE_PAGE_SIZE);
  // URL filtrada atual (com a página) — propagada aos links da tabela pra preservar a
  // busca ao abrir uma predição e voltar.
  const listHref = currentDashboardHref(filters, "/dashboard", table.page);

  return (
    <>
      <PageContainer width="content">
        <PageHeader
          title="Desempenho"
          description="Suas análises por mercado: retorno, racional e resultados."
        />

        {rows.length === 0 ? (
          <Card className="px-8 py-16 text-center">
            <EmptyState
              className="max-w-form py-6"
              icon={<Inbox className="size-10" strokeWidth={1.25} />}
              title="Você ainda não tem predições"
              description="Gere uma análise num jogo pra começar a acompanhar seu retorno."
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
            {/* Liga e mercado recortam tudo abaixo (resumo, gráfico, detalhe técnico
                e tabela); o status, junto da tabela, filtra só ela (#539). */}
            <DashboardFiltersBar
              filters={filters}
              leagues={availableLeagues}
              markets={availableMarkets}
              dimensions={["league", "market"]}
            />

            {/* Resumo e gráfico antes de qualquer número por mercado (#577). */}
            <SummaryCards view={kpis} />

            <section className="flex flex-col gap-3">
              <span className="text-meta uppercase tracking-eyebrow text-muted-foreground">
                saldo hipotético (u)
              </span>
              <BankrollChart data={series} timeZone={timeZone} />
            </section>

            {/* CLV, amostra e graduação por mercado, recolhidos. Sem `meta` no
                MatchCollapsible: ele é mono e o texto aqui é palavra (ADR 0056). */}
            <MatchCollapsible title="Detalhe técnico">
              <div className="flex flex-col gap-6">
                <p className="text-body-sm tracking-tight text-muted-foreground">
                  CLV, amostra e graduação por mercado.
                </p>
                <KpiCards view={kpis} variant="technical" />
                <MarketSegments segments={segments} />
              </div>
            </MatchCollapsible>

            <section className="flex flex-col gap-4">
              <DashboardFiltersBar
                filters={filters}
                leagues={availableLeagues}
                markets={availableMarkets}
                dimensions={["status"]}
              />
              {table.total > 0 && (
                <span className="text-meta tabular-nums text-muted-foreground">
                  {table.total} {table.total === 1 ? "análise" : "análises"}
                </span>
              )}
              <PredictionsTable rows={table.items} listHref={listHref} />
              <TablePagination
                page={table.page}
                pageCount={table.pageCount}
                hrefFor={(n) => currentDashboardHref(filters, "/dashboard", n)}
              />
            </section>
          </div>
        )}
      </PageContainer>
    </>
  );
}
