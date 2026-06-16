import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type Props = {
  pending: boolean;
  // Modelo que a análise vai REALMENTE usar (override do admin ou default
  // global), resolvido pelo AnalysisPanel. Mantém o passo "gerando análise (…)"
  // honesto — antes era um literal stale fixo em claude-sonnet-4.5, alheio à
  // seleção. Opcional: no estado não-pending nenhum passo é renderizado.
  modelLabel?: string;
  // Nº de mercados no disparo multi-mercado (#245). >1 → copy agregada
  // ("Analisando N mercados…", fan-out serial). undefined/≤1 → copy single
  // BYTE-IDÊNTICA à de hoje (paridade do over/under sozinho, AC4).
  marketCount?: number;
  // Desabilita o botão de submit (#245: nenhum mercado marcado). undefined →
  // sem atributo disabled (markup idêntico ao de hoje).
  disabled?: boolean;
};

function buildSteps(modelLabel?: string) {
  return [
    { label: "coletando contexto do jogo", status: "done" as const },
    { label: "normalizando odds + overround", status: "done" as const },
    {
      label: modelLabel ? `gerando análise (${modelLabel})` : "gerando análise",
      status: "active" as const,
    },
    { label: "validando schema + persistindo", status: "pending" as const },
  ];
}

export function AnalyzeCTA({
  pending,
  modelLabel,
  marketCount,
  disabled,
}: Props) {
  if (pending) {
    const steps = buildSteps(modelLabel);
    const multi = typeof marketCount === "number" && marketCount > 1;
    return (
      <Card className="gap-0 p-0">
        <div className="flex items-center gap-3 px-4 py-4">
          <span className="text-accent-fg">
            <Loader2 className="size-4 animate-spin" />
          </span>
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-[13px] font-medium tracking-tight">
              {multi ? `Analisando ${marketCount} mercados…` : "Analisando jogo…"}
            </span>
            <span className="text-[11.5px] text-muted-foreground tracking-tight">
              {multi
                ? "Claude analisa cada mercado em sequência. Cerca de 8–12s por mercado."
                : "Claude está revisando forma, H2H, lesões e odds. Cerca de 8–12s."}
            </span>
          </div>
        </div>
        <Separator />
        <div className="flex flex-col gap-2 px-4 py-3">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2 font-mono text-[10.5px]">
              <span
                className={cn(
                  s.status === "done" && "text-muted-foreground",
                  s.status === "active" && "text-accent-fg",
                  s.status === "pending" && "text-muted-fg-2",
                )}
              >
                {s.status === "done" ? "✓" : s.status === "active" ? "▸" : "·"}
              </span>
              <span
                className={cn(
                  s.status === "done" && "text-muted-foreground",
                  s.status === "active" && "text-foreground",
                  s.status === "pending" && "text-muted-fg-2",
                )}
              >
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Button
      type="submit"
      size="lg"
      disabled={disabled}
      className="h-12 w-full text-[14px]"
    >
      <Sparkles className="size-4" /> Analisar com IA
    </Button>
  );
}
