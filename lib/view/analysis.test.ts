import { describe, expect, it } from "vitest";

import { computeMarketScenarios } from "@/lib/odds/scenario";

import { toAnalysisView, toOutcomesView } from "./analysis";
import { getMarketPresentation } from "./markets/presentation";

const baseCreatedAt = new Date(2026, 4, 19, 14, 22);
const threeHoursLater = new Date(2026, 4, 19, 17, 22);

describe("toAnalysisView", () => {
  it("maps over recommendation with bet summary, positive expected return and full scenarios", () => {
    const view = toAnalysisView(
      {
        recommendation: "over",
        confidencePct: "58.00",
        rationale: "blah",
        keyFactors: ["a", "b"],
        minimumOdd: "1.750",
        oddAtRecommendation: "1.920",
        bookmaker: "bet365",
        impliedProbPct: "50.70",
        edgePct: "7.30",
        overOddAtPrediction: "1.920",
        underOddAtPrediction: "1.950",
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
      recommendation: {
        marketKey: "over_under",
        marketLabel: "Over/Under gols",
        selectionKey: "over",
        selectionLabel: "Over",
        line: 2.5,
      },
      // outcomes espelham byte-a-byte as células do bloco scenarios (mesmo
      // computeScenarios, mesmos formatters); breakEven = modelBreakEvenOdd.
      outcomes: [
        {
          id: "over",
          label: "Over 2.5",
          modelProb: "58%",
          marketProb: "50.7%",
          odd: "1.92",
          edge: "+7.3pp",
          expectedReturn: "+11.4%",
          breakEven: "1.72",
          isRecommended: true,
        },
        {
          id: "under",
          label: "Under 2.5",
          modelProb: "42%",
          marketProb: "49.3%",
          odd: "1.95",
          edge: "-7.3pp",
          expectedReturn: "-18.1%",
          breakEven: "2.38",
          isRecommended: false,
        },
      ],
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
      scenarios: {
        // Invariante (ADR 0012): o edge da coluna recomendada é o edgePct
        // SALVO da row ("+7.3"), nunca o recomputado das odds.
        over: {
          modelProb: "58%",
          marketProb: "50.7%",
          odd: "1.92",
          edge: "+7.3pp",
          expectedReturn: "+11.4%",
          modelBreakEvenOdd: "1.72",
        },
        // Zebra derivada dos salvos: 100 − 50.7, −7.3; EV à mão:
        // 0.42 × 1.95 − 1 = −0.181 → "-18.1%".
        under: {
          modelProb: "42%",
          marketProb: "49.3%",
          odd: "1.95",
          edge: "-7.3pp",
          expectedReturn: "-18.1%",
          modelBreakEvenOdd: "2.38",
        },
        recommended: "over",
        // Break-even da zebra: 100/1.95 = 51.28… → "51.3%".
        framing:
          "a aposta em menos de 3 gols só sai do zero se a chance real for maior que 51.3% — na análise o modelo estimou 42%",
        note: null,
      },
      rationale: "blah",
      factors: ["a", "b"],
      generatedAt: "19 mai · 14:22",
      promptVersion: "over_under_v1.1",
      model: "claude-sonnet-4.5",
      costUsd: "$0.014",
    });
  });

  it("maps under recommendation with the under bet summary and mirrored scenarios", () => {
    const view = toAnalysisView(
      {
        recommendation: "under",
        confidencePct: "56",
        rationale: "x",
        keyFactors: ["a", "b"],
        minimumOdd: "1.80",
        oddAtRecommendation: "1.850",
        bookmaker: "pinnacle",
        impliedProbPct: "49.30",
        edgePct: "6.70",
        overOddAtPrediction: "1.980",
        underOddAtPrediction: "1.850",
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
      recommendation: {
        marketKey: "over_under",
        marketLabel: "Over/Under gols",
        selectionKey: "under",
        selectionLabel: "Under",
        line: 2.5,
      },
      outcomes: [
        {
          id: "over",
          label: "Over 2.5",
          modelProb: "44%",
          marketProb: "50.7%",
          odd: "1.98",
          edge: "-6.7pp",
          expectedReturn: "-12.9%",
          breakEven: "2.27",
          isRecommended: false,
        },
        {
          id: "under",
          label: "Under 2.5",
          modelProb: "56%",
          marketProb: "49.3%",
          odd: "1.85",
          edge: "+6.7pp",
          expectedReturn: "+3.6%",
          breakEven: "1.79",
          isRecommended: true,
        },
      ],
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
      scenarios: {
        // Zebra (over): EV à mão 0.44 × 1.98 − 1 = −0.1288 → "-12.9%".
        over: {
          modelProb: "44%",
          marketProb: "50.7%",
          odd: "1.98",
          edge: "-6.7pp",
          expectedReturn: "-12.9%",
          modelBreakEvenOdd: "2.27",
        },
        under: {
          modelProb: "56%",
          marketProb: "49.3%",
          odd: "1.85",
          edge: "+6.7pp",
          expectedReturn: "+3.6%",
          modelBreakEvenOdd: "1.79",
        },
        recommended: "under",
        // Break-even da zebra: 100/1.98 = 50.50… → "50.5%".
        framing:
          "a aposta em pelo menos 3 gols só sai do zero se a chance real for maior que 50.5% — na análise o modelo estimou 44%",
        note: null,
      },
      rationale: "x",
      factors: ["a", "b"],
      generatedAt: "19 mai · 14:22",
      promptVersion: "over_under_v1.1",
      model: "claude-sonnet-4.5",
      costUsd: "$0.000",
    });
  });

  it("pass with frozen pair: neutral scenarios for both sides, margin-of-error framing, no recommended", () => {
    // conf 53 @ 1.92/1.92 → edge over +3pp (pass), mas EV over = +1.8% —
    // retorno POSITIVO sob veredito de não apostar é estado legítimo
    // (ADR 0012, decisão 7); a copy de margem de erro cobre o caso.
    const view = toAnalysisView(
      {
        recommendation: "pass",
        confidencePct: "53.00",
        rationale: "no edge",
        keyFactors: ["a", "b"],
        minimumOdd: null,
        oddAtRecommendation: null,
        bookmaker: "bet365",
        impliedProbPct: null,
        edgePct: null,
        overOddAtPrediction: "1.920",
        underOddAtPrediction: "1.920",
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
      },
      { costUsd: "0.011" },
      threeHoursLater,
    );

    expect(view).toEqual({
      kind: "PASS",
      // pass não tem aposta → recommendation null; mas os outcomes (probs/edges
      // neutros do par congelado) ainda são expostos, nenhum recomendado.
      recommendation: null,
      outcomes: [
        {
          id: "over",
          label: "Over 2.5",
          modelProb: "53%",
          marketProb: "50%",
          odd: "1.92",
          edge: "+3.0pp",
          expectedReturn: "+1.8%",
          breakEven: "1.89",
          isRecommended: false,
        },
        {
          id: "under",
          label: "Under 2.5",
          modelProb: "47%",
          marketProb: "50%",
          odd: "1.92",
          edge: "-3.0pp",
          expectedReturn: "-9.8%",
          breakEven: "2.13",
          isRecommended: false,
        },
      ],
      minOdd: null,
      betSummary: null,
      oddAtRec: null,
      oddAtRecAgo: null,
      bookmaker: null,
      expectedReturn: null,
      expectedReturnTone: "neutral",
      evLegend: null,
      minEdgeLabel: "5pp",
      scenarios: {
        // Implied recomputada do par congelado (odds iguais → 50/50);
        // edges = modelProb − implied; EV à mão: 0.53 × 1.92 − 1 = +0.0176.
        over: {
          modelProb: "53%",
          marketProb: "50%",
          odd: "1.92",
          edge: "+3.0pp",
          expectedReturn: "+1.8%",
          modelBreakEvenOdd: "1.89",
        },
        under: {
          modelProb: "47%",
          marketProb: "50%",
          odd: "1.92",
          edge: "-3.0pp",
          expectedReturn: "-9.8%",
          modelBreakEvenOdd: "2.13",
        },
        recommended: null,
        framing:
          "vantagens pequenas (abaixo de 5pp) ficam dentro da margem de erro do modelo — por isso não há recomendação",
        note: null,
      },
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
        impliedProbPct: "50.70",
        edgePct: "7.30",
        overOddAtPrediction: null,
        underOddAtPrediction: null,
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.0",
        createdAt: baseCreatedAt,
      },
      null,
      new Date(2026, 4, 21, 14, 22),
    );

    expect(view).toEqual({
      kind: "OVER",
      recommendation: {
        marketKey: "over_under",
        marketLabel: "Over/Under gols",
        selectionKey: "over",
        selectionLabel: "Over",
        line: 2.5,
      },
      // Histórica sem par congelado: odd/EV degradam pra "—" (igual ao bloco
      // scenarios); modelProb/edge/breakEven sobrevivem dos valores salvos.
      outcomes: [
        {
          id: "over",
          label: "Over 2.5",
          modelProb: "58%",
          marketProb: "50.7%",
          odd: "—",
          edge: "+7.3pp",
          expectedReturn: "—",
          breakEven: "1.72",
          isRecommended: true,
        },
        {
          id: "under",
          label: "Under 2.5",
          modelProb: "42%",
          marketProb: "49.3%",
          odd: "—",
          edge: "-7.3pp",
          expectedReturn: "—",
          breakEven: "2.38",
          isRecommended: false,
        },
      ],
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
      // retorno "—" não ganha legenda — não explicar número que não existe.
      evLegend: null,
      minEdgeLabel: "5pp",
      scenarios: {
        // Sem odd salva nem par congelado: probs/edge sobrevivem dos salvos;
        // odd/EV viram "—"; modelBreakEvenOdd sempre derivável.
        over: {
          modelProb: "58%",
          marketProb: "50.7%",
          odd: "—",
          edge: "+7.3pp",
          expectedReturn: "—",
          modelBreakEvenOdd: "1.72",
        },
        under: {
          modelProb: "42%",
          marketProb: "49.3%",
          odd: "—",
          edge: "-7.3pp",
          expectedReturn: "—",
          modelBreakEvenOdd: "2.38",
        },
        recommended: "over",
        framing: null,
        note: "odds do outro lado não registradas nesta análise",
      },
      rationale: "old",
      factors: ["a"],
      generatedAt: "19 mai · 14:22",
      promptVersion: "over_under_v1.0",
      model: "claude-sonnet-4.5",
      costUsd: "$0.000",
    });
  });

  it("historical non-pass without the frozen pair: recommended side complete, zebra degraded with note", () => {
    const view = toAnalysisView(
      {
        recommendation: "over",
        confidencePct: "58.00",
        rationale: "old",
        keyFactors: ["a"],
        minimumOdd: "1.750",
        oddAtRecommendation: "1.920",
        bookmaker: "bet365",
        impliedProbPct: "50.70",
        edgePct: "7.30",
        overOddAtPrediction: null,
        underOddAtPrediction: null,
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.2",
        createdAt: baseCreatedAt,
      },
      null,
      threeHoursLater,
    );

    expect(view.scenarios).toEqual({
      // Lado recomendado completo via valores salvos da row (odd, implied,
      // edge) + retorno/break-even computados de oddAtRecommendation.
      over: {
        modelProb: "58%",
        marketProb: "50.7%",
        odd: "1.92",
        edge: "+7.3pp",
        expectedReturn: "+11.4%",
        modelBreakEvenOdd: "1.72",
      },
      // Zebra: probs/edge derivados (100 − x, −edge) + odd de equilíbrio do
      // modelo; odd/EV congelados não registrados → "—". Nunca usar o
      // snapshot vivo como substituto.
      under: {
        modelProb: "42%",
        marketProb: "49.3%",
        odd: "—",
        edge: "-7.3pp",
        expectedReturn: "—",
        modelBreakEvenOdd: "2.38",
      },
      recommended: "over",
      framing: null,
      note: "odds do outro lado não registradas nesta análise",
    });
  });

  it("historical pass: model probs + model break-even odds on both sides, everything else em-dash", () => {
    const view = toAnalysisView(
      {
        recommendation: "pass",
        confidencePct: "51.00",
        rationale: "no edge",
        keyFactors: ["a"],
        minimumOdd: null,
        oddAtRecommendation: null,
        bookmaker: null,
        impliedProbPct: null,
        edgePct: null,
        overOddAtPrediction: null,
        underOddAtPrediction: null,
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.0",
        createdAt: baseCreatedAt,
      },
      null,
      threeHoursLater,
    );

    expect(view.scenarios).toEqual({
      over: {
        modelProb: "51%",
        marketProb: "—",
        odd: "—",
        edge: "—",
        expectedReturn: "—",
        modelBreakEvenOdd: "1.96",
      },
      under: {
        modelProb: "49%",
        marketProb: "—",
        odd: "—",
        edge: "—",
        expectedReturn: "—",
        modelBreakEvenOdd: "2.04",
      },
      recommended: null,
      framing:
        "vantagens pequenas (abaixo de 5pp) ficam dentro da margem de erro do modelo — por isso não há recomendação",
      note: null,
    });
  });

  it("warns when minimumOdd is above the odd frozen at recommendation", () => {
    const view = toAnalysisView(
      {
        recommendation: "over",
        confidencePct: "58.00",
        rationale: "blah",
        keyFactors: ["a"],
        minimumOdd: "2.050",
        oddAtRecommendation: "1.920",
        bookmaker: "bet365",
        impliedProbPct: "50.70",
        edgePct: "7.30",
        overOddAtPrediction: "1.920",
        underOddAtPrediction: "1.950",
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

  it("compares minimumOdd and oddAtRecommendation numerically, never lexicographically", () => {
    // Strings do numeric do Drizzle: "10.000" < "9.000" lexicograficamente,
    // mas 10 > 9 numericamente → o aviso DEVE disparar.
    const warned = toAnalysisView(
      {
        recommendation: "over",
        confidencePct: "58.00",
        rationale: "blah",
        keyFactors: ["a"],
        minimumOdd: "10.000",
        oddAtRecommendation: "9.000",
        bookmaker: "bet365",
        impliedProbPct: null,
        edgePct: "7.30",
        overOddAtPrediction: null,
        underOddAtPrediction: null,
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
      },
      null,
      threeHoursLater,
    );
    expect(warned.expectedReturnTone).toBe("neutral");
    expect(warned.evLegend).toBe(
      "a odd registrada na análise (9.00) estava abaixo da mínima sugerida (10.00) — só vale a pena se a odd subir para ≥ 10.00",
    );

    // Inverso: "9.000" > "10.000" lexicograficamente, mas 9 < 10 → SEM aviso.
    const ok = toAnalysisView(
      {
        recommendation: "over",
        confidencePct: "58.00",
        rationale: "blah",
        keyFactors: ["a"],
        minimumOdd: "9.000",
        oddAtRecommendation: "10.000",
        bookmaker: "bet365",
        impliedProbPct: null,
        edgePct: "7.30",
        overOddAtPrediction: null,
        underOddAtPrediction: null,
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
      },
      null,
      threeHoursLater,
    );
    expect(ok.expectedReturnTone).toBe("positive");
    expect(ok.evLegend).toBe(
      "ganho médio por aposta, no longo prazo, se a estimativa de 58% do modelo estiver certa",
    );
  });

  it("does not warn when minimumOdd exceeds the frozen odd only past display precision", () => {
    // 1.923 > 1.920 cru, mas ambos exibem "1.92" — o aviso mostraria dois
    // números iguais declarados desiguais. EV à mão: 0.58 × 1.92 − 1 = +0.1136.
    const view = toAnalysisView(
      {
        recommendation: "over",
        confidencePct: "58.00",
        rationale: "blah",
        keyFactors: ["a"],
        minimumOdd: "1.923",
        oddAtRecommendation: "1.920",
        bookmaker: "bet365",
        impliedProbPct: null,
        edgePct: "7.30",
        overOddAtPrediction: null,
        underOddAtPrediction: null,
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
      },
      null,
      threeHoursLater,
    );
    expect(view.expectedReturn).toBe("+11.4%");
    expect(view.expectedReturnTone).toBe("positive");
    expect(view.evLegend).toBe(
      "ganho médio por aposta, no longo prazo, se a estimativa de 58% do modelo estiver certa",
    );
  });

  it("keeps neutral tone when a positive EV rounds to 0.0% at display precision", () => {
    // EV à mão: 0.61 × 1.64 − 1 = +0.0004 → exibe "0.0%"; verde aqui afirmaria
    // direção que o número não mostra.
    const view = toAnalysisView(
      {
        recommendation: "over",
        confidencePct: "61.00",
        rationale: "blah",
        keyFactors: ["a"],
        minimumOdd: "1.600",
        oddAtRecommendation: "1.640",
        bookmaker: "bet365",
        impliedProbPct: null,
        edgePct: "5.10",
        overOddAtPrediction: null,
        underOddAtPrediction: null,
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
      },
      null,
      threeHoursLater,
    );
    expect(view.expectedReturn).toBe("0.0%");
    expect(view.expectedReturnTone).toBe("neutral");
    expect(view.evLegend).toBe(
      "ganho médio por aposta, no longo prazo, se a estimativa de 61% do modelo estiver certa",
    );
  });

  it("labels a just-created prediction as 'há menos de 1min', never 'agora'", () => {
    // Caminho mais comum: análise recém-gerada renderizada na hora — copy de
    // valor congelado nunca afirma atualidade (ADR 0012, decisão 2).
    const view = toAnalysisView(
      {
        recommendation: "over",
        confidencePct: "58.00",
        rationale: "blah",
        keyFactors: ["a"],
        minimumOdd: "1.750",
        oddAtRecommendation: "1.920",
        bookmaker: "bet365",
        impliedProbPct: "50.70",
        edgePct: "7.30",
        overOddAtPrediction: "1.920",
        underOddAtPrediction: "1.950",
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
      },
      null,
      baseCreatedAt,
    );
    expect(view.oddAtRecAgo).toBe("há menos de 1min");
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
        impliedProbPct: "50.00",
        edgePct: "5.00",
        overOddAtPrediction: "1.802",
        underOddAtPrediction: "1.802",
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

  it("degrades the whole scenarios block to null on out-of-domain confidence (defensive)", () => {
    const view = toAnalysisView(
      {
        recommendation: "over",
        confidencePct: "100.00",
        rationale: "degenerate",
        keyFactors: ["a"],
        minimumOdd: "1.750",
        oddAtRecommendation: "1.920",
        bookmaker: "bet365",
        impliedProbPct: "50.70",
        edgePct: "7.30",
        overOddAtPrediction: "1.920",
        underOddAtPrediction: "1.950",
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
      },
      null,
      threeHoursLater,
    );
    expect(view.scenarios).toBeNull();
    // Bloco degradado → sem outcomes (o array acompanha o scenarios null).
    expect(view.outcomes).toEqual([]);
  });
});

// Caminho N-vias canônico (ADR 0018) exercitado por fixture mock ANTES da
// ativação de mercados N≥3 no backend (Fase 4 / #173): toOutcomesView consome
// computeMarketScenarios (puro, sem DB/catálogo) + a apresentação do mercado.
describe("toOutcomesView (N-vias)", () => {
  it("1X2 (match_result): produz 3 outcomes a partir de um fixture mock", () => {
    const result = computeMarketScenarios({
      selections: [
        { key: "home", modelProbPct: 50, odd: 2.1 },
        { key: "draw", modelProbPct: 27, odd: 3.4 },
        { key: "away", modelProbPct: 23, odd: 3.6 },
      ],
      recommendedKey: "home",
    });

    const outcomes = toOutcomesView(
      result,
      getMarketPresentation("match_result"),
      null,
    );

    expect(outcomes).toHaveLength(3);
    expect(outcomes.map((o) => o.id)).toEqual(["home", "draw", "away"]);
    // Labels vêm da apresentação do mercado (sem linha → só o label da seleção).
    expect(outcomes.map((o) => o.label)).toEqual(["Casa", "Empate", "Fora"]);
    expect(outcomes.map((o) => o.isRecommended)).toEqual([true, false, false]);
    // Valores EXATOS do caminho N-vias (pina a fórmula edge/EV/break-even + o
    // sufixo "pp", não só não-degradação). overround = Σ(1/odd) = 1.04809;
    // home: implícita 0.47619/1.04809 = 45.4%; edge 50−45.4 = +4.6pp;
    // EV 0.50×2.10−1 = +5.0%; breakEven = 100/50 = 2.00.
    expect(outcomes[0].modelProb).toBe("50%");
    expect(outcomes[0].odd).toBe("2.10");
    expect(outcomes[0].marketProb).toBe("45.4%");
    expect(outcomes[0].edge).toBe("+4.6pp");
    expect(outcomes[0].expectedReturn).toBe("+5.0%");
    expect(outcomes[0].breakEven).toBe("2.00");
    // draw/away (não recomendados): fecha a normalização do overround (Σ = 100%).
    expect(outcomes[1].marketProb).toBe("28.1%");
    expect(outcomes[2].marketProb).toBe("26.5%");
  });
});
