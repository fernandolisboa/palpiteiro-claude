import { AnalysisResult } from "@/components/analysis-result";
import { MatchCollapsible } from "@/components/match-collapsible";
import { SectionFooterDispatch } from "@/components/section-footer-dispatch";
import type {
  AnalysisView,
  MarketAnalysisSectionItem,
} from "@/lib/view/types";

// Resumo market-agnostic no header colapsado da seção: a seleção recomendada (+ linha
// quando houver) e a odd congelada — o "o quê" da aposta num relance. Pass não tem
// recomendação → "sem aposta". NÃO varre `view.outcomes` (vazio no caminho degradado
// sem o par binário, AC4); lê só de `recommendation`/`oddAtRec`, sempre presentes.
function sectionMeta(view: AnalysisView): string {
  const rec = view.recommendation;
  if (rec === null) return "sem aposta";
  const line = rec.line !== null ? ` ${rec.line}` : "";
  const odd = view.oddAtRec ? ` · ${view.oddAtRec}` : "";
  return `${rec.selectionLabel}${line}${odd}`;
}

// Props de dispatch da reanálise por seção (#244). Presentes só no caminho ANALISÁVEL
// (painel client); ausentes no caminho encerrado (render read-only de Server Component).
type DispatchProps = {
  analyzable: boolean;
  matchId: string;
  selectableModels: { id: string; label: string }[];
  defaultModelLabel: string;
};

// Conteúdo de uma seção: analisável → footer de reanálise por seção (#244, client, com
// o resultado + dropdown de modelo + refresh); encerrado → AnalysisResult read-only
// (sem hooks — montado direto de Server Component).
function SectionContent({
  item,
  dispatch,
}: {
  item: MarketAnalysisSectionItem;
  dispatch: DispatchProps | null;
}) {
  if (dispatch?.analyzable) {
    return (
      <SectionFooterDispatch
        matchId={dispatch.matchId}
        marketKey={item.marketKey}
        view={item.view}
        modelId={item.modelId}
        selectableModels={dispatch.selectableModels}
        defaultModelLabel={dispatch.defaultModelLabel}
      />
    );
  }
  return <AnalysisResult view={item.view} />;
}

// Uma seção colapsável por mercado (#243): reusa o MatchCollapsible (client) com o
// conteúdo dentro. ISOMÓRFICO (não adiciona fronteira de cliente própria — só
// MatchCollapsible e, no caminho analisável, SectionFooterDispatch são "use client").
// `marketLabel` é SIBLING da view (o branch pass do AnalysisResult não imprime mercado).
export function MarketAnalysisSection({
  item,
  defaultOpen = false,
  dispatch,
}: {
  item: MarketAnalysisSectionItem;
  defaultOpen?: boolean;
  dispatch: DispatchProps | null;
}) {
  return (
    <MatchCollapsible
      title={item.marketLabel}
      meta={sectionMeta(item.view)}
      defaultOpen={defaultOpen}
    >
      <SectionContent item={item} dispatch={dispatch} />
    </MatchCollapsible>
  );
}

// Área de resultados por-mercado. `sections.length` é a ÚNICA chave single-vs-multi: ≤1 →
// conteúdo CRU (sem chrome de collapsible) — byte-idêntico ao atual no read-only, AC3 de
// produção; ≥2 → uma seção colapsável por mercado, TODAS COLAPSADAS por padrão (refino
// #366: ao abrir "ver análise por mercado", nenhum mercado vem expandido — o usuário
// escolhe qual abrir). key=marketKey: a seção NÃO remonta na reanálise (#244) → o estado
// do footer (dropdown de modelo) persiste.
export function MarketAnalysisSections({
  sections,
  analyzable = false,
  matchId,
  selectableModels = [],
  defaultModelLabel = "",
}: {
  sections: MarketAnalysisSectionItem[];
  analyzable?: boolean;
  matchId?: string;
  selectableModels?: { id: string; label: string }[];
  defaultModelLabel?: string;
}) {
  if (sections.length === 0) return null;
  const dispatch: DispatchProps | null =
    analyzable && matchId
      ? { analyzable, matchId, selectableModels, defaultModelLabel }
      : null;

  if (sections.length === 1) {
    return <SectionContent item={sections[0]} dispatch={dispatch} />;
  }
  return (
    <div className="flex flex-col gap-3">
      {sections.map((item) => (
        <MarketAnalysisSection
          key={item.marketKey}
          item={item}
          dispatch={dispatch}
        />
      ))}
    </div>
  );
}
