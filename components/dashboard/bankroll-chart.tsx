"use client";

import dynamic from "next/dynamic";

import type { BankrollChartPoint } from "@/lib/view/dashboard";

// Mesma caixa do gráfico (h-[260px]): o recharts fica fora do bundle inicial e a
// página não pula quando ele chega. Sem SSR de propósito — o ResponsiveContainer
// já não desenhava nada no servidor (só mede o tamanho no navegador).
const BankrollLineChart = dynamic(
  () =>
    import("@/components/dashboard/bankroll-line-chart").then(
      (m) => m.BankrollLineChart,
    ),
  {
    ssr: false,
    loading: () => <div className="h-[260px] w-full" />,
  },
);

export function BankrollChart({
  data,
  timeZone,
}: {
  data: BankrollChartPoint[];
  // Fuso de exibição do usuário (#1) — formatação determinística do tick.
  timeZone?: string;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-xl border border-border bg-card px-6 text-center text-body text-muted-foreground">
        Sem predições liquidadas ainda — o bankroll aparece após os jogos.
      </div>
    );
  }
  return <BankrollLineChart data={data} timeZone={timeZone} />;
}
