"use client";

import { useActionState, useState } from "react";
import { Loader2, RefreshCcw } from "lucide-react";

import { analyzeMatch, type AnalyzeMatchResult } from "@/app/actions/predictions";
import { AnalysisErrorCard } from "@/components/analysis-error-card";
import { AnalysisResult } from "@/components/analysis-result";
import { AnalyzeCTA } from "@/components/analyze-cta";
import { ModelOverrideSelect } from "@/components/model-override-select";
import { Button } from "@/components/ui/button";
import { MODEL_REGISTRY, isAIModelId } from "@/lib/ai/models";
import type { AnalysisView } from "@/lib/view/types";

type Props = {
  matchId: string;
  existing: AnalysisView | null;
  oddsAvailable: boolean;
  // Modelos que esta audiência pode escolher como override ({id,label}
  // serializável, resolvido no server). Vazio → seletor escondido. A garantia
  // de gating é server-side em analyzeMatch.
  selectableModels: { id: string; label: string }[];
  // Label do default global, resolvido no server. Usado quando não há override
  // nem preferência (ou "Usar padrão global") pra rotular o progresso.
  defaultModelLabel: string;
  // Preferência pessoal do usuário (id cru, validado contra audiência no
  // server) ou null. Espelha a cascata de predict: sem override, é o modelo que
  // vai REALMENTE rodar — então rotula o passo "gerando análise (…)".
  preferredModelId: string | null;
};

export function AnalysisPanel({
  matchId,
  existing,
  oddsAvailable,
  selectableModels,
  defaultModelLabel,
  preferredModelId,
}: Props) {
  const initial: AnalyzeMatchResult | null = existing
    ? { ok: true, view: existing }
    : null;
  const [state, formAction, pending] = useActionState(analyzeMatch, initial);
  const [modelOverride, setModelOverride] = useState("default");

  // Modelo que a análise vai REALMENTE usar — espelha a cascata de predict:
  // override por análise > preferência do usuário > default global. Alimenta o
  // passo "gerando análise (…)" do AnalyzeCTA.
  const modelLabel =
    modelOverride !== "default" && isAIModelId(modelOverride)
      ? MODEL_REGISTRY[modelOverride].label
      : preferredModelId && isAIModelId(preferredModelId)
        ? MODEL_REGISTRY[preferredModelId].label
        : defaultModelLabel;

  const view = state?.ok ? state.view : existing;
  const errorMsg = state && !state.ok ? state.error : null;

  const hasSelectableModels = selectableModels.length > 0;

  // Override por análise, limitado à audiência (lista vinda do server). Sem
  // modelos selecionáveis o select some e a action usa o default global.
  const modelSelect = hasSelectableModels ? (
    <ModelOverrideSelect
      value={modelOverride}
      onChange={setModelOverride}
      models={selectableModels}
      defaultModelLabel={defaultModelLabel}
    />
  ) : null;

  return (
    <form action={formAction} aria-busy={pending}>
      <input type="hidden" name="matchId" value={matchId} />

      {/* Quando já existe predição e há modelos selecionáveis, a re-análise vem
          do botão ao lado do dropdown (afordância ÚNICA) — por isso o
          AnalysisResult abaixo NÃO recebe `again`, pra não duplicar o botão.
          Na primeira análise (sem view) o dropdown aparece sozinho acima da CTA. */}
      {view && hasSelectableModels ? (
        <div className="flex flex-wrap items-end gap-3 pb-3">
          {modelSelect}
          <Button type="submit" size="sm" disabled={pending}>
            <RefreshCcw className="size-3.5" />
            {pending ? "Reanalisando…" : "Analisar de novo"}
          </Button>
        </div>
      ) : (
        !view && modelSelect && <div className="pb-3">{modelSelect}</div>
      )}

      {pending && view ? (
        <div className="relative">
          <div className="pointer-events-none opacity-40">
            <AnalysisResult view={view} again={!hasSelectableModels} />
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
        <AnalysisResult view={view} again={!hasSelectableModels} />
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
