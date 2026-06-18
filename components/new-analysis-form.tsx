"use client";

import { useActionState, useRef, useState } from "react";

import {
  analyzeMarkets,
  type AnalyzeMarketsResult,
  type MarketRunSummaryItem,
} from "@/app/actions/predictions";
import { AnalysisErrorCard } from "@/components/analysis-error-card";
import { AnalyzeCTA } from "@/components/analyze-cta";
import { MarketMultiSelect } from "@/components/market-multi-select";
import { MarketRunSummary } from "@/components/market-run-summary";
import { ModelOverrideSelect } from "@/components/model-override-select";
import {
  initialModelOverride,
  resyncModelOverride,
} from "@/lib/ai/model-override";
import { MODEL_REGISTRY, isAIModelId } from "@/lib/ai/models";

type Props = {
  matchId: string;
  // Mercados AINDA NÃO analisados (= selectableMarkets − mercados-com-seção). O painel só monta
  // este form quando há ≥1 — então a 1ª análise de cada mercado nasce aqui; a REANÁLISE de um
  // mercado já analisado vive no rodapé da seção dele (#244). >1 → MULTI-select (#245); 1 →
  // hidden (degenera p/ o single de hoje, paridade AC4).
  unanalyzedMarkets: { key: string; label: string }[];
  selectableModels: { id: string; label: string }[];
  defaultModelLabel: string;
  preferredModelId: string | null;
  oddsAvailable: boolean;
};

// Default da seleção: over_under marcado se estiver entre os não-analisados; senão o 1º.
function defaultSelection(
  markets: { key: string; label: string }[],
): string | null {
  if (markets.length === 0) return null;
  return markets.some((m) => m.key === "over_under")
    ? "over_under"
    : markets[0].key;
}

// Roteia o resultado da action pro feedback inline (puro/testável — o render estático sempre vê
// state=null, então a paridade AC4 é pinada AQUI). O form descarta o agregado; sucessos viram
// seções via revalidate.
//  - rejeição total (ok:false) → errorMsg (AnalysisErrorCard, idêntico a hoje).
//  - falha SINGLE (1 sumário não-ok) → errorMsg ⇒ MESMA via AnalysisErrorCard ("Falha na análise"
//    + "Tentar novamente") pra um over/under sozinho que falha ficar byte-for-byte como o
//    analyzeMatch atual (AC4). Single rate-limited já cai em ok:false (granted vazio).
//  - multi (>1 sumário) com ≥1 falha → runSummary (MarketRunSummary). Multi all-ok → nada (as
//    seções são a confirmação).
export function deriveNewAnalysisFeedback(state: AnalyzeMarketsResult | null): {
  errorMsg: string | null;
  runSummary: MarketRunSummaryItem[] | null;
} {
  if (!state) return { errorMsg: null, runSummary: null };
  if (!state.ok) return { errorMsg: state.error, runSummary: null };
  if (state.summaries.length === 1 && state.summaries[0].status !== "ok") {
    return {
      errorMsg:
        state.summaries[0].message ??
        "Falha temporária ao gerar análise. Tente novamente.",
      runSummary: null,
    };
  }
  if (state.summaries.length > 1 && state.summaries.some((s) => s.status !== "ok")) {
    return { errorMsg: null, runSummary: state.summaries };
  }
  return { errorMsg: null, runSummary: null };
}

// Dispatcher de NOVA análise (#244 → #245 multi-mercado): a única afordância do TOPO. Cria a 1ª
// análise de UM OU MAIS mercados sem seção ainda. Some sozinho quando todo mercado selecionável
// já tem seção (o painel não o monta). Os resultados aterrissam como SEÇÕES via revalidate
// (toMarketAnalysisSections) — o form descarta o agregado e só mostra falhas parciais.
export function NewAnalysisForm({
  matchId,
  unanalyzedMarkets,
  selectableModels,
  defaultModelLabel,
  preferredModelId,
  oddsAvailable,
}: Props) {
  const [state, formAction, pending] = useActionState<
    AnalyzeMarketsResult | null,
    FormData
  >(analyzeMarkets, null);

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

  // Mercados marcados (multi-select #245). Semente = default (over_under se presente). A
  // submissão viaja por hidden inputs name="marketKeys" → analyzeMarkets faz getAll + re-valida.
  const [selected, setSelected] = useState<Set<string>>(() => {
    const seed = defaultSelection(unanalyzedMarkets);
    return new Set(seed ? [seed] : []);
  });
  // Re-sync na fase de render (padrão React) COM guard de mudança de membership: SÓ poda as keys
  // que saíram de unanalyzedMarkets (um mercado recém-analisado ganhou seção e o form re-renderiza
  // sem ele) — NÃO re-semeia. O default inicial vem do useState acima; deixar a seleção esvaziar é
  // intencional (multi-select pode ficar vazio → o CTA desabilita e a action rejeita "nenhum
  // mercado válido"). Re-semear aqui (a) tornaria `disabled` dead code e (b) impediria o usuário de
  // limpar a seleção (springs back). Set é igualdade por referência → um setSelected INCONDICIONAL
  // loopa pra sempre; só re-setamos quando a membership de fato mudou. Renderiza a partir de
  // `effective` (a versão podada) pra não submeter uma key stale por um frame.
  const present = new Set(unanalyzedMarkets.map((m) => m.key));
  const effective = new Set([...selected].filter((k) => present.has(k)));
  const membershipChanged =
    effective.size !== selected.size ||
    [...selected].some((k) => !effective.has(k));
  if (membershipChanged) setSelected(effective);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectedKeys = [...effective];

  const modelLabel =
    modelOverride !== "default" && isAIModelId(modelOverride)
      ? MODEL_REGISTRY[modelOverride].label
      : preferredModelId && isAIModelId(preferredModelId)
        ? MODEL_REGISTRY[preferredModelId].label
        : defaultModelLabel;

  // Roteamento do feedback (puro/testável — ver deriveNewAnalysisFeedback). O CTA persiste pros
  // mercados que sobraram em unanalyzedMarkets quando há falha parcial.
  const { errorMsg, runSummary } = deriveNewAnalysisFeedback(state);

  const hasSelectableModels = selectableModels.length > 0;
  const hasMarketChoice = unanalyzedMarkets.length > 1;
  const hasControls = hasSelectableModels || hasMarketChoice;

  return (
    <form action={formAction} aria-busy={pending}>
      <input type="hidden" name="matchId" value={matchId} />
      {selectedKeys.map((key) => (
        <input key={key} type="hidden" name="marketKeys" value={key} />
      ))}

      {hasControls && (
        <div className="flex flex-wrap items-end gap-3 pb-3">
          {hasMarketChoice && (
            <MarketMultiSelect
              markets={unanalyzedMarkets}
              value={effective}
              onToggle={toggle}
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

      {runSummary && (
        <div className="pb-3">
          <MarketRunSummary items={runSummary} />
        </div>
      )}

      {pending ? (
        <AnalyzeCTA pending marketCount={effective.size} modelLabel={modelLabel} />
      ) : errorMsg ? (
        <AnalysisErrorCard error={errorMsg} />
      ) : oddsAvailable ? (
        <AnalyzeCTA pending={false} disabled={effective.size === 0} />
      ) : (
        <NoOddsHint />
      )}
    </form>
  );
}

function NoOddsHint() {
  return (
    <div className="rounded-md border border-dashed border-border px-4 py-3 text-meta text-muted-foreground tracking-tight">
      Análise indisponível enquanto não houver odds publicadas para este jogo.
    </div>
  );
}
