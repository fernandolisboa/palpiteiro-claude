import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// SectionFooterDispatch (importado pelo MarketAnalysisSections) puxa o server action.
vi.mock("@/app/actions/predictions", () => ({ analyzeMatch: vi.fn() }));

import { FullAnalysis } from "@/components/full-analysis";
import { ANALYSIS_RISK_DISCLAIMER } from "@/lib/view/analysis";
import type { AnalysisView, MarketAnalysisSectionItem } from "@/lib/view/types";

function view(selectionLabel: string, rationale: string): AnalysisView {
  return {
    recommendation: {
      marketKey: "match_result",
      marketLabel: "Resultado",
      selectionKey: "home",
      selectionLabel,
      line: null,
      betSummary: { market: selectionLabel, plain: "" },
    },
    outcomes: [],
    minOdd: "1,85",
    stakeUnits: "1,00 u",
    framing: null,
    note: null,
    oddAtRec: "2,10",
    oddAtRecAgo: "há 3h",
    bookmaker: null,
    expectedReturn: "+11,4%",
    expectedReturnTone: "positive",
    evLegend: "x",
    minEdgeLabel: "5 pontos",
    minEdgePp: 5,
    rationale,
    factors: [],
    generatedAt: "19 mai · 14:22",
    promptVersion: "v1",
    model: "claude-sonnet-4.5",
    engine: "LLM",
    costUsd: "$0.01",
  } as AnalysisView;
}

const item = (
  marketKey: string,
  marketLabel: string,
  rationale: string
): MarketAnalysisSectionItem => ({
  id: `${marketKey}-id`,
  marketKey,
  marketLabel,
  modelId: "claude-sonnet-4-5-20250929",
  view: view("Flamengo", rationale),
});

const SECTIONS = [
  item("match_result", "Resultado", "RACIONAL_1"),
  item("btts", "Ambas marcam", "RACIONAL_2"),
];

describe("FullAnalysis (#576, ADR 0057)", () => {
  it("sem análise não renderiza nada", () => {
    expect(
      renderToStaticMarkup(
        <FullAnalysis sections={[]} previousAnalyses={[]} userContext={null} />
      )
    ).toBe("");
  });

  it("UMA linha de risco, antes do primeiro mercado; mercados abertos num nível só", () => {
    const html = renderToStaticMarkup(
      <FullAnalysis
        sections={SECTIONS}
        previousAnalyses={[
          {
            id: "old",
            marketLabel: "Resultado",
            generatedAt: "18 mai · 10:00",
            view: view("Empate", "RACIONAL_ANTIGO"),
          },
        ]}
        userContext={null}
      />
    );
    expect(html.split(ANALYSIS_RISK_DISCLAIMER).length - 1).toBe(1);
    expect(html.indexOf(ANALYSIS_RISK_DISCLAIMER)).toBeLessThan(
      html.indexOf("<h3")
    );
    expect(html).toContain("RACIONAL_1");
    expect(html).toContain("RACIONAL_2");
    // Análises anteriores: a única divulgação, no fim.
    expect(html).toContain("análises anteriores");
  });
});
