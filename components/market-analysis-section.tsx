import { AnalysisResult } from "@/components/analysis-result";
import { MatchCollapsible } from "@/components/match-collapsible";
import { SectionFooterDispatch } from "@/components/section-footer-dispatch";
import { formatLine } from "@/lib/format-number";
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
  if (rec === null) return view.liveLabel ? "leitura ao vivo" : "sem aposta";
  const line = rec.line !== null ? ` ${formatLine(rec.line)}` : "";
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
  showRiskDisclaimer = true,
}: {
  item: MarketAnalysisSectionItem;
  dispatch: DispatchProps | null;
  showRiskDisclaimer?: boolean;
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
  return <AnalysisResult view={item.view} showRiskDisclaimer={showRiskDisclaimer} />;
}

// Uma seção colapsável por mercado (#243): reusa o MatchCollapsible (client) com o
// conteúdo dentro. ISOMÓRFICO (não adiciona fronteira de cliente própria — só
// MatchCollapsible e, no caminho analisável, SectionFooterDispatch são "use client").
// `marketLabel` é SIBLING da view (o branch pass do AnalysisResult não imprime mercado).
export function MarketAnalysisSection({
  item,
  defaultOpen = false,
  dispatch,
  showRiskDisclaimer = true,
}: {
  item: MarketAnalysisSectionItem;
  defaultOpen?: boolean;
  dispatch: DispatchProps | null;
  showRiskDisclaimer?: boolean;
}) {
  return (
    <MatchCollapsible
      title={item.marketLabel}
      meta={sectionMeta(item.view)}
      defaultOpen={defaultOpen}
    >
      <SectionContent
        item={item}
        dispatch={dispatch}
        showRiskDisclaimer={showRiskDisclaimer}
      />
    </MatchCollapsible>
  );
}

// Mercado aberto, sem acordeão (#576, "Ler análise completa"): cabeçalho h3 com o
// mercado à esquerda e o resumo (seleção · odd) à direita, e o resultado logo abaixo.
function FlatMarketSection({
  item,
  dispatch,
  showRiskDisclaimer,
}: {
  item: MarketAnalysisSectionItem;
  dispatch: DispatchProps | null;
  showRiskDisclaimer: boolean;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <h3 className="text-meta font-medium uppercase tracking-label text-muted-foreground">
          {item.marketLabel}
        </h3>
        <span className="text-right text-body-sm tabular-nums tracking-tight text-muted-foreground">
          {sectionMeta(item.view)}
        </span>
      </div>
      <SectionContent
        item={item}
        dispatch={dispatch}
        showRiskDisclaimer={showRiskDisclaimer}
      />
    </section>
  );
}

// Área de resultados por-mercado. Layout `collapsible` (default): `sections.length` é a
// ÚNICA chave single-vs-multi: ≤1 → conteúdo CRU (sem chrome de collapsible) —
// byte-idêntico ao atual no read-only, AC3 de produção; ≥2 → uma seção colapsável por
// mercado, TODAS COLAPSADAS por padrão (refino #366: o usuário escolhe qual abrir).
// Layout `flat` (#576, "Ler análise completa"): todo mercado aberto, com cabeçalho, num
// nível só. key=marketKey: a seção NÃO remonta na reanálise (#244) → o estado do footer
// (dropdown de modelo) persiste. `showRiskDisclaimer` vai a cada AnalysisResult (false
// quando o container mostra UMA linha de risco, ADR 0057).
export function MarketAnalysisSections({
  sections,
  analyzable = false,
  matchId,
  selectableModels = [],
  defaultModelLabel = "",
  layout = "collapsible",
  showRiskDisclaimer = true,
}: {
  sections: MarketAnalysisSectionItem[];
  analyzable?: boolean;
  matchId?: string;
  selectableModels?: { id: string; label: string }[];
  defaultModelLabel?: string;
  layout?: "collapsible" | "flat";
  showRiskDisclaimer?: boolean;
}) {
  if (sections.length === 0) return null;
  const dispatch: DispatchProps | null =
    analyzable && matchId
      ? { analyzable, matchId, selectableModels, defaultModelLabel }
      : null;

  if (layout === "flat") {
    return (
      <div className="flex flex-col gap-5">
        {sections.map((item) => (
          <FlatMarketSection
            key={item.marketKey}
            item={item}
            dispatch={dispatch}
            showRiskDisclaimer={showRiskDisclaimer}
          />
        ))}
      </div>
    );
  }

  if (sections.length === 1) {
    return (
      <SectionContent
        item={sections[0]}
        dispatch={dispatch}
        showRiskDisclaimer={showRiskDisclaimer}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {sections.map((item) => (
        <MarketAnalysisSection
          key={item.marketKey}
          item={item}
          dispatch={dispatch}
          showRiskDisclaimer={showRiskDisclaimer}
        />
      ))}
    </div>
  );
}
