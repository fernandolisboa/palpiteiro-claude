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

function formatTick(iso: string): string {
  const d = new Date(iso);
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
    <div className="rounded-md border border-border bg-card px-3 py-2 text-[11px] shadow-sm">
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

export function BankrollChart({ data }: { data: BankrollChartPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-xl border border-border bg-card px-6 text-center text-[13px] text-muted-foreground">
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
            tickFormatter={formatTick}
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
            stroke="#a78bfa"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, fill: "#a78bfa" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
