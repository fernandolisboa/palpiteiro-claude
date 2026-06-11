import { HelpHint } from "@/components/help-hint";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DashboardKpiView, RateView } from "@/lib/view/dashboard";

function SampleNote({ rate }: { rate: RateView }) {
  return (
    <span
      className={cn(
        "font-mono text-[10px] tabular-nums",
        rate.lowSample ? "text-amber-500" : "text-muted-foreground",
      )}
      title={
        rate.lowSample
          ? "Amostra pequena — resultado ainda é ruído, não skill"
          : undefined
      }
    >
      n={rate.n}
      {rate.lowSample ? " · amostra pequena" : ""}
    </span>
  );
}

function RateCard({
  label,
  rate,
  valueClassName,
  hint,
}: {
  label: string;
  rate: RateView;
  valueClassName?: string;
  hint?: { anchor: string; blurb: string };
}) {
  return (
    <Card className="gap-2 p-5">
      <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
        {hint && (
          <HelpHint anchor={hint.anchor} label={label} blurb={hint.blurb} />
        )}
      </span>
      <span
        className={cn(
          "text-[26px] font-medium leading-none tracking-[-0.02em] tabular-nums",
          valueClassName,
        )}
      >
        {rate.value}
      </span>
      <SampleNote rate={rate} />
    </Card>
  );
}

export function KpiCards({ view }: { view: DashboardKpiView }) {
  const { counts } = view;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <RateCard
          label="yield"
          rate={view.yieldPct}
          hint={{
            anchor: "yield",
            blurb:
              "Lucro ÷ total apostado × 100. Conta só apostas liquidadas (exclui pass e void). Mede eficiência, não tamanho.",
          }}
        />
        <RateCard
          label="win rate"
          rate={view.winRate}
          hint={{
            anchor: "win-rate",
            blurb:
              "% de apostas ganhas entre as liquidadas. Win rate alto não garante lucro — o que paga é o yield.",
          }}
        />
        <RateCard
          label="pass rate"
          rate={view.passRate}
          hint={{
            anchor: "pass-rate",
            blurb:
              "% de jogos em que o app não apostou. Alvo saudável: 30–60%. Pass rate alto é disciplina, não fraqueza.",
          }}
        />
        <Card className="gap-2 p-5">
          <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            lucro total
            <HelpHint
              anchor="lucro-total"
              label="lucro total"
              blurb="Soma de lucro/prejuízo acumulado em unidades das apostas já liquidadas, em dinheiro hipotético."
            />
          </span>
          <span
            className={cn(
              "text-[26px] font-medium leading-none tracking-[-0.02em] tabular-nums",
              view.profitPositive ? "text-emerald-500" : "text-red-500",
            )}
          >
            {view.totalProfit}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {counts.settled} liquidada{counts.settled === 1 ? "" : "s"}
          </span>
        </Card>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums text-muted-foreground">
        <span>{counts.total} predições</span>
        <span>· {counts.bets} apostas</span>
        <span>· {counts.passes} pass</span>
        <span>· {counts.pending} pendentes</span>
        <span>· {counts.won}V/{counts.lost}D/{counts.void}A</span>
      </div>
    </div>
  );
}
