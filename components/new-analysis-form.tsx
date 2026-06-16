"use client";

import { useActionState, useRef, useState } from "react";

import { analyzeMatch, type AnalyzeMatchResult } from "@/app/actions/predictions";
import { AnalysisErrorCard } from "@/components/analysis-error-card";
import { AnalyzeCTA } from "@/components/analyze-cta";
import { MarketSelect } from "@/components/market-select";
import { ModelOverrideSelect } from "@/components/model-override-select";
import {
  initialModelOverride,
  resyncModelOverride,
} from "@/lib/ai/model-override";
import { MODEL_REGISTRY, isAIModelId } from "@/lib/ai/models";

type Props = {
  matchId: string;
  // Mercados AINDA NÃO analisados (= selectableMarkets − mercados-com-seção). O painel só
  // monta este form quando há ≥1 — então a 1ª análise de cada mercado nasce aqui; a
  // REANÁLISE de um mercado já analisado vive no rodapé da seção dele (#244). >1 → seletor;
  // 1 → hidden. Single-select (fan-out multi-mercado é #245).
  unanalyzedMarkets: { key: string; label: string }[];
  selectableModels: { id: string; label: string }[];
  defaultModelLabel: string;
  preferredModelId: string | null;
  oddsAvailable: boolean;
};

// Dispatcher de NOVA análise (#244): a única afordância do TOPO. Cria a 1ª análise de um
// mercado sem seção ainda (cold-start do jogo + mercados novos no multi-mercado admin).
// Some sozinho quando todo mercado selecionável já tem seção (o painel não o monta).
export function NewAnalysisForm({
  matchId,
  unanalyzedMarkets,
  selectableModels,
  defaultModelLabel,
  preferredModelId,
  oddsAvailable,
}: Props) {
  const [state, formAction, pending] = useActionState<
    AnalyzeMatchResult | null,
    FormData
  >(analyzeMatch, null);

  // Override de modelo p/ a nova análise — semeado pela PREFERÊNCIA do usuário (cascata de
  // predict), com a persistência do #239 (resync na conclusão).
  const seededOverride = useRef(
    initialModelOverride(preferredModelId, selectableModels),
  );
  const [modelOverride, setModelOverride] = useState(seededOverride.current);
  const prevState = useRef(state);
  const actionCompleted = prevState.current !== state;
  prevState.current = state;
  const resynced = resyncModelOverride({
    displayed: modelOverride,
    live: seededOverride.current,
    actionCompleted,
  });
  if (resynced !== null) setModelOverride(resynced);
  const handleModelChange = (value: string) => {
    seededOverride.current = value;
    setModelOverride(value);
  };

  // Mercado a analisar: default = 1º não-analisado. ≤1 → seletor escondido, viaja no
  // hidden input (a action re-valida o gate).
  const [marketKey, setMarketKey] = useState(
    unanalyzedMarkets[0]?.key ?? "over_under",
  );
  // Se o mercado escolhido saiu da lista (acabou de ser analisado → ganhou seção e o
  // form re-renderiza sem ele), re-aponta pro 1º disponível — senão o próximo "Analisar"
  // miraria um mercado já analisado. Ajuste de state na fase de render (padrão React).
  if (
    unanalyzedMarkets.length > 0 &&
    !unanalyzedMarkets.some((m) => m.key === marketKey)
  ) {
    setMarketKey(unanalyzedMarkets[0].key);
  }

  const modelLabel =
    modelOverride !== "default" && isAIModelId(modelOverride)
      ? MODEL_REGISTRY[modelOverride].label
      : preferredModelId && isAIModelId(preferredModelId)
        ? MODEL_REGISTRY[preferredModelId].label
        : defaultModelLabel;

  const errorMsg = state && !state.ok ? state.error : null;
  const hasSelectableModels = selectableModels.length > 0;
  const hasMarketChoice = unanalyzedMarkets.length > 1;
  const hasControls = hasSelectableModels || hasMarketChoice;

  return (
    <form action={formAction} aria-busy={pending}>
      <input type="hidden" name="matchId" value={matchId} />
      {!hasMarketChoice && (
        <input type="hidden" name="marketKey" value={marketKey} />
      )}

      {hasControls && (
        <div className="flex flex-wrap items-end gap-3 pb-3">
          {hasMarketChoice && (
            <MarketSelect
              value={marketKey}
              onChange={setMarketKey}
              markets={unanalyzedMarkets}
            />
          )}
          {hasSelectableModels && (
            <ModelOverrideSelect
              value={modelOverride}
              onChange={handleModelChange}
              models={selectableModels}
              defaultModelLabel={defaultModelLabel}
            />
          )}
        </div>
      )}

      {pending ? (
        <AnalyzeCTA pending modelLabel={modelLabel} />
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
