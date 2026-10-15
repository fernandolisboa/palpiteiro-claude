import { HelpHint } from "@/components/help-hint";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DashboardKpiView, RateView } from "@/lib/view/dashboard";

function SampleNote({ rate }: { rate: RateView }) {
  // #448: a explicação da amostra pequena morava só num `title` (inalcançável no
  // touch). Migrada pro popover HelpHint (mesmo padrão dos KPIs), tocável.
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono text-meta tabular-nums",
        rate.lowSample ? "text-warn-fg" : "text-muted-foreground",
      )}
    >
      n={rate.n}
      {rate.lowSample && (
        <>
          {" · amostra pequena"}
          <HelpHint
            anchor="amostra-pequena"
            label="amostra pequena"
            blurb="Menos de 20 apostas liquidadas. Com tão poucas, os números são ruído de sorte, não habilidade — não conclua cedo demais."
          />
        </>
      )}
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
      <span className="flex items-center gap-1 text-meta uppercase tracking-label text-muted-foreground">
        {label}
        {hint && (
          <HelpHint anchor={hint.anchor} label={label} blurb={hint.blurb} />
        )}
      </span>
      <span
        className={cn(
          "text-display-md font-medium leading-none tracking-tight tabular-nums",
          valueClassName,
        )}
      >
        {rate.value}
      </span>
      <SampleNote rate={rate} />
    </Card>
  );
}

const PASS_RATE_HINT = {
  anchor: "pass-rate",
  blurb:
    "% de jogos em que o app não apostou. Alvo saudável: 30–60%. Muitos jogos sem aposta é disciplina, não fraqueza.",
};

function CountsLine({ counts }: { counts: DashboardKpiView["counts"] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-meta tabular-nums text-muted-foreground">
      <span>{counts.total} predições</span>
      <span>· {counts.bets} apostas</span>
      <span>· {counts.passes} sem aposta</span>
      <span>· {counts.pending} em aberto</span>
      <span>· {counts.won}V/{counts.lost}D/{counts.void}A</span>
    </div>
  );
}

/**
 * `full` (padrão, admin): os quatro cartões e as contagens. `technical` (#577, o
 * "Detalhe técnico" do Desempenho): só "jogos sem aposta" e as contagens — retorno,
 * taxa de acerto e saldo já estão no resumo do topo e não se repetem na tela.
 */
export function KpiCards({
  view,
  variant = "full",
}: {
  view: DashboardKpiView;
  variant?: "full" | "technical";
}) {
  const { counts } = view;
  if (variant === "technical") {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <RateCard label="jogos sem aposta" rate={view.passRate} hint={PASS_RATE_HINT} />
        </div>
        <CountsLine counts={counts} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <RateCard
          label="retorno"
          rate={view.yieldPct}
          hint={{
            anchor: "yield",
            blurb:
              "Lucro ÷ total apostado × 100. Conta só apostas liquidadas (exclui jogos sem aposta e anuladas). Mede eficiência, não tamanho.",
          }}
        />
        <RateCard
          label="taxa de acerto"
          rate={view.winRate}
          hint={{
            anchor: "win-rate",
            blurb:
              "% de apostas ganhas entre as liquidadas. Taxa de acerto alta não garante lucro — o que paga é o retorno.",
          }}
        />
        <RateCard label="jogos sem aposta" rate={view.passRate} hint={PASS_RATE_HINT} />
        <Card className="gap-2 p-5">
          <span className="flex items-center gap-1 text-meta uppercase tracking-label text-muted-foreground">
            lucro total
            <HelpHint
              anchor="lucro-total"
              label="lucro total"
              blurb="Soma de lucro/prejuízo acumulado em unidades das apostas já liquidadas, em dinheiro hipotético."
            />
          </span>
          <span
            className={cn(
              "text-display-md font-medium leading-none tracking-tight tabular-nums",
              view.profitPositive ? "text-edge-fg" : "text-destructive",
            )}
          >
            {view.totalProfit}
          </span>
          <span className="font-mono text-meta tabular-nums text-muted-foreground">
            {counts.settled} liquidada{counts.settled === 1 ? "" : "s"}
          </span>
        </Card>
      </div>
      <CountsLine counts={counts} />
    </div>
  );
}
