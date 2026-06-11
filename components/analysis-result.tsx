import { RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
// MIN_EDGE_PP vem de lib/odds/scenario.ts, NUNCA de lib/ai/prompts/ — este
// componente é alcançável pelo client component AnalysisPanel ("use client");
// importar de lib/ai/prompts embarcaria o SYSTEM_PROMPT no bundle do cliente.
import { MIN_EDGE_PP } from "@/lib/odds/scenario";
import { cn } from "@/lib/utils";
import type { AnalysisView } from "@/lib/view/types";

type Props = {
  view: AnalysisView;
  again?: boolean;
};

export function AnalysisResult({ view, again = false }: Props) {
  if (view.kind === "PASS") {
    return (
      <div className="flex flex-col rounded-[10px] border border-dashed border-border-strong bg-card">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
            sem edge claro
          </span>
          <span className="font-mono text-[10px] text-muted-fg-2">
            {view.generatedAt}
          </span>
        </div>
        <Separator />
        <div className="flex items-start gap-4 px-4 py-4">
          <div className="flex flex-col items-start gap-1">
            <span className="font-mono text-[36px] font-medium tabular-nums leading-none tracking-tight text-muted-foreground">
              PASS
            </span>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
              não apostar
            </span>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-3 pt-1">
            <Stat label="confidence" value={view.confidence} muted />
            <Stat label="edge" value={`<${MIN_EDGE_PP}pp`} muted />
          </div>
        </div>
        <p className="px-4 pb-4 text-[12.5px] leading-relaxed tracking-tight text-muted-foreground">
          Sem aposta recomendada — nenhum dos lados tem vantagem mínima de{" "}
          {view.minEdgeLabel} sobre o mercado
        </p>
        <Separator />
        <div className="px-4 py-3">
          <p className="text-[12.5px] leading-relaxed text-foreground tracking-tight">
            {view.rationale}
          </p>
          <KeyFactors items={view.factors} />
        </div>
        <AnalysisFooter view={view} again={again} />
      </div>
    );
  }

  const isOver = view.kind === "OVER";
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-accent-fg">
          recomendação · gerada com claude
        </span>
        <span className="font-mono text-[10px] text-muted-fg-2">
          {view.generatedAt}
        </span>
      </div>
      <Separator />
      <div className="flex items-start gap-3 px-4 py-4">
        <div className="flex flex-col items-start gap-1">
          <span className="flex items-baseline gap-1 font-mono text-[36px] font-medium tabular-nums leading-none tracking-tight text-accent-strong-fg">
            <span>{view.kind}</span>
            <span className="-translate-y-1 text-[22px]">{isOver ? "↑" : "↓"}</span>
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-accent-fg">
            2.5 gols
          </span>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-3 pt-1">
          <Stat label="confidence" value={view.confidence} />
          <Stat label="edge" value={view.edge ? `${view.edge}pp` : "—"} edge />
        </div>
      </div>
      {view.betSummary && (
        <div className="mx-4 mb-4 flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            aposta recomendada
          </span>
          <p className="text-[13px] font-medium leading-snug tracking-tight text-foreground">
            {view.betSummary.market} — {view.betSummary.plain}
          </p>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
              odd na análise{view.oddAtRecAgo ? ` (${view.oddAtRecAgo})` : ""}
            </span>
            <span className="font-mono text-[13px] font-medium tabular-nums tracking-tight text-foreground">
              {view.oddAtRec}
              {view.bookmaker ? ` · ${view.bookmaker}` : ""}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                retorno esperado
              </span>
              <span
                className={cn(
                  "font-mono text-[13px] font-medium tabular-nums tracking-tight",
                  // text-edge-fg é reservado: só no retorno positivo da
                  // recomendação (tone "positive" do view-mapper).
                  view.expectedReturnTone === "positive"
                    ? "text-edge-fg"
                    : "text-foreground",
                )}
              >
                {view.expectedReturn}
              </span>
            </div>
            {view.evLegend && (
              <p className="text-[11px] leading-snug tracking-tight text-muted-fg-2">
                {view.evLegend}
              </p>
            )}
          </div>
          {view.minOdd && (
            <div className="flex items-baseline justify-between gap-2 border-t border-border-subtle pt-2">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                vale a pena se odd ≥
              </span>
              <span className="font-mono text-[15px] font-medium tabular-nums tracking-tight">
                {view.minOdd}
              </span>
            </div>
          )}
        </div>
      )}
      <Separator />
      <div className="px-4 py-3.5">
        <p className="text-[12.5px] leading-relaxed text-foreground tracking-tight">
          {view.rationale}
        </p>
        <KeyFactors items={view.factors} />
      </div>
      <AnalysisFooter view={view} again={again} />
    </Card>
  );
}

type StatProps = {
  label: string;
  value: string;
  edge?: boolean;
  muted?: boolean;
};

function Stat({ label, value, edge = false, muted = false }: StatProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-[18px] font-medium tabular-nums tracking-tight",
          muted ? "text-muted-foreground" : edge ? "text-edge-fg" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function KeyFactors({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2 pt-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        fatores-chave
      </span>
      {items.map((f, i) => (
        <li
          key={i}
          className="flex items-start gap-2 text-[12.5px] text-foreground tracking-tight"
        >
          <span className="pt-2 text-muted-fg-2">
            <span className="block size-1.5 rounded-full bg-current" />
          </span>
          <span className="flex-1">{f}</span>
        </li>
      ))}
    </ul>
  );
}

type FooterProps = {
  view: AnalysisView;
  again: boolean;
};

function AnalysisFooter({ view, again }: FooterProps) {
  return (
    <>
      <Separator />
      <div className="flex items-center justify-between px-4 py-2.5 font-mono text-[10px] text-muted-fg-2 tabular-nums">
        <span>
          {view.promptVersion} · {view.model}
        </span>
        <span>{view.costUsd}</span>
      </div>
      {again && (
        <>
          <Separator />
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="font-mono text-[10.5px] text-muted-foreground">
              gerado em {view.generatedAt}
            </span>
            <Button type="submit" size="sm" variant="ghost" className="h-7 px-2">
              <RefreshCcw className="size-3.5" /> Analisar novamente
            </Button>
          </div>
        </>
      )}
    </>
  );
}
