import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MarketAnalysisSection,
  MarketAnalysisSections,
} from "@/components/market-analysis-section";
import type {
  AnalysisView,
  MarketAnalysisSectionItem,
  OutcomeView,
} from "@/lib/view/types";

const overOutcome: OutcomeView = {
  id: "over",
  label: "Over 2.5",
  scenarioLabel: "mais de 2.5 gols",
  modelProb: "58%",
  marketProb: "50.7%",
  odd: "1.92",
  edge: "+7.3pp",
  expectedReturn: "+11.4%",
  breakEven: "1.72",
  isRecommended: true,
};

// over/under com recomendação. meta esperada = "Over 2.5 · 1.92" (selectionLabel +
// linha + odd congelada). Campos completos pro AnalysisResult renderizar sem quebrar.
const ouRecView: AnalysisView = {
  recommendation: {
    marketKey: "over_under",
    marketLabel: "Over/Under gols",
    selectionKey: "over",
    selectionLabel: "Over",
    line: 2.5,
    betSummary: { market: "Mais de 2.5 gols", plain: "pelo menos 3 gols no jogo" },
  },
  outcomes: [overOutcome],
  minOdd: "1.85",
  stakeUnits: "1.00 u",
  framing: null,
  note: null,
  oddAtRec: "1.92",
  oddAtRecAgo: "há 3h",
  bookmaker: "bet365",
  expectedReturn: "+11.4%",
  expectedReturnTone: "positive",
  evLegend: "ganho médio por aposta",
  minEdgeLabel: "5pp",
  rationale: "racional over_under",
  factors: ["fator um"],
  generatedAt: "19 mai · 14:22",
  promptVersion: "over_under_v1.2",
  model: "claude-sonnet-4.5",
  costUsd: "$0.014",
};

// 1X2: linha null → meta SEM a linha ("Casa · 2.10"). Prova que a meta é dirigida pela
// view (market-agnostic), nunca "2.5" hardcoded.
const mrRecView: AnalysisView = {
  ...ouRecView,
  recommendation: {
    marketKey: "match_result",
    marketLabel: "Resultado (1X2)",
    selectionKey: "home",
    selectionLabel: "Casa",
    line: null,
    betSummary: { market: "Casa", plain: "" },
  },
  outcomes: [{ ...overOutcome, id: "home", label: "Casa", scenarioLabel: "Casa" }],
  oddAtRec: "2.10",
  rationale: "racional match_result",
};

// pass: sem recomendação → meta "sem aposta".
const passView: AnalysisView = {
  ...ouRecView,
  recommendation: null,
  outcomes: [{ ...overOutcome, isRecommended: false }],
  minOdd: null,
  stakeUnits: null,
  oddAtRec: null,
  oddAtRecAgo: null,
  bookmaker: null,
  expectedReturn: null,
  expectedReturnTone: "neutral",
  evLegend: null,
  rationale: "racional pass",
};

describe("MarketAnalysisSection", () => {
  it("título = marketLabel (SIBLING, não derivado da view) + conteúdo = AnalysisResult", () => {
    const markup = renderToStaticMarkup(
      <MarketAnalysisSection
        marketLabel="Resultado (1X2)"
        view={mrRecView}
        defaultOpen
      />,
    );
    // O título da seção vem do marketLabel passado (identifica até um pass, que o
    // AnalysisResult não rotula).
    expect(markup).toContain("Resultado (1X2)");
    // AnalysisResult renderizado dentro (aberto): o racional daquela análise aparece.
    expect(markup).toContain("racional match_result");
  });

  it("meta da recomendação = seleção + linha + odd (market-agnostic)", () => {
    const ou = renderToStaticMarkup(
      <MarketAnalysisSection marketLabel="Over/Under gols" view={ouRecView} />,
    );
    expect(ou).toContain("Over 2.5 · 1.92");

    // 1X2 sem linha → meta sem "2.5", só seleção + odd.
    const mr = renderToStaticMarkup(
      <MarketAnalysisSection marketLabel="Resultado (1X2)" view={mrRecView} />,
    );
    expect(mr).toContain("Casa · 2.10");
    expect(mr).not.toContain("2.5");
  });

  it("pass → meta 'sem aposta'", () => {
    const markup = renderToStaticMarkup(
      <MarketAnalysisSection marketLabel="Over/Under gols" view={passView} />,
    );
    expect(markup).toContain("sem aposta");
  });

  it("defaultOpen controla o estado inicial da seção (data-state do Radix)", () => {
    const open = renderToStaticMarkup(
      <MarketAnalysisSection marketLabel="Over/Under gols" view={ouRecView} defaultOpen />,
    );
    expect(open).toContain('data-state="open"');
    // Aberta → o conteúdo (racional) está presente.
    expect(open).toContain("racional over_under");

    const closed = renderToStaticMarkup(
      <MarketAnalysisSection marketLabel="Over/Under gols" view={ouRecView} />,
    );
    expect(closed).toContain('data-state="closed"');
  });
});

describe("MarketAnalysisSections", () => {
  const item = (id: string, marketLabel: string, view: AnalysisView): MarketAnalysisSectionItem => ({
    id,
    marketLabel,
    view,
  });

  it("≤1 seção → AnalysisResult CRU (sem chrome de collapsible, AC3 over/under)", () => {
    const markup = renderToStaticMarkup(
      <MarketAnalysisSections sections={[item("a", "Over/Under gols", ouRecView)]} />,
    );
    // Conteúdo do resultado presente…
    expect(markup).toContain("racional over_under");
    // …mas SEM o header colapsável: a meta "Over 2.5 · 1.92" só existe no trigger do
    // MatchCollapsible, ausente no AnalysisResult cru (discrimina ≤1 de ≥2).
    expect(markup).not.toContain("Over 2.5 · 1.92");
  });

  it("≥2 seções → uma seção colapsável por mercado, a 1ª aberta por padrão", () => {
    const markup = renderToStaticMarkup(
      <MarketAnalysisSections
        sections={[
          item("a", "Over/Under gols", ouRecView),
          item("b", "Resultado (1X2)", mrRecView),
        ]}
      />,
    );
    // Ambos os mercados viram seções (meta no trigger de cada).
    expect(markup).toContain("Over 2.5 · 1.92");
    expect(markup).toContain("Casa · 2.10");
    // 1ª aberta, 2ª fechada (defaultOpen={i===0}).
    expect(markup).toContain('data-state="open"');
    expect(markup).toContain('data-state="closed"');
    expect(markup.indexOf('data-state="open"')).toBeLessThan(
      markup.indexOf('data-state="closed"'),
    );
  });

  it("vazio → não renderiza nada", () => {
    expect(renderToStaticMarkup(<MarketAnalysisSections sections={[]} />)).toBe("");
  });
});
