import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// O painel importa o server action analyzeMatch (cadeia predict/db) — mock leve pra não
// puxar server-only no env de teste. O teste exercita só o RENDER (useActionState não
// dispara a action sem submit), travando a invariante B3 do modo multi (#243).
vi.mock("@/app/actions/predictions", () => ({
  analyzeMatch: vi.fn(),
}));

import { AnalysisPanel } from "@/components/analysis-panel";
import type {
  AnalysisView,
  MarketAnalysisSectionItem,
} from "@/lib/view/types";

function view(o: {
  marketKey: string;
  marketLabel: string;
  selectionLabel: string;
  line: number | null;
  oddAtRec: string;
  rationale: string;
}): AnalysisView {
  return {
    recommendation: {
      marketKey: o.marketKey,
      marketLabel: o.marketLabel,
      selectionKey: "x",
      selectionLabel: o.selectionLabel,
      line: o.line,
      betSummary: { market: o.selectionLabel, plain: "" },
    },
    outcomes: [
      {
        id: "x",
        label: o.selectionLabel,
        scenarioLabel: o.selectionLabel,
        modelProb: "58%",
        marketProb: "50%",
        odd: o.oddAtRec,
        edge: "+7.3pp",
        expectedReturn: "+11%",
        breakEven: "1.7",
        isRecommended: true,
      },
    ],
    minOdd: "1.85",
    stakeUnits: "1.00 u",
    framing: null,
    note: null,
    oddAtRec: o.oddAtRec,
    oddAtRecAgo: "há 3h",
    bookmaker: "bet365",
    expectedReturn: "+11%",
    expectedReturnTone: "positive",
    evLegend: "x",
    minEdgeLabel: "5pp",
    rationale: o.rationale,
    factors: ["f"],
    generatedAt: "19 mai · 14:22",
    promptVersion: "v1",
    model: "claude",
    costUsd: "$0.01",
  };
}

const occurrences = (s: string, sub: string) => s.split(sub).length - 1;

const OU: MarketAnalysisSectionItem = {
  id: "a",
  marketLabel: "Over/Under gols",
  view: view({
    marketKey: "over_under",
    marketLabel: "Over/Under gols",
    selectionLabel: "Over",
    line: 2.5,
    oddAtRec: "1.92",
    rationale: "RACIONAL_OU",
  }),
};
const MR: MarketAnalysisSectionItem = {
  id: "b",
  marketLabel: "Resultado (1X2)",
  view: view({
    marketKey: "match_result",
    marketLabel: "Resultado (1X2)",
    selectionLabel: "Casa",
    line: null,
    oddAtRec: "2.10",
    rationale: "RACIONAL_MR",
  }),
};

describe("AnalysisPanel — seções por mercado (#243)", () => {
  it("multi (≥2): renderiza só as seções (de props), NUNCA state.view (invariante B3)", () => {
    const markup = renderToStaticMarkup(
      <AnalysisPanel
        matchId="m"
        sections={[OU, MR]}
        oddsAvailable
        selectableModels={[]}
        selectableMarkets={[
          { key: "over_under", label: "Over/Under" },
          { key: "match_result", label: "1X2" },
        ]}
        defaultModelLabel="claude"
        preferredModelId={null}
        previous={[]}
      />,
    );
    // Ambos os mercados viram seção (meta no trigger de cada).
    expect(markup).toContain("Over 2.5 · 1.92");
    expect(markup).toContain("Casa · 2.10");
    // B3: a 1ª seção (aberta) mostra seu racional UMA vez. Se o painel renderizasse o
    // state.view inline (o seed = sections[0].view), o racional apareceria DUAS vezes —
    // a duplicata que #244 não pode reintroduzir.
    expect(occurrences(markup, "RACIONAL_OU")).toBe(1);
  });

  it("single (≤1): cai no AnalysisResult inline, sem chrome de seção (AC3)", () => {
    const markup = renderToStaticMarkup(
      <AnalysisPanel
        matchId="m"
        sections={[OU]}
        oddsAvailable
        selectableModels={[]}
        selectableMarkets={[{ key: "over_under", label: "Over/Under" }]}
        defaultModelLabel="claude"
        preferredModelId={null}
        previous={[]}
      />,
    );
    expect(markup).toContain("RACIONAL_OU");
    // Sem header colapsável: a meta só existe no trigger do MatchCollapsible (≥2).
    expect(markup).not.toContain("Over 2.5 · 1.92");
  });
});
