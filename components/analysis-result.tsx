import { RefreshCcw } from "lucide-react";

import { AnalysisScenarios } from "@/components/analysis-scenarios";
import { HelpHint } from "@/components/help-hint";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { AnalysisView } from "@/lib/view/types";

type Props = {
  view: AnalysisView;
  again?: boolean;
};

export function AnalysisResult({ view, again = false }: Props) {
  // pass = sem recomendação (recommendation null) — data-driven, não mais via kind.
  if (view.recommendation === null) {
    return (
      <div className="flex flex-col rounded-[10px] border border-dashed border-border-strong bg-card">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <span className="flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
            sem edge claro
            <HelpHint
              anchor="recomendacao"
              label="PASS — sem edge claro"
              blurb="PASS = sem edge claro = não apostar; isso é disciplina, não erro. Pass rate alto (30–60%) é bom."
            />
          </span>
          <span className="font-mono text-[10px] text-muted-fg-2">
            {view.generatedAt}
          </span>
        </div>
        <Separator />
        {/* O grid de stats confidence/edge saiu do card (ADR 0012): os números
            vivem no bloco de cenários com o label unificado "prob. do modelo"
            — "confidence" exibia P(over) em pass sem dizer isso. */}
        <div className="flex items-start gap-4 px-4 py-4">
          <div className="flex flex-col items-start gap-1">
            <span className="font-mono text-[36px] font-medium tabular-nums leading-none tracking-tight text-muted-foreground">
              PASS
            </span>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
              não apostar
            </span>
          </div>
        </div>
        <p className="px-4 pb-4 text-[12.5px] leading-relaxed tracking-tight text-muted-foreground">
          Sem aposta recomendada — nenhum dos lados tem vantagem mínima de{" "}
          {view.minEdgeLabel} sobre o mercado
        </p>
        {view.outcomes.length > 0 && (
          <AnalysisScenarios
            outcomes={view.outcomes}
            framing={view.framing}
            note={view.note}
            returnTone={view.expectedReturnTone}
          />
        )}
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

  const rec = view.recommendation;
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
      {/* O grid de stats confidence/edge saiu da row (ADR 0012): os mesmos
          números (valores salvos da row) vivem na coluna recomendada do bloco
          de cenários, com labels unificados "prob. do modelo"/"edge". O destaque
          é o outcome label completo (mercado + seleção + linha já resolvido pela
          view) — sem setas nem "2.5" hardcoded (data-driven, AC3). */}
      <div className="flex items-start gap-3 px-4 py-4">
        <div className="flex flex-col items-start gap-1">
          <span className="font-mono text-[28px] font-medium leading-none tracking-tight text-accent-strong-fg">
            {rec.selectionLabel}
            {rec.line !== null ? ` ${rec.line}` : ""}
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-accent-fg">
            {rec.marketLabel}
          </span>
        </div>
      </div>
      {rec && (
        <div className="mx-4 mb-4 flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
            aposta recomendada
          </span>
          {/* Frase estruturada data-driven (AC3): mercado + seleção + linha,
              todos resolvidos pela view a partir do registry. Sem string de
              mercado hardcoded no componente. */}
          <p className="text-[13px] font-medium leading-snug tracking-tight text-foreground">
            {rec.marketLabel} · {rec.selectionLabel}
            {rec.line !== null ? ` ${rec.line}` : ""}
          </p>
          {view.stakeUnits && (
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                stake
              </span>
              <span className="font-mono text-[13px] font-medium tabular-nums tracking-tight text-foreground">
                {view.stakeUnits}
              </span>
            </div>
          )}
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
              <span className="flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
                vale a pena se odd ≥
                <HelpHint
                  anchor="odd-minima"
                  label="odd mínima"
                  blurb="A menor odd em que a aposta ainda mantém vantagem mínima — definida pela IA. Abaixo dela, a vantagem some."
                />
              </span>
              <span className="font-mono text-[15px] font-medium tabular-nums tracking-tight">
                {view.minOdd}
              </span>
            </div>
          )}
        </div>
      )}
      {view.outcomes.length > 0 && (
        <AnalysisScenarios
          outcomes={view.outcomes}
          framing={view.framing}
          note={view.note}
          returnTone={view.expectedReturnTone}
        />
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
