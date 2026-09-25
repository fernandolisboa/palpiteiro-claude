"use client";

import { useState } from "react";
import { Info, Sparkles } from "lucide-react";

import { AnalysisResult } from "@/components/analysis-result";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ANALYSIS_RISK_DISCLAIMER } from "@/lib/view/analysis";
import {
  sortBestBetEntries,
  type BestBetSortMode,
} from "@/lib/view/best-bet-sort";
import type { BestBetEntry, BestBetView } from "@/lib/view/types";

// Ordenação movida pra lib/view/best-bet-sort.ts (pura; o best bet code_jev a usa
// no servidor pra escolher o mercado narrado, #512). Re-exportada aqui.
export { sortBestBetEntries, type BestBetSortMode };

const SORT_MODES: { mode: BestBetSortMode; label: string }[] = [
  { mode: "edge", label: "Edge" },
  { mode: "ev", label: "EV" },
  { mode: "edgeConf", label: "Edge × confiança" },
];

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function BestBetResults({ view }: { view: BestBetView }) {
  const [mode, setMode] = useState<BestBetSortMode>("edge");
  const sorted = sortBestBetEntries(view.entries, mode);
  const [best, ...rest] = sorted;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-body-sm tracking-tight text-muted-foreground">
          {view.llmCalls}{" "}
          {plural(view.llmCalls, "análise gerada", "análises geradas")}
          {view.unavailableMarkets > 0
            ? ` · ${view.unavailableMarkets} ${plural(
                view.unavailableMarkets,
                "mercado indisponível",
                "mercados indisponíveis",
              )}`
            : ""}
        </span>
        <div className="flex gap-1" role="group" aria-label="Ordenar por">
          {SORT_MODES.map(({ mode: m, label }) => (
            <Button
              key={m}
              type="button"
              size="xs"
              variant={mode === m ? "default" : "outline"}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Não cravar "Melhor aposta" quando o topo é pass: com o gate de edge (ADR
          0038) um jogo inteiro pode não ter aposta acima do piso — a resposta honesta
          é "nenhuma", não badgear um pass como a melhor. */}
      {best && <BestBetCard entry={best} highlighted={!best.rank.isPass} />}
      {rest.map((entry) => (
        <BestBetCard key={entry.marketKey} entry={entry} />
      ))}

      {view.errors.length > 0 && (
        <div className="flex flex-col gap-1 rounded-md border border-dashed border-border px-3 py-2">
          <span className="text-eyebrow font-mono uppercase tracking-label text-muted-foreground">
            Mercados indisponíveis
          </span>
          {view.errors.map((err) => (
            <span
              key={err.marketKey}
              className="text-body-sm tracking-tight text-muted-foreground"
            >
              {err.marketLabel}: {err.message}
            </span>
          ))}
        </div>
      )}

      {/* Aviso de risco (#434): UMA linha muda pro fan-out inteiro (os cards passam
          showRiskDisclaimer={false} pra não repetir por card). Superfície SÓBRIA —
          fora do firewall de valor da manchete. */}
      <p className="flex items-center gap-1.5 px-0.5 text-meta leading-snug tracking-tight text-muted-fg-2">
        <Info className="size-3 shrink-0" aria-hidden="true" />
        {ANALYSIS_RISK_DISCLAIMER}
      </p>
    </div>
  );
}

// marketLabel é renderizado ACIMA de TODO card (inclusive pass) — load-bearing: o
// branch de pass do AnalysisResult não imprime label de mercado, então sem isto um
// pass cross-mercado ficaria sem identificação.
function BestBetCard({
  entry,
  highlighted = false,
}: {
  entry: BestBetEntry;
  highlighted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        highlighted && "rounded-lg p-0.5 ring-2 ring-accent-fg/40",
      )}
    >
      <div className="flex items-center gap-2 px-0.5">
        {highlighted && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-fg/10 px-2 py-0.5 font-mono text-eyebrow-xs uppercase tracking-label text-accent-fg">
            <Sparkles className="size-3" /> Melhor aposta
          </span>
        )}
        <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
          {entry.marketLabel}
        </span>
      </div>
      {/* showRiskDisclaimer={false}: o aviso de risco sai UMA vez no fim do painel
          (BestBetResults), não uma vez por card do fan-out. */}
      <AnalysisResult view={entry.analysis} showRiskDisclaimer={false} />
    </div>
  );
}
