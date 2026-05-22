import { RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  getAnalysisForKind,
  type AnalysisKind,
} from "@/lib/fixtures";

type Props = {
  kind: AnalysisKind;
  again?: boolean;
};

export function AnalysisResult({ kind, again = false }: Props) {
  const a = getAnalysisForKind(kind);

  if (kind === "PASS") {
    return (
      <div className="flex flex-col rounded-[10px] border border-dashed border-border-strong bg-card">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
            sem edge claro
          </span>
          <span className="font-mono text-[10px] text-muted-fg-2">
            {a.generatedAt}
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
            <Stat label="confidence" value={a.confidence} muted />
            <Stat label="edge" value="<5pp" muted />
          </div>
        </div>
        <Separator />
        <div className="px-4 py-3">
          <p className="text-[12.5px] leading-relaxed text-foreground tracking-tight">
            {a.rationale}
          </p>
          <KeyFactors items={a.factors} />
        </div>
        <AnalysisFooter analysis={a} again={again} />
      </div>
    );
  }

  const isOver = kind === "OVER";
  return (
    <Card className="gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-accent-fg">
          recomendação · gerada com claude
        </span>
        <span className="font-mono text-[10px] text-muted-fg-2">
          {a.generatedAt}
        </span>
      </div>
      <Separator />
      <div className="flex items-start gap-3 px-4 py-4">
        <div className="flex flex-col items-start gap-1">
          <span className="flex items-baseline gap-1 font-mono text-[36px] font-medium tabular-nums leading-none tracking-tight text-accent-strong-fg">
            <span>{kind}</span>
            <span className="-translate-y-1 text-[22px]">{isOver ? "↑" : "↓"}</span>
          </span>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-accent-fg">
            2.5 gols
          </span>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-3 pt-1">
          <Stat label="confidence" value={a.confidence} />
          <Stat label="edge" value={`${a.edge}pp`} edge />
        </div>
      </div>
      <div className="mx-4 mb-4 flex items-center justify-between rounded-md border border-border-subtle bg-surface-2 px-3 py-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
          aposta se odd ≥
        </span>
        <span className="font-mono text-[15px] font-medium tabular-nums tracking-tight">
          {a.minOdd}
        </span>
      </div>
      <Separator />
      <div className="px-4 py-3.5">
        <p className="text-[12.5px] leading-relaxed text-foreground tracking-tight">
          {a.rationale}
        </p>
        <KeyFactors items={a.factors} />
      </div>
      <AnalysisFooter analysis={a} again={again} />
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
  analysis: ReturnType<typeof getAnalysisForKind>;
  again: boolean;
};

function AnalysisFooter({ analysis, again }: FooterProps) {
  return (
    <>
      <Separator />
      <div className="flex items-center justify-between px-4 py-2.5 font-mono text-[10px] text-muted-fg-2 tabular-nums">
        <span>
          {analysis.promptVersion} · {analysis.model}
        </span>
        <span>{analysis.costUsd}</span>
      </div>
      {again && (
        <>
          <Separator />
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="font-mono text-[10.5px] text-muted-foreground">
              gerado há 4h
            </span>
            <Button size="sm" variant="ghost" className="h-7 px-2">
              <RefreshCcw className="size-3.5" /> Analisar novamente
            </Button>
          </div>
        </>
      )}
    </>
  );
}
