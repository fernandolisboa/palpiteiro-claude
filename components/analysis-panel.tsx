"use client";

import { useActionState, useState } from "react";
import { Loader2 } from "lucide-react";

import { analyzeMatch, type AnalyzeMatchResult } from "@/app/actions/predictions";
import { AnalysisErrorCard } from "@/components/analysis-error-card";
import { AnalysisResult } from "@/components/analysis-result";
import { AnalyzeCTA } from "@/components/analyze-cta";
import { ModelOverrideSelect } from "@/components/model-override-select";
import { MODEL_REGISTRY, isAIModelId } from "@/lib/ai/models";
import type { AnalysisView } from "@/lib/view/types";

type Props = {
  matchId: string;
  existing: AnalysisView | null;
  oddsAvailable: boolean;
  isAdmin: boolean;
  // Label do default global, resolvido no server. Usado quando não há override
  // (usuário comum, ou admin em "Usar padrão global") pra rotular o progresso.
  defaultModelLabel: string;
};

export function AnalysisPanel({
  matchId,
  existing,
  oddsAvailable,
  isAdmin,
  defaultModelLabel,
}: Props) {
  const initial: AnalyzeMatchResult | null = existing
    ? { ok: true, view: existing }
    : null;
  const [state, formAction, pending] = useActionState(analyzeMatch, initial);
  const [modelOverride, setModelOverride] = useState("default");

  // Modelo que a análise vai REALMENTE usar — espelha a resolução da action
  // analyzeMatch: override do admin quando selecionado e válido, senão o default
  // global. Alimenta o passo "gerando análise (…)" do AnalyzeCTA.
  const modelLabel =
    isAdmin && modelOverride !== "default" && isAIModelId(modelOverride)
      ? MODEL_REGISTRY[modelOverride].label
      : defaultModelLabel;

  const view = state?.ok ? state.view : existing;
  const errorMsg = state && !state.ok ? state.error : null;

  return (
    <form action={formAction} aria-busy={pending}>
      <input type="hidden" name="matchId" value={matchId} />
      {/* Override por análise: só admin. Sem este select, a action não vê
          modelOverride e usa o default global — comportamento do user comum. */}
      {isAdmin && (
        <ModelOverrideSelect
          value={modelOverride}
          onChange={setModelOverride}
        />
      )}

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
        <AnalyzeCTA pending modelLabel={modelLabel} />
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
