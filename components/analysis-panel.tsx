import { MarketAnalysisSections } from "@/components/market-analysis-section";
import { NewAnalysisForm } from "@/components/new-analysis-form";
import { PreviousAnalyses } from "@/components/previous-analyses";
import type {
  MarketAnalysisSectionItem,
  PreviousAnalysisItem,
} from "@/lib/view/types";

type Props = {
  matchId: string;
  // Última análise de CADA mercado deste jogo (#243), agrupada no server
  // (toMarketAnalysisSections). Cada seção é auto-contida: tem seu próprio rodapé de
  // reanálise (dropdown de modelo + refresh, #244).
  sections: MarketAnalysisSectionItem[];
  oddsAvailable: boolean;
  selectableModels: { id: string; label: string }[];
  selectableMarkets: { key: string; label: string }[];
  defaultModelLabel: string;
  preferredModelId: string | null;
  previous: PreviousAnalysisItem[];
};

// Orquestrador da área de análise (pós #244): SEM useActionState próprio. O disparo de
// NOVA análise (mercado sem seção ainda / cold-start) vive no NewAnalysisForm do topo
// (some quando todo mercado selecionável já tem seção); a REANÁLISE de cada mercado vive
// no rodapé da seção dele (SectionFooterDispatch). Afordância ÚNICA por mercado, sem
// botão de reanálise duplicado no topo.
export function AnalysisPanel({
  matchId,
  sections,
  oddsAvailable,
  selectableModels,
  selectableMarkets,
  defaultModelLabel,
  preferredModelId,
  previous,
}: Props) {
  // Mercados ainda SEM seção (= selectableMarkets − mercados já analisados). >0 → mostra o
  // dispatcher de nova análise; vazio → some (tudo reanalisável pelos rodapés). marketKey
  // das seções é o coalesced ('over_under'), que casa com selectableMarkets[].key.
  const sectionedKeys = new Set(sections.map((s) => s.marketKey));
  const unanalyzedMarkets = selectableMarkets.filter(
    (m) => !sectionedKeys.has(m.key),
  );

  return (
    <div className="flex flex-col gap-3">
      {unanalyzedMarkets.length > 0 && (
        <NewAnalysisForm
          matchId={matchId}
          unanalyzedMarkets={unanalyzedMarkets}
          selectableModels={selectableModels}
          defaultModelLabel={defaultModelLabel}
          preferredModelId={preferredModelId}
          oddsAvailable={oddsAvailable}
        />
      )}
      <MarketAnalysisSections
        sections={sections}
        analyzable
        matchId={matchId}
        selectableModels={selectableModels}
        defaultModelLabel={defaultModelLabel}
      />
      <PreviousAnalyses items={previous} />
    </div>
  );
}
