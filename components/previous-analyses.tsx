import { AnalysisResult } from "@/components/analysis-result";
import { MatchCollapsible } from "@/components/match-collapsible";
import type { PreviousAnalysisItem } from "@/lib/view/types";

// Seção colapsável "análises anteriores" (#204): as predições passadas de um jogo
// (history.slice(1)) sob a análise atual. Cada item reusa o <AnalysisResult/>
// existente em modo somente-leitura (sem footer de reanálise — esse é só das seções
// por mercado, #244). ISOMÓRFICO (sem "use client"): renderizado tanto dentro do
// AnalysisPanel client (jogos analisáveis) quanto direto na page server (jogos
// encerrados com histórico). Market-agnostic: o header vem de marketLabel (registry),
// nunca de strings de mercado hardcoded — o branch pass do AnalysisResult não imprime
// o mercado, então sem o header um pass anterior ficaria sem identificação.
export function PreviousAnalyses({ items }: { items: PreviousAnalysisItem[] }) {
  if (items.length === 0) return null;
  return (
    <MatchCollapsible title="análises anteriores" meta={String(items.length)}>
      <div className="flex flex-col gap-4">
        {items.map((item) => (
          // key = predictions.id (estável): reanálises do mesmo minuto não colidem.
          <div key={item.id} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 px-0.5">
              <span className="font-mono text-eyebrow uppercase tracking-label text-muted-foreground">
                {item.marketLabel}
              </span>
              <span className="font-mono text-eyebrow-xs tabular-nums text-muted-fg-2">
                {item.generatedAt}
              </span>
            </div>
            <AnalysisResult view={item.view} />
          </div>
        ))}
      </div>
    </MatchCollapsible>
  );
}
