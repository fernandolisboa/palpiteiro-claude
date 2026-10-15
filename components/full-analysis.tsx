import { Info } from "lucide-react";

import { AnalysisUserContext } from "@/components/analysis-user-context";
import { MarketAnalysisSections } from "@/components/market-analysis-section";
import { PreviousAnalyses } from "@/components/previous-analyses";
import { ANALYSIS_RISK_DISCLAIMER } from "@/lib/view/analysis";
import type { AnalysisUserContextView } from "@/lib/view/analysis-user-context";
import type {
  MarketAnalysisSectionItem,
  PreviousAnalysisItem,
} from "@/lib/view/types";

/**
 * "Ler análise completa" (#576): a análise por mercado aberta, num nível só, logo abaixo
 * do Palpite da IA (bloco IRMÃO do HERO; os números de valor são conteúdo legítimo aqui,
 * o firewall da ADR 0030 só barra a manchete). Modo só leitura (sem footer de reanálise;
 * o HERO re-roda tudo).
 *
 * Ordem: o que você acrescentou → UMA linha de risco, antes do primeiro mercado (perto da
 * recomendação, ADR 0057 item 3) → cada mercado aberto → análises anteriores (a única
 * divulgação, no fim). Nenhum cartão repete a linha de risco.
 *
 * O `view` retornado por analyzeBestBet é IGNORADO de propósito: o detalhe vem do
 * `sections` revalidado (não-stale), e o contrato #353 do action não pode ser tocado
 * (predictions-best-bet.test.ts o pina).
 */
export function FullAnalysis({
  sections,
  previousAnalyses,
  userContext,
}: {
  sections: MarketAnalysisSectionItem[];
  previousAnalyses: PreviousAnalysisItem[];
  // "O que você acrescentou" (#565): o contexto extra da análise visível.
  userContext: AnalysisUserContextView | null;
}) {
  if (sections.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {userContext && <AnalysisUserContext view={userContext} />}
      <p className="text-meta text-muted-foreground flex items-center gap-1.5 leading-snug tracking-tight">
        <Info className="size-3 shrink-0" aria-hidden="true" />
        {ANALYSIS_RISK_DISCLAIMER}
      </p>
      <MarketAnalysisSections
        sections={sections}
        layout="flat"
        showRiskDisclaimer={false}
      />
      <PreviousAnalyses items={previousAnalyses} showRiskDisclaimer={false} />
    </div>
  );
}
