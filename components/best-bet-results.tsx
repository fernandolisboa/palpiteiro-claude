"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";

import { AnalysisResult } from "@/components/analysis-result";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BestBetEntry, BestBetView } from "@/lib/view/types";

export type BestBetSortMode = "edge" | "ev" | "edgeConf";

// Ordenação client-side das N análises (#178). PURA + exportada pra teste.
// Regras (§ranking): passes (sem aposta) afundam por ÚLTIMO em TODO modo; entre os
// não-pass o primário é a chave ativa (desc); o tiebreak é uma ORDEM TOTAL estável
// (EV/unidade desc, depois marketKey alfabético) pra o #1 não pular conforme o
// histórico do toggle. Só o EDGE é normalizado por impliedSumTarget (o edgePct vive na
// escala Σ=impliedSumTarget do mercado; ÷target o põe numa base Σ=1 por outcome coberto,
// cross-comparável — ADR 0018). A CONFIANÇA NÃO é normalizada: é a prob do modelo pra a
// seleção recomendada, já um [0,100] plano e diretamente comparável entre mercados
// (dividir por impliedSumTarget penalizaria dupla chance em DOBRO — impliedSumTarget²).
// EV/unidade já é overround-free e cross-comparável. Um não-pass com chave null cai
// entre os não-pass (acima dos passes), nunca afundado junto deles.
export function sortBestBetEntries(
  entries: BestBetEntry[],
  mode: BestBetSortMode,
): BestBetEntry[] {
  const primary = (e: BestBetEntry): number => {
    const r = e.rank;
    if (mode === "ev") return r.evPerUnit ?? Number.NEGATIVE_INFINITY;
    const edge = r.edgePct !== null ? r.edgePct / r.impliedSumTarget : null;
    if (edge === null) return Number.NEGATIVE_INFINITY;
    if (mode === "edge") return edge;
    return edge * r.confidencePct; // edgeConf: edge já normalizado × confiança plana
  };
  return [...entries].sort((a, b) => {
    if (a.rank.isPass !== b.rank.isPass) return a.rank.isPass ? 1 : -1;
    const pa = primary(a);
    const pb = primary(b);
    if (pb !== pa) return pb - pa;
    const ea = a.rank.evPerUnit ?? Number.NEGATIVE_INFINITY;
    const eb = b.rank.evPerUnit ?? Number.NEGATIVE_INFINITY;
    if (eb !== ea) return eb - ea;
    return a.marketKey.localeCompare(b.marketKey);
  });
}

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

      {best && <BestBetCard entry={best} highlighted />}
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
      <AnalysisResult view={entry.analysis} />
    </div>
  );
}
