import { notFound } from "next/navigation";
import { Inbox } from "lucide-react";
import { z } from "zod";

import { BackLink } from "@/components/back-link";
import { BankrollChart } from "@/components/dashboard/bankroll-chart";
import { DashboardFiltersBar } from "@/components/dashboard/dashboard-filters";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { MarketSegments } from "@/components/dashboard/market-segments";
import { PredictionsTable } from "@/components/dashboard/predictions-table";
import { Card } from "@/components/ui/card";
import { DesktopShell } from "@/components/desktop-shell";
import { auth } from "@/auth";
import {
  availableMarketKeys,
  deriveDashboardView,
  parseDashboardFilters,
} from "@/lib/dashboard/derive-view";
import { getUserDashboardRows } from "@/lib/db/queries/dashboard";
import { getUserManagement } from "@/lib/db/queries/users";

import { UserAdminControls } from "./user-admin-controls";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{
    status?: string;
    league?: string;
    market?: string;
  }>;
};

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

  // userId é coluna uuid: um param não-UUID estouraria "invalid input syntax
  // for type uuid" (500) no eq — guarda pra notFound limpo (precedente #66).
  if (!z.uuid().safeParse(userId).success) notFound();

  // O alvo precisa existir (header com o e-mail + 404 se id inválido/inexistente).
  // getUserManagement traz role+allowed pros controles de admin (superset).
  const targetUser = await getUserManagement(userId);
  if (!targetUser) notFound();

  // Reusa a query do #10 escopada por userId, passando o userId ALVO — só aqui,
  // dentro do caminho gateado por admin. Assinatura segue userId-OBRIGATÓRIO.
  const rows = await getUserDashboardRows(userId);

  const filters = parseDashboardFilters(
    { status, league, market },
    availableMarketKeys(rows),
  );
  const { kpis, segments, series, tableRows, availableLeagues, availableMarkets } =
    deriveDashboardView(rows, filters);

  const basePath = `/admin/users/${userId}`;

  return (
    <DesktopShell>
      <div className="mx-auto w-full max-w-[1040px] px-5 pb-16 pt-8 lg:px-8 lg:pt-10">
        <BackLink href="/admin/users" label="usuários" />

        <div className="flex flex-col gap-1 pb-7">
          <h1 className="text-[28px] font-medium leading-[1.05] tracking-[-0.035em] lg:text-[32px]">
            Tracking
          </h1>
          <p className="text-[13.5px] tracking-tight text-muted-foreground">
            {targetUser.email} — over/under 2.5, yield, racional e resultados.
          </p>
        </div>

        <UserAdminControls
          userId={targetUser.id}
          role={targetUser.role}
          allowed={targetUser.allowed}
          isSelf={session.user.id === targetUser.id}
        />

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

            <MarketSegments segments={segments} />

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
                markets={availableMarkets}
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
