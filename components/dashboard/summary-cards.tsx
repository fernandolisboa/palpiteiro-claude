import { HelpHint } from "@/components/help-hint";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DashboardKpiView, SignTone } from "@/lib/view/dashboard";

// Resumo do topo do Desempenho (#577): retorno, taxa de acerto e saldo, sem `n=`.
// A amostra aparece UMA vez, sob os cartões (os três números contam as mesmas
// apostas liquidadas). Histórico privado e verificável, com a frase dos Termos §4
// (ADR 0048 D4: "passado não garante futuro").
export const PAST_PERFORMANCE_NOTE = "Desempenho passado não garante desempenho futuro.";

const TONE_CLASS: Record<SignTone, string> = {
  positive: "text-edge-fg",
  negative: "text-destructive",
  zero: "text-foreground",
};

function SummaryCard({
  label,
  value,
  valueClassName,
  hint,
}: {
  label: string;
  value: string;
  valueClassName: string;
  hint: { anchor: string; blurb: string };
}) {
  return (
    <Card className="gap-2 p-5">
      <span className="flex items-center gap-1 text-meta uppercase tracking-label text-muted-foreground">
        {label}
        <HelpHint anchor={hint.anchor} label={label} blurb={hint.blurb} />
      </span>
      <span
        className={cn(
          "whitespace-nowrap text-display-md font-medium leading-none tracking-tight tabular-nums",
          valueClassName,
        )}
      >
        {value}
      </span>
    </Card>
  );
}

export function SummaryCards({ view }: { view: DashboardKpiView }) {
  const settled = view.yieldPct.n;
  const empty = view.yieldPct.value === "—";
  // Sem aposta liquidada o saldo não existe ainda: "—" neutro, como o retorno.
  const noSettled = settled === 0;
  return (
    <section aria-label="Resumo" className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard
          label="retorno"
          value={view.yieldSigned}
          valueClassName={empty ? "text-muted-foreground" : TONE_CLASS[view.yieldTone]}
          hint={{
            anchor: "yield",
            blurb:
              "Lucro ÷ total apostado × 100. Conta só apostas liquidadas (exclui jogos sem aposta e anuladas). Mede eficiência, não tamanho.",
          }}
        />
        <SummaryCard
          label="taxa de acerto"
          value={view.winRate.value}
          valueClassName={view.winRate.value === "—" ? "text-muted-foreground" : "text-foreground"}
          hint={{
            anchor: "win-rate",
            blurb:
              "% de apostas ganhas entre as liquidadas. Taxa de acerto alta não garante lucro — o que paga é o retorno.",
          }}
        />
        <SummaryCard
          label="saldo"
          value={noSettled ? "—" : view.totalProfit}
          valueClassName={noSettled ? "text-muted-foreground" : TONE_CLASS[view.profitTone]}
          hint={{
            anchor: "lucro-total",
            blurb:
              "Soma de lucro/prejuízo acumulado em unidades das apostas já liquidadas, em dinheiro hipotético.",
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        {!noSettled && (
          <p className="flex flex-wrap items-center gap-x-1 text-body-sm tracking-tight text-muted-foreground">
            <span className="tabular-nums">
              em {settled} {settled === 1 ? "aposta liquidada" : "apostas liquidadas"}
            </span>
            {view.yieldPct.lowSample && (
              <span className="inline-flex items-center gap-1 text-warn-fg">
                · amostra pequena
                <HelpHint
                  anchor="amostra-pequena"
                  label="amostra pequena"
                  blurb="Menos de 20 apostas liquidadas. Com tão poucas, os números são ruído de sorte, não habilidade — não conclua cedo demais."
                />
              </span>
            )}
          </p>
        )}
        <p className="text-meta text-muted-foreground">{PAST_PERFORMANCE_NOTE}</p>
      </div>
    </section>
  );
}
