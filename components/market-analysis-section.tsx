import { AnalysisResult } from "@/components/analysis-result";
import { MatchCollapsible } from "@/components/match-collapsible";
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

// Uma seção colapsável por mercado (#243): reusa o MatchCollapsible (client) com o
// AnalysisResult existente dentro (somente-leitura — `again={false}`; o disparo de
// reanálise fica nos controles do topo do painel, e #244 move pra um rodapé por seção).
// ISOMÓRFICO no sentido de previous-analyses.tsx: não adiciona fronteira de cliente
// própria — só o MatchCollapsible filho é "use client". `marketLabel` é SIBLING da view
// (o branch pass do AnalysisResult não imprime mercado → o título o identifica).
export function MarketAnalysisSection({
  marketLabel,
  view,
  defaultOpen = false,
  again = false,
}: {
  marketLabel: string;
  view: AnalysisView;
  defaultOpen?: boolean;
  again?: boolean;
}) {
  return (
    <MatchCollapsible
      title={marketLabel}
      meta={sectionMeta(view)}
      defaultOpen={defaultOpen}
    >
      <AnalysisResult view={view} again={again} />
    </MatchCollapsible>
  );
}

// Área de resultados por-mercado. `sections.length` é a ÚNICA chave single-vs-multi
// (espelha toMarketAnalysisSections): com ≤1 mercado renderiza o AnalysisResult CRU
// (sem chrome de collapsible) — byte-idêntico ao atual, AC3 de produção (over/under);
// com ≥2 empilha uma seção colapsável por mercado, a mais recente (índice 0) aberta por
// padrão. key=item.id remonta SÓ a seção reanalisada (id novo) → ela reabre sem fechar
// as outras (#243).
export function MarketAnalysisSections({
  sections,
  again = false,
}: {
  sections: MarketAnalysisSectionItem[];
  again?: boolean;
}) {
  if (sections.length === 0) return null;
  if (sections.length === 1) {
    return <AnalysisResult view={sections[0].view} again={again} />;
  }
  return (
    <div className="flex flex-col gap-3">
      {sections.map((item, i) => (
        <MarketAnalysisSection
          key={item.id}
          marketLabel={item.marketLabel}
          view={item.view}
          defaultOpen={i === 0}
          again={again}
        />
      ))}
    </div>
  );
}
