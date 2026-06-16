import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// O painel orquestra NewAnalysisForm + as seções (SectionFooterDispatch), ambos importam
// o server action analyzeMatch — mock leve pra não puxar server-only no env de teste.
vi.mock("@/app/actions/predictions", () => ({
  analyzeMatch: vi.fn(),
}));

import { AnalysisPanel } from "@/components/analysis-panel";
import type {
  AnalysisView,
  MarketAnalysisSectionItem,
  OutcomeView,
} from "@/lib/view/types";

const outcome: OutcomeView = {
  id: "x",
  label: "Over 2.5",
  scenarioLabel: "mais de 2.5 gols",
  modelProb: "58%",
  marketProb: "50%",
  odd: "1.92",
  edge: "+7.3pp",
  expectedReturn: "+11%",
  breakEven: "1.7",
  isRecommended: true,
};

function mkView(rationale: string): AnalysisView {
  return {
    recommendation: {
      marketKey: "over_under",
      marketLabel: "Over/Under gols",
      selectionKey: "over",
      selectionLabel: "Over",
      line: 2.5,
      betSummary: { market: "Mais de 2.5 gols", plain: "" },
    },
    outcomes: [outcome],
    minOdd: "1.85",
    stakeUnits: "1.00 u",
    framing: null,
    note: null,
    oddAtRec: "1.92",
    oddAtRecAgo: "há 3h",
    bookmaker: "bet365",
    expectedReturn: "+11%",
    expectedReturnTone: "positive",
    evLegend: "x",
    minEdgeLabel: "5pp",
    rationale,
    factors: ["f"],
    generatedAt: "19 mai · 14:22",
    promptVersion: "v1",
    model: "claude-opus-4.8",
    costUsd: "$0.01",
  };
}

function mkItem(marketKey: string, marketLabel: string): MarketAnalysisSectionItem {
  return {
    id: `${marketKey}-id`,
    marketKey,
    marketLabel,
    modelId: "claude-opus-4-8",
    view: mkView(`RACIONAL_${marketKey}`),
  };
}

const OU = mkItem("over_under", "Over/Under gols");
const MR = mkItem("match_result", "Resultado (1X2)");

const occurrences = (s: string, sub: string) => s.split(sub).length - 1;

function render(props: {
  sections: MarketAnalysisSectionItem[];
  selectableMarkets: { key: string; label: string }[];
}) {
  return renderToStaticMarkup(
    <AnalysisPanel
      matchId="m"
      sections={props.sections}
      oddsAvailable
      selectableModels={[]}
      selectableMarkets={props.selectableMarkets}
      defaultModelLabel="Opus 4.8"
      preferredModelId={null}
      previous={[]}
    />,
  );
}

const OVER_UNDER = [{ key: "over_under", label: "Over/Under" }];
const BOTH = [
  { key: "over_under", label: "Over/Under" },
  { key: "match_result", label: "1X2" },
];

describe("AnalysisPanel — orquestração nova/reanálise (#244)", () => {
  it("cold-start (0 análises): mostra o CTA de NOVA análise no topo", () => {
    const markup = render({ sections: [], selectableMarkets: OVER_UNDER });
    // Único mercado, sem seção → dispatcher de nova análise (AnalyzeCTA).
    expect(markup).toContain("Analisar com IA");
    // Sem seção ainda → nenhum footer de reanálise.
    expect(markup).not.toContain("Analisar de novo");
  });

  it("produção (over/under analisado): topo SOME, reanálise só no footer da seção (AC4)", () => {
    const markup = render({ sections: [OU], selectableMarkets: OVER_UNDER });
    // unanalyzedMarkets vazio → SEM dispatcher de nova análise no topo.
    expect(markup).not.toContain("Analisar com IA");
    // A reanálise vive UMA vez, no rodapé da seção (sem botão duplicado no topo).
    expect(occurrences(markup, "Analisar de novo")).toBe(1);
  });

  it("multi-mercado todos analisados: reanálise só nos footers, nenhum CTA no topo (AC4)", () => {
    const markup = render({ sections: [OU, MR], selectableMarkets: BOTH });
    // Nenhum mercado novo → sem dispatcher de nova análise no topo.
    expect(markup).not.toContain("Analisar com IA");
    // A reanálise vive nos footers das seções (só a aberta renderiza no markup estático;
    // o importante p/ AC4 é que NÃO há gatilho de reanálise no topo).
    expect(occurrences(markup, "Analisar de novo")).toBeGreaterThanOrEqual(1);
  });

  it("admin parcial (over/under analisado, 1X2 não): topo p/ o mercado novo + footer da seção existente", () => {
    const markup = render({ sections: [OU], selectableMarkets: BOTH });
    // match_result ainda sem seção → dispatcher de nova análise aparece.
    expect(markup).toContain("Analisar com IA");
    // E a seção over_under já tem seu footer de reanálise.
    expect(occurrences(markup, "Analisar de novo")).toBe(1);
  });
});
