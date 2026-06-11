import { BackLink } from "@/components/back-link";
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
      <div className="mx-auto w-full max-w-[640px] px-6 py-8">
        <BackLink href="/admin" label="admin" />

        <h1 className="text-[20px] font-medium tracking-[-0.02em]">
          Custos de IA
        </h1>
        <p className="pb-6 font-mono text-[11px] text-muted-foreground">
          gasto agregado · por dia, usuário, modelo · USD
        </p>

        <section className="pb-8">
          <h2 className="pb-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
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
          <h2 className="pb-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            por dia
          </h2>
          {byDay.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Nenhuma chamada registrada.
            </p>
          ) : (
            <div className="rounded-md border border-border">
              {byDay.map((r) => (
                <div
                  key={r.day}
                  className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0"
                >
                  <span className="font-mono text-[12.5px] tabular-nums">
                    {formatDay(r.day)}
                  </span>
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-[12.5px] tabular-nums text-muted-foreground">
                      {r.calls} chamadas
                    </span>
                    <span className="font-mono text-[13px] tabular-nums">
                      {formatCostUsd(r.totalUsd)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="pb-8">
          <h2 className="pb-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            por usuário
          </h2>
          {byUser.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Nenhuma chamada registrada.
            </p>
          ) : (
            <div className="rounded-md border border-border">
              {byUser.map((u) => (
                <div
                  key={u.userId}
                  className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0"
                >
                  <span className="truncate text-[13px] font-medium">
                    {u.email}
                  </span>
                  <div className="flex shrink-0 items-center gap-4">
                    <span className="font-mono text-[12.5px] tabular-nums text-muted-foreground">
                      {u.calls} chamadas
                    </span>
                    <span className="font-mono text-[13px] tabular-nums">
                      {formatCostUsd(u.totalUsd)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="pb-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            por modelo
          </h2>
          {byModel.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              Nenhuma chamada registrada.
            </p>
          ) : (
            <div className="rounded-md border border-border">
              {byModel.map((m) => (
                <div
                  key={m.model}
                  className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-medium">
                      {formatModelName(m.model)}
                    </span>
                    <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                      {m.model}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <span className="font-mono text-[12.5px] tabular-nums text-muted-foreground">
                      {m.calls} chamadas
                    </span>
                    <span className="font-mono text-[13px] tabular-nums">
                      {formatCostUsd(m.totalUsd)}
                    </span>
                  </div>
                </div>
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
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
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
