"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { BankrollChartPoint } from "@/lib/view/dashboard";

const MONTH_ABBR_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

// Tick do eixo X no fuso do usuário (#1). `timeZone` EXPLÍCITO torna a formatação
// determinística: o MESMO output no SSR (server) e na hidratação (cliente) — sem
// getDate/getMonth do runtime, que divergiria UTC↔navegador perto da meia-noite
// (mismatch de hidratação). Undefined = legado (runtime-local) só fora das páginas.
function formatTick(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      day: "2-digit",
      month: "2-digit",
    }).formatToParts(d);
    const pick = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return `${pick("day").toString().padStart(2, "0")} ${MONTH_ABBR_PT[pick("month") - 1]}`;
  }
  return `${d.getDate().toString().padStart(2, "0")} ${MONTH_ABBR_PT[d.getMonth()]}`;
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)} u`;
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: BankrollChartPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-meta shadow-sm">
      <div className="pb-0.5 font-medium tracking-tight">{point.label}</div>
      <div className="tabular-nums text-muted-foreground">
        acumulado: {signed(point.cumulative)}
      </div>
      <div className="tabular-nums text-muted-foreground">
        resultado: {signed(point.profit)}
      </div>
    </div>
  );
}

export function BankrollChart({
  data,
  timeZone,
}: {
  data: BankrollChartPoint[];
  // Fuso de exibição do usuário (#1) — formatação determinística do tick (ver formatTick).
  timeZone?: string;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-xl border border-border bg-card px-6 text-center text-body text-muted-foreground">
        Sem predições liquidadas ainda — o bankroll aparece após os jogos.
      </div>
    );
  }
  return (
    <div className="h-[260px] w-full text-muted-foreground">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.14} vertical={false} />
          <XAxis
            dataKey="t"
            tickFormatter={(iso: string) => formatTick(iso, timeZone)}
            tick={{ fontSize: 11, fill: "currentColor" }}
            tickLine={false}
            axisLine={{ stroke: "currentColor", strokeOpacity: 0.2 }}
            minTickGap={24}
          />
          <YAxis
            width={44}
            tick={{ fontSize: 11, fill: "currentColor" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}u`}
          />
          <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.35} />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ stroke: "currentColor", strokeOpacity: 0.2 }}
          />
          <Line
            type="monotone"
            dataKey="cumulative"
            stroke="var(--chart-1)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, fill: "var(--chart-1)" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
