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

import { formatUnits, formatUnitsCompact } from "@/lib/format-number";
import { dayTicks, formatTick } from "@/lib/view/chart-ticks";
import type { BankrollChartPoint } from "@/lib/view/dashboard";

function signed(n: number): string {
  return formatUnits(n, { signed: true });
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

// Só o gráfico (recharts): carregado sob demanda por `BankrollChart`
// (bankroll-chart.tsx), que também cuida do estado vazio.
export function BankrollLineChart({
  data,
  timeZone,
}: {
  data: BankrollChartPoint[];
  // Fuso de exibição do usuário (#1) — formatação determinística do tick (ver formatTick).
  timeZone?: string;
}) {
  return (
    <div className="h-[260px] w-full text-muted-foreground">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
          <CartesianGrid stroke="currentColor" strokeOpacity={0.14} vertical={false} />
          <XAxis
            dataKey="t"
            // Um tick por dia (o primeiro ponto do dia): a série tem um ponto por
            // liquidação e repetia a data (#574). Tick no fuso do usuário (#1): o
            // `timeZone` explícito deixa SSR e hidratação iguais.
            ticks={dayTicks(data, timeZone)}
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
            tickFormatter={(v: number) => formatUnitsCompact(v)}
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
