import { DefinitionRow } from "@/components/admin/definition-row";
import { PageHeading } from "@/components/admin/page-heading";
import {
  getCostByDay,
  getCostByModel,
  getCostByUser,
  getCostSummary,
} from "@/lib/db/queries/ai-costs";
import {
  formatCostUsd,
  formatCostUsdTotal,
  formatModelName,
} from "@/lib/format";

export const dynamic = "force-dynamic";

// Gateado por app/admin/layout.tsx (role === "admin" → notFound pra outros).
export default async function AdminCostsPage() {
  const [summary, byDay, byUser, byModel] = await Promise.all([
    getCostSummary(),
    getCostByDay(30),
    getCostByUser(),
    getCostByModel(),
  ]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-reading px-6 py-8">
        <PageHeading
          backLink={{ href: "/admin", label: "admin" }}
          title="Custos de IA"
          subtitle="gasto agregado · por dia, usuário, modelo · USD"
        />

        <section className="pb-8">
          <h2 className="pb-3 font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
            resumo
          </h2>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
            <Kpi label="total" value={formatCostUsdTotal(summary.totalUsd)} />
            <Kpi label="hoje" value={formatCostUsdTotal(summary.todayUsd)} />
            <Kpi
              label="últimos 7d"
              value={formatCostUsdTotal(summary.last7dUsd)}
            />
            <Kpi
              label="chamadas"
              value={summary.totalCalls.toLocaleString("pt-BR")}
            />
          </div>
        </section>

        <section className="pb-8">
          <h2 className="pb-3 font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
            por dia
          </h2>
          {byDay.length === 0 ? (
            <p className="text-body text-muted-foreground">
              Nenhuma chamada registrada.
            </p>
          ) : (
            <div className="rounded-md border border-border">
              {byDay.map((r) => (
                <DefinitionRow
                  key={r.day}
                  className="gap-4 px-4 py-3 last:border-b-0"
                  label={
                    <span className="font-mono text-body-sm tabular-nums">
                      {formatDay(r.day)}
                    </span>
                  }
                  value={
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-body-sm tabular-nums text-muted-foreground">
                        {r.calls} chamadas
                      </span>
                      <span className="font-mono text-body tabular-nums">
                        {formatCostUsd(r.totalUsd)}
                      </span>
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </section>

        <section className="pb-8">
          <h2 className="pb-3 font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
            por usuário
          </h2>
          {byUser.length === 0 ? (
            <p className="text-body text-muted-foreground">
              Nenhuma chamada registrada.
            </p>
          ) : (
            <div className="rounded-md border border-border">
              {byUser.map((u) => (
                <DefinitionRow
                  key={u.userId}
                  className="gap-4 px-4 py-3 last:border-b-0"
                  label={
                    <span className="truncate text-body font-medium">
                      {u.email}
                    </span>
                  }
                  value={
                    <div className="flex shrink-0 items-center gap-4">
                      <span className="font-mono text-body-sm tabular-nums text-muted-foreground">
                        {u.calls} chamadas
                      </span>
                      <span className="font-mono text-body tabular-nums">
                        {formatCostUsd(u.totalUsd)}
                      </span>
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="pb-3 font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
            por modelo
          </h2>
          {byModel.length === 0 ? (
            <p className="text-body text-muted-foreground">
              Nenhuma chamada registrada.
            </p>
          ) : (
            <div className="rounded-md border border-border">
              {byModel.map((m) => (
                <DefinitionRow
                  key={m.model}
                  className="gap-4 px-4 py-3 last:border-b-0"
                  label={
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-body font-medium">
                        {formatModelName(m.model)}
                      </span>
                      <span className="truncate font-mono text-eyebrow text-muted-foreground">
                        {m.model}
                      </span>
                    </div>
                  }
                  value={
                    <div className="flex shrink-0 items-center gap-4">
                      <span className="font-mono text-body-sm tabular-nums text-muted-foreground">
                        {m.calls} chamadas
                      </span>
                      <span className="font-mono text-body tabular-nums">
                        {formatCostUsd(m.totalUsd)}
                      </span>
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 bg-background px-4 py-3">
      <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
        {label}
      </span>
      {/* outlier de escala: 16px não tem degrau (sem 14↔18); mantido literal, ADR 0029 §A.1 */}
      <span className="font-mono text-[16px] tabular-nums">{value}</span>
    </div>
  );
}

/** "2026-06-08" → "08/06" pra leitura compacta no row. */
function formatDay(day: string): string {
  const [, month, date] = day.split("-");
  if (!month || !date) return day;
  return `${date}/${month}`;
}
