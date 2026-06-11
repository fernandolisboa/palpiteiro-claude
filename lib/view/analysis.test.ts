import { describe, expect, it } from "vitest";

import { toAnalysisView } from "./analysis";

const baseCreatedAt = new Date(2026, 4, 19, 14, 22);
const threeHoursLater = new Date(2026, 4, 19, 17, 22);

describe("toAnalysisView", () => {
  it("maps over recommendation with bet summary and positive expected return", () => {
    const view = toAnalysisView(
      {
        recommendation: "over",
        confidencePct: "58.00",
        rationale: "blah",
        keyFactors: ["a", "b"],
        minimumOdd: "1.750",
        oddAtRecommendation: "1.920",
        bookmaker: "bet365",
        edgePct: "7.30",
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
      },
      { costUsd: "0.014000" },
      threeHoursLater,
    );

    // EV à mão: 0.58 × 1.92 − 1 = +0.1136 → "+11.4%"
    expect(view).toEqual({
      kind: "OVER",
      confidence: "58%",
      edge: "+7.3",
      minOdd: "1.75",
      betSummary: {
        market: "Mais de 2.5 gols",
        plain: "pelo menos 3 gols no jogo",
      },
      oddAtRec: "1.92",
      oddAtRecAgo: "há 3h",
      bookmaker: "bet365",
      expectedReturn: "+11.4%",
      expectedReturnTone: "positive",
      evLegend:
        "ganho médio por aposta, no longo prazo, se a estimativa de 58% do modelo estiver certa",
      minEdgeLabel: "5pp",
      rationale: "blah",
      factors: ["a", "b"],
      generatedAt: "19 mai · 14:22",
      promptVersion: "over_under_v1.1",
      model: "claude-sonnet-4.5",
      costUsd: "$0.014",
    });
  });

  it("maps under recommendation with the under bet summary", () => {
    const view = toAnalysisView(
      {
        recommendation: "under",
        confidencePct: "56",
        rationale: "x",
        keyFactors: ["a", "b"],
        minimumOdd: "1.80",
        oddAtRecommendation: "1.850",
        bookmaker: "pinnacle",
        edgePct: "6.70",
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
      },
      null,
      new Date(2026, 4, 19, 16, 22),
    );

    // EV à mão: 0.56 × 1.85 − 1 = +0.036 → "+3.6%"
    expect(view).toEqual({
      kind: "UNDER",
      confidence: "56%",
      edge: "+6.7",
      minOdd: "1.80",
      betSummary: {
        market: "Menos de 2.5 gols",
        plain: "no máximo 2 gols no jogo",
      },
      oddAtRec: "1.85",
      oddAtRecAgo: "há 2h",
      bookmaker: "pinnacle",
      expectedReturn: "+3.6%",
      expectedReturnTone: "positive",
      evLegend:
        "ganho médio por aposta, no longo prazo, se a estimativa de 56% do modelo estiver certa",
      minEdgeLabel: "5pp",
      rationale: "x",
      factors: ["a", "b"],
      generatedAt: "19 mai · 14:22",
      promptVersion: "over_under_v1.1",
      model: "claude-sonnet-4.5",
      costUsd: "$0.000",
    });
  });

  it("pass recommendation has null bet fields and neutral tone", () => {
    const view = toAnalysisView(
      {
        recommendation: "pass",
        confidencePct: "51.00",
        rationale: "no edge",
        keyFactors: ["a", "b"],
        minimumOdd: null,
        oddAtRecommendation: null,
        bookmaker: null,
        edgePct: null,
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
      },
      { costUsd: "0.011" },
      threeHoursLater,
    );

    expect(view).toEqual({
      kind: "PASS",
      confidence: "51%",
      edge: null,
      minOdd: null,
      betSummary: null,
      oddAtRec: null,
      oddAtRecAgo: null,
      bookmaker: null,
      expectedReturn: null,
      expectedReturnTone: "neutral",
      evLegend: null,
      minEdgeLabel: "5pp",
      rationale: "no edge",
      factors: ["a", "b"],
      generatedAt: "19 mai · 14:22",
      promptVersion: "over_under_v1.1",
      model: "claude-sonnet-4.5",
      costUsd: "$0.011",
    });
  });

  it("historical prediction without frozen odd degrades to em-dash", () => {
    const view = toAnalysisView(
      {
        recommendation: "over",
        confidencePct: "58.00",
        rationale: "old",
        keyFactors: ["a"],
        minimumOdd: "1.750",
        oddAtRecommendation: null,
        bookmaker: null,
        edgePct: "7.30",
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.0",
        createdAt: baseCreatedAt,
      },
      null,
      new Date(2026, 4, 21, 14, 22),
    );

    expect(view).toEqual({
      kind: "OVER",
      confidence: "58%",
      edge: "+7.3",
      minOdd: "1.75",
      betSummary: {
        market: "Mais de 2.5 gols",
        plain: "pelo menos 3 gols no jogo",
      },
      oddAtRec: "—",
      oddAtRecAgo: "há 2d",
      bookmaker: null,
      expectedReturn: "—",
      expectedReturnTone: "neutral",
      evLegend:
        "ganho médio por aposta, no longo prazo, se a estimativa de 58% do modelo estiver certa",
      minEdgeLabel: "5pp",
      rationale: "old",
      factors: ["a"],
      generatedAt: "19 mai · 14:22",
      promptVersion: "over_under_v1.0",
      model: "claude-sonnet-4.5",
      costUsd: "$0.000",
    });
  });

  it("warns when minimumOdd is above the odd frozen at recommendation", () => {
    // Comparação NUMÉRICA ("2.050" > "1.920"), nunca lexicográfica.
    const view = toAnalysisView(
      {
        recommendation: "over",
        confidencePct: "58.00",
        rationale: "blah",
        keyFactors: ["a"],
        minimumOdd: "2.050",
        oddAtRecommendation: "1.920",
        bookmaker: "bet365",
        edgePct: "7.30",
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
      },
      null,
      threeHoursLater,
    );

    // Valor honesto, mas tom neutro + aviso no lugar da legenda padrão.
    expect(view.expectedReturn).toBe("+11.4%");
    expect(view.expectedReturnTone).toBe("neutral");
    expect(view.evLegend).toBe(
      "a odd registrada na análise (1.92) estava abaixo da mínima sugerida (2.05) — só vale a pena se a odd subir para ≥ 2.05",
    );
  });

  it("shows honest negative expected return in neutral tone (edge >= 5pp, raw odd below break-even)", () => {
    // Edge compara com a implied NORMALIZADA; o EV é pago na odd CRUA — com
    // overround alto os dois podem discordar (ADR 0012).
    // EV à mão: 0.55 × 1.802 − 1 = −0.0089 → "-0.9%"
    const view = toAnalysisView(
      {
        recommendation: "over",
        confidencePct: "55.00",
        rationale: "thin",
        keyFactors: ["a"],
        minimumOdd: "1.800",
        oddAtRecommendation: "1.802",
        bookmaker: "bet365",
        edgePct: "5.00",
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
      },
      null,
      threeHoursLater,
    );

    expect(view.expectedReturn).toBe("-0.9%");
    expect(view.expectedReturnTone).toBe("neutral");
    expect(view.evLegend).toBe(
      "na odd registrada na análise, o retorno esperado é negativo — só vale a pena com odd ≥ 1.80",
    );
  });
});
