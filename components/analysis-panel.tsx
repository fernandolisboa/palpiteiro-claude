"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { analyzeMatch, type AnalyzeMatchResult } from "@/app/actions/predictions";
import { AnalysisErrorCard } from "@/components/analysis-error-card";
import { AnalysisResult } from "@/components/analysis-result";
import { AnalyzeCTA } from "@/components/analyze-cta";
import type { AnalysisView } from "@/lib/view/types";

type Props = {
  matchId: string;
  existing: AnalysisView | null;
  oddsAvailable: boolean;
};

export function AnalysisPanel({ matchId, existing, oddsAvailable }: Props) {
  const initial: AnalyzeMatchResult | null = existing
    ? { ok: true, view: existing }
    : null;
  const [state, formAction, pending] = useActionState(analyzeMatch, initial);

  const view = state?.ok ? state.view : existing;
  const errorMsg = state && !state.ok ? state.error : null;

  return (
    <form action={formAction} aria-busy={pending}>
      <input type="hidden" name="matchId" value={matchId} />

      {pending && view ? (
        <div className="relative">
          <div className="pointer-events-none opacity-40">
            <AnalysisResult view={view} again />
          </div>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 shadow">
              <Loader2 className="size-4 animate-spin text-accent-fg" />
              <span className="text-[12.5px] font-medium tracking-tight">
                Reanalisando…
              </span>
            </div>
          </div>
        </div>
      ) : pending ? (
        <AnalyzeCTA pending />
      ) : view ? (
        <AnalysisResult view={view} again />
      ) : errorMsg ? (
        <AnalysisErrorCard error={errorMsg} />
      ) : oddsAvailable ? (
        <AnalyzeCTA pending={false} />
      ) : (
        <NoOddsHint />
      )}
    </form>
  );
}

function NoOddsHint() {
  return (
    <div className="rounded-md border border-dashed border-border px-4 py-3 text-[11.5px] text-muted-foreground tracking-tight">
      Análise indisponível enquanto não houver odds publicadas para este jogo.
    </div>
  );
}
