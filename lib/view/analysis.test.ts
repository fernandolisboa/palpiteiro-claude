import { describe, expect, it } from "vitest";

import type {
  DbPrediction,
  PredictionWithAiCall,
} from "@/lib/db/queries/predictions";
import { computeMarketScenarios } from "@/lib/odds/scenario";

import {
  toAnalysisView,
  toMarketAnalysisSections,
  toOutcomesView,
  toPreviousAnalysisItems,
} from "./analysis";
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
        selections: [
          { key: "over", modelProbPct: 0, odd: 1.92 },
          { key: "under", modelProbPct: 0, odd: 1.95 },
        ],
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
      },
      { costUsd: "0.014000" },
      threeHoursLater,
    );

    // EV à mão: 0.58 × 1.92 − 1 = +0.1136 → "+11.4%"
    expect(view).toEqual({
      recommendation: {
        marketKey: "over_under",
        marketLabel: "Over/Under gols",
        selectionKey: "over",
        selectionLabel: "Over",
        line: 2.5,
        betSummary: {
          market: "Mais de 2.5 gols",
          plain: "pelo menos 3 gols no jogo",
        },
      },
      // outcomes espelham byte-a-byte as células do bloco de cenários (mesmo
      // computeScenarios, mesmos formatters); breakEven = modelBreakEvenOdd.
      // scenarioLabel = rótulo leigo da coluna (paridade VISUAL, verbatim).
      outcomes: [
        {
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
        },
        {
          id: "under",
          label: "Under 2.5",
          scenarioLabel: "menos de 2.5 gols",
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
      // input sem stakeUnits → null (a page/action ligam as call sites).
      stakeUnits: null,
      // framing/note no topo (R4): break-even da zebra (100/1.95 = 51.3%) —
      // string idêntica à pré-relocação.
      framing:
        "a aposta em menos de 3 gols só sai do zero se a chance real for maior que 51.3% — na análise o modelo estimou 42%",
      note: null,
      oddAtRec: "1.92",
      oddAtRecAgo: "há 3h",
      bookmaker: "bet365",
      expectedReturn: "+11.4%",
      expectedReturnTone: "positive",
      evLegend:
        "ganho médio por aposta, no longo prazo, se a estimativa de 58% do modelo estiver certa",
      minEdgeLabel: "5pp",
      minEdgePp: 5,
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
        selections: [
          { key: "over", modelProbPct: 0, odd: 1.98 },
          { key: "under", modelProbPct: 0, odd: 1.85 },
        ],
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
      },
      null,
      new Date(2026, 4, 19, 16, 22),
    );

    // EV à mão: 0.56 × 1.85 − 1 = +0.036 → "+3.6%"
    expect(view).toEqual({
      recommendation: {
        marketKey: "over_under",
        marketLabel: "Over/Under gols",
        selectionKey: "under",
        selectionLabel: "Under",
        line: 2.5,
        betSummary: {
          market: "Menos de 2.5 gols",
          plain: "no máximo 2 gols no jogo",
        },
      },
      outcomes: [
        {
          id: "over",
          label: "Over 2.5",
          scenarioLabel: "mais de 2.5 gols",
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
          scenarioLabel: "menos de 2.5 gols",
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
      stakeUnits: null,
      // Break-even da zebra (over): 100/1.98 = 50.5%.
      framing:
        "a aposta em pelo menos 3 gols só sai do zero se a chance real for maior que 50.5% — na análise o modelo estimou 44%",
      note: null,
      oddAtRec: "1.85",
      oddAtRecAgo: "há 2h",
      bookmaker: "pinnacle",
      expectedReturn: "+3.6%",
      expectedReturnTone: "positive",
      evLegend:
        "ganho médio por aposta, no longo prazo, se a estimativa de 56% do modelo estiver certa",
      minEdgeLabel: "5pp",
      minEdgePp: 5,
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
        selections: [
          { key: "over", modelProbPct: 0, odd: 1.92 },
          { key: "under", modelProbPct: 0, odd: 1.92 },
        ],
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
      },
      { costUsd: "0.011" },
      threeHoursLater,
    );

    expect(view).toEqual({
      // pass não tem aposta → recommendation null; mas os outcomes (probs/edges
      // neutros do par congelado) ainda são expostos, nenhum recomendado.
      recommendation: null,
      outcomes: [
        {
          id: "over",
          label: "Over 2.5",
          scenarioLabel: "mais de 2.5 gols",
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
          scenarioLabel: "menos de 2.5 gols",
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
      stakeUnits: null,
      // pass: copy de margem de erro (cobre EV positivo sob veredito de não apostar).
      framing:
        "vantagens pequenas (abaixo de 5pp) ficam dentro da margem de erro do modelo — por isso não há recomendação",
      note: null,
      oddAtRec: null,
      oddAtRecAgo: null,
      bookmaker: null,
      expectedReturn: null,
      expectedReturnTone: "neutral",
      evLegend: null,
      minEdgeLabel: "5pp",
      minEdgePp: 5,
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
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.0",
        createdAt: baseCreatedAt,
      },
      null,
      new Date(2026, 4, 21, 14, 22),
    );

    expect(view).toEqual({
      recommendation: {
        marketKey: "over_under",
        marketLabel: "Over/Under gols",
        selectionKey: "over",
        selectionLabel: "Over",
        line: 2.5,
        betSummary: {
          market: "Mais de 2.5 gols",
          plain: "pelo menos 3 gols no jogo",
        },
      },
      // Histórica sem par congelado: odd/EV degradam pra "—"; modelProb/edge/
      // breakEven sobrevivem dos valores salvos.
      outcomes: [
        {
          id: "over",
          label: "Over 2.5",
          scenarioLabel: "mais de 2.5 gols",
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
          scenarioLabel: "menos de 2.5 gols",
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
      stakeUnits: null,
      // Zebra sem odd registrada: framing não-derivável → null; nota de degradação.
      framing: null,
      note: "odds do outro lado não registradas nesta análise",
      oddAtRec: "—",
      oddAtRecAgo: "há 2d",
      bookmaker: null,
      expectedReturn: "—",
      expectedReturnTone: "neutral",
      // retorno "—" não ganha legenda — não explicar número que não existe.
      evLegend: null,
      minEdgeLabel: "5pp",
      minEdgePp: 5,
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
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.2",
        createdAt: baseCreatedAt,
      },
      null,
      threeHoursLater,
    );

    // Cenários agora vivem em `outcomes` (forma N-vias). Lado recomendado
    // completo via valores salvos da row; zebra com odd/EV "—" (par não
    // registrado) mas probs/edge/break-even derivados. framing/note no topo.
    expect(view.outcomes).toEqual([
      {
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
      },
      {
        id: "under",
        label: "Under 2.5",
        scenarioLabel: "menos de 2.5 gols",
        modelProb: "42%",
        marketProb: "49.3%",
        odd: "—",
        edge: "-7.3pp",
        expectedReturn: "—",
        breakEven: "2.38",
        isRecommended: false,
      },
    ]);
    expect(view.framing).toBeNull();
    expect(view.note).toBe("odds do outro lado não registradas nesta análise");
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
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.0",
        createdAt: baseCreatedAt,
      },
      null,
      threeHoursLater,
    );

    expect(view.outcomes).toEqual([
      {
        id: "over",
        label: "Over 2.5",
        scenarioLabel: "mais de 2.5 gols",
        modelProb: "51%",
        marketProb: "—",
        odd: "—",
        edge: "—",
        expectedReturn: "—",
        breakEven: "1.96",
        isRecommended: false,
      },
      {
        id: "under",
        label: "Under 2.5",
        scenarioLabel: "menos de 2.5 gols",
        modelProb: "49%",
        marketProb: "—",
        odd: "—",
        edge: "—",
        expectedReturn: "—",
        breakEven: "2.04",
        isRecommended: false,
      },
    ]);
    expect(view.framing).toBe(
      "vantagens pequenas (abaixo de 5pp) ficam dentro da margem de erro do modelo — por isso não há recomendação",
    );
    expect(view.note).toBeNull();
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
        selections: [
          { key: "over", modelProbPct: 0, odd: 1.92 },
          { key: "under", modelProbPct: 0, odd: 1.95 },
        ],
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
        selections: [
          { key: "over", modelProbPct: 0, odd: 1.92 },
          { key: "under", modelProbPct: 0, odd: 1.95 },
        ],
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
        selections: [
          { key: "over", modelProbPct: 0, odd: 1.802 },
          { key: "under", modelProbPct: 0, odd: 1.802 },
        ],
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

  it("degrades the whole scenarios block (outcomes empty, framing/note null) on out-of-domain confidence (defensive)", () => {
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
        selections: [
          { key: "over", modelProbPct: 0, odd: 1.92 },
          { key: "under", modelProbPct: 0, odd: 1.95 },
        ],
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
      },
      null,
      threeHoursLater,
    );
    // Bloco degradado → outcomes vazio, framing/note null (acompanham o
    // cenário binário null).
    expect(view.outcomes).toEqual([]);
    expect(view.framing).toBeNull();
    expect(view.note).toBeNull();
  });

  it("formats stakeUnits via the dashboard convention (no sign, '1.00 u') — R3", () => {
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
        selections: [
          { key: "over", modelProbPct: 0, odd: 1.92 },
          { key: "under", modelProbPct: 0, odd: 1.95 },
        ],
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
        // numeric do Drizzle chega como string.
        stakeUnits: "1",
      },
      null,
      threeHoursLater,
    );
    // SEM sinal (convenção do drill-down do dashboard), 2 casas.
    expect(view.stakeUnits).toBe("1.00 u");

    // pass não tem aposta → stakeUnits null mesmo com input.
    const pass = toAnalysisView(
      {
        recommendation: "pass",
        confidencePct: "53.00",
        rationale: "no edge",
        keyFactors: ["a"],
        minimumOdd: null,
        oddAtRecommendation: null,
        bookmaker: null,
        impliedProbPct: null,
        edgePct: null,
        selections: [
          { key: "over", modelProbPct: 0, odd: 1.92 },
          { key: "under", modelProbPct: 0, odd: 1.92 },
        ],
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
        stakeUnits: "1.5",
      },
      null,
      threeHoursLater,
    );
    expect(pass.stakeUnits).toBeNull();
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

// Ramificação N-vias do toAnalysisView (§F, #173): com um candidate set de >2
// seleções, os outcomes saem do caminho N-vias canônico (computeMarketScenarios),
// NÃO do scenario binário — o GATE que mantém 1X2 fora do computeScenarios.
describe("toAnalysisView (N-vias / 1X2)", () => {
  it("3 seleções (match_result) → 3 outcomes via o caminho N-vias, sem framing binário", () => {
    const view = toAnalysisView(
      {
        recommendation: "home",
        confidencePct: "50.00",
        rationale: "casa forte",
        keyFactors: ["a", "b"],
        minimumOdd: "2.000",
        oddAtRecommendation: "2.100",
        bookmaker: "bet365",
        impliedProbPct: "45.40",
        edgePct: "4.60",
        // colunas binárias over/under NULL (1X2 não carrega o par congelado).
        modelVersion: "claude-opus-4-8",
        promptVersion: "match_result_v1",
        createdAt: baseCreatedAt,
        marketKey: "match_result",
        line: null,
        stakeUnits: "1",
        // Candidate set N-vias (3 seleções) → dispara o branch N-vias.
        selections: [
          { key: "home", modelProbPct: 50, odd: 2.1 },
          { key: "draw", modelProbPct: 27, odd: 3.4 },
          { key: "away", modelProbPct: 23, odd: 3.6 },
        ],
      },
      { costUsd: "0.05" },
      threeHoursLater,
    );

    // 3 colunas, na ordem do candidate set, com labels da apresentação 1X2 e a
    // recomendação marcada em "home" (selectionKey, não derivação binária).
    expect(view.outcomes).toHaveLength(3);
    expect(view.outcomes.map((o) => o.id)).toEqual(["home", "draw", "away"]);
    expect(view.outcomes.map((o) => o.label)).toEqual(["Casa", "Empate", "Fora"]);
    expect(view.outcomes.map((o) => o.isRecommended)).toEqual([
      true,
      false,
      false,
    ]);
    // Valores N-vias pinados (mesma fórmula do toOutcomesView): home edge +4.6pp.
    expect(view.outcomes[0].modelProb).toBe("50%");
    expect(view.outcomes[0].marketProb).toBe("45.4%");
    expect(view.outcomes[0].edge).toBe("+4.6pp");

    // Bloco de recomendação usa a apresentação 1X2 (sem linha).
    expect(view.recommendation).not.toBeNull();
    expect(view.recommendation?.marketKey).toBe("match_result");
    expect(view.recommendation?.selectionKey).toBe("home");
    expect(view.recommendation?.selectionLabel).toBe("Casa");
    expect(view.recommendation?.line).toBeNull();

    // N-vias não tem o framing de break-even da zebra binária (R4) → null.
    expect(view.framing).toBeNull();
    expect(view.note).toBeNull();
  });

  it("pass em 1X2 (3 seleções) → outcomes sem coluna recomendada", () => {
    const view = toAnalysisView(
      {
        recommendation: "pass",
        confidencePct: "40.00",
        rationale: "sem edge",
        keyFactors: ["a"],
        minimumOdd: null,
        oddAtRecommendation: null,
        bookmaker: null,
        impliedProbPct: null,
        edgePct: null,
        modelVersion: "claude-opus-4-8",
        promptVersion: "match_result_v1",
        createdAt: baseCreatedAt,
        marketKey: "match_result",
        line: null,
        selections: [
          { key: "home", modelProbPct: 40, odd: 2.5 },
          { key: "draw", modelProbPct: 30, odd: 3.2 },
          { key: "away", modelProbPct: 30, odd: 3.0 },
        ],
      },
      null,
      threeHoursLater,
    );

    // pass → sem aposta recomendada e nenhuma coluna destacada (recommendedKey null).
    expect(view.recommendation).toBeNull();
    expect(view.outcomes).toHaveLength(3);
    expect(view.outcomes.every((o) => !o.isRecommended)).toBe(true);
    expect(view.framing).toBeNull();
  });

  it("uma seleção com prob 0 (schema-válida / row reaberta) NÃO derruba a view; breakEven dela vira '—'", () => {
    // MatchResultOutputSchema permite prob 0, e uma row reaberta com model_prob_pct
    // null coalesce pra 0 no boundary (predictions.ts). computeModelBreakEvenOdd
    // lançaria em 100/0 — o branch N-vias precisa degradar a coluna, não derrubar
    // o render (post-analysis e reabertura na match-page).
    expect(() =>
      toAnalysisView(
        {
          recommendation: "home",
          confidencePct: "60.00",
          rationale: "casa forte",
          keyFactors: ["a"],
          minimumOdd: "1.700",
          oddAtRecommendation: "1.800",
          bookmaker: "bet365",
          impliedProbPct: "55.00",
          edgePct: "5.00",
          modelVersion: "claude-opus-4-8",
          promptVersion: "match_result_v1",
          createdAt: baseCreatedAt,
          marketKey: "match_result",
          line: null,
          selections: [
            { key: "home", modelProbPct: 60, odd: 1.8 },
            { key: "draw", modelProbPct: 40, odd: 3.0 },
            { key: "away", modelProbPct: 0, odd: 9.0 },
          ],
        },
        { costUsd: "0.05" },
        threeHoursLater,
      ),
    ).not.toThrow();

    const view = toAnalysisView(
      {
        recommendation: "home",
        confidencePct: "60.00",
        rationale: "casa forte",
        keyFactors: ["a"],
        minimumOdd: "1.700",
        oddAtRecommendation: "1.800",
        bookmaker: "bet365",
        impliedProbPct: "55.00",
        edgePct: "5.00",
        modelVersion: "claude-opus-4-8",
        promptVersion: "match_result_v1",
        createdAt: baseCreatedAt,
        marketKey: "match_result",
        line: null,
        selections: [
          { key: "home", modelProbPct: 60, odd: 1.8 },
          { key: "draw", modelProbPct: 40, odd: 3.0 },
          { key: "away", modelProbPct: 0, odd: 9.0 },
        ],
      },
      { costUsd: "0.05" },
      threeHoursLater,
    );

    // 3 colunas retornadas (sem crash); a seleção de prob 0 mostra breakEven "—".
    expect(view.outcomes).toHaveLength(3);
    expect(view.outcomes.map((o) => o.id)).toEqual(["home", "draw", "away"]);
    expect(view.outcomes[2].modelProb).toBe("0%");
    expect(view.outcomes[2].breakEven).toBe("—");
    // As outras seleções seguem com breakEven derivado.
    expect(view.outcomes[0].breakEven).not.toBe("—");
    expect(view.outcomes[1].breakEven).not.toBe("—");
  });
});

// btts é N=2 (yes/no) MAS roteia pelo caminho N-vias canônico — não pelo binário
// congelado over/under. O predicado é IDENTIDADE (marketKey), não length: over_under
// e btts são ambos length-2, então só a identidade os distingue.
describe("toAnalysisView (N-vias / btts)", () => {
  it("2 seleções (btts) → 2 outcomes via o caminho N-vias com labels Sim/Não", () => {
    const view = toAnalysisView(
      {
        recommendation: "yes",
        confidencePct: "60.00",
        rationale: "ambos marcam",
        keyFactors: ["a", "b"],
        minimumOdd: "1.700",
        oddAtRecommendation: "2.000",
        bookmaker: "Pinnacle",
        impliedProbPct: "50.00",
        edgePct: "10.00",
        // colunas binárias over/under NULL (btts não carrega o par congelado).
        modelVersion: "claude-opus-4-8",
        promptVersion: "btts_v1",
        createdAt: baseCreatedAt,
        marketKey: "btts",
        line: null,
        stakeUnits: "1",
        // Candidate set N=2; mercado 100% (odds 2.0/2.0) → implícita 50/50.
        selections: [
          { key: "yes", modelProbPct: 60, odd: 2.0 },
          { key: "no", modelProbPct: 40, odd: 2.0 },
        ],
      },
      { costUsd: "0.05" },
      threeHoursLater,
    );

    // 2 colunas yes/no via N-vias (NÃO over/under do caminho binário congelado).
    expect(view.outcomes).toHaveLength(2);
    expect(view.outcomes.map((o) => o.id)).toEqual(["yes", "no"]);
    expect(view.outcomes.map((o) => o.label)).toEqual(["Sim", "Não"]);
    expect(view.outcomes.map((o) => o.isRecommended)).toEqual([true, false]);
    // Valores N-vias pinados: yes modelProb 60, implícita 50, edge +10.0pp.
    expect(view.outcomes[0].modelProb).toBe("60%");
    expect(view.outcomes[0].marketProb).toBe("50%");
    expect(view.outcomes[0].edge).toBe("+10.0pp");
    expect(view.outcomes[1].modelProb).toBe("40%");

    // Bloco de recomendação usa a apresentação btts (sem linha) + sub-linha leiga.
    expect(view.recommendation).not.toBeNull();
    expect(view.recommendation?.marketKey).toBe("btts");
    expect(view.recommendation?.marketLabel).toBe("Ambas marcam");
    expect(view.recommendation?.selectionKey).toBe("yes");
    expect(view.recommendation?.selectionLabel).toBe("Sim");
    expect(view.recommendation?.line).toBeNull();
    expect(view.recommendation?.betSummary).toEqual({
      market: "Ambos os times marcam",
      plain: "os dois times marcam no jogo",
    });

    // N-vias não tem o framing de break-even da zebra binária → null.
    expect(view.framing).toBeNull();
    expect(view.note).toBeNull();
  });

  it("pass em btts → 2 outcomes sem coluna recomendada", () => {
    const view = toAnalysisView(
      {
        recommendation: "pass",
        confidencePct: "48.00",
        rationale: "sem edge",
        keyFactors: ["a"],
        minimumOdd: null,
        oddAtRecommendation: null,
        bookmaker: null,
        impliedProbPct: null,
        edgePct: null,
        modelVersion: "claude-opus-4-8",
        promptVersion: "btts_v1",
        createdAt: baseCreatedAt,
        marketKey: "btts",
        line: null,
        selections: [
          { key: "yes", modelProbPct: 48, odd: 2.0 },
          { key: "no", modelProbPct: 52, odd: 2.0 },
        ],
      },
      null,
      threeHoursLater,
    );

    expect(view.recommendation).toBeNull();
    expect(view.outcomes).toHaveLength(2);
    expect(view.outcomes.map((o) => o.id)).toEqual(["yes", "no"]);
    expect(view.outcomes.every((o) => !o.isRecommended)).toBe(true);
    expect(view.framing).toBeNull();
  });
});

// REGRESSÃO de identidade: over_under com marketKey "over_under" E um candidate set
// length-2 AINDA roteia pelo caminho binário CONGELADO (over/under), não N-vias —
// prova que a IDENTIDADE governa o roteamento, não o length (que não distingue
// over_under de btts, ambos N=2).
describe("toAnalysisView — over_under stays frozen by identity (not length)", () => {
  it("over_under com 2 selections → outcomes over/under do caminho binário, não N-vias", () => {
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
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v2.0",
        createdAt: baseCreatedAt,
        marketKey: "over_under",
        line: 2.5,
        // Mesmo com um candidate set length-2 presente, a identidade over_under
        // mantém o caminho binário congelado (não vira yes/no nem N-vias). O par
        // over/under congelado vem DAQUI (PSO) — não mais do par legado.
        selections: [
          { key: "over", modelProbPct: 58, odd: 1.92 },
          { key: "under", modelProbPct: 42, odd: 1.95 },
        ],
      },
      { costUsd: "0.014000" },
      threeHoursLater,
    );

    // Outcomes over/under (caminho binário congelado), com a linha 2.5 no label —
    // NÃO os ids/labels do caminho N-vias.
    expect(view.outcomes.map((o) => o.id)).toEqual(["over", "under"]);
    expect(view.outcomes.map((o) => o.label)).toEqual(["Over 2.5", "Under 2.5"]);
    expect(view.outcomes[0].scenarioLabel).toBe("mais de 2.5 gols");
    // framing binário da zebra presente (exclusivo do caminho congelado).
    expect(view.framing).not.toBeNull();
  });
});

// Loop fechado do plan-gate: o edge EXIBIDO na grade de dupla chance deve casar
// com o PERSISTIDO pelo predict — ambos usam o de-vig Σ=2 (impliedSumTarget=2 do
// descriptor). A view re-deriva a implícita das odds via computeMarketScenarios;
// sem o impliedSumTarget threadado, exibiria Σ=1 (~37.5%) e um edge ~+46.5pp,
// divergindo do salvo. Mesmas odds/probs do predict.double-chance.test.ts.
describe("toAnalysisView (N-vias / dupla chance) — edge da grade == edge persistido", () => {
  it("usa o de-vig Σ=2 (não Σ=1) na implícita/edge exibidos", () => {
    const view = toAnalysisView(
      {
        recommendation: "home_or_draw",
        confidencePct: "84.00",
        rationale: "favorito não perde",
        keyFactors: ["a", "b"],
        minimumOdd: "1.200",
        oddAtRecommendation: "1.270",
        bookmaker: "Pinnacle",
        // edgePct PERSISTIDO (predict, de-vig Σ=2): 84 − 74.96 ≈ 9.04 → "+9.0pp".
        impliedProbPct: "74.96",
        edgePct: "9.04",
        modelVersion: "claude-opus-4-8",
        promptVersion: "double_chance_v1",
        createdAt: baseCreatedAt,
        marketKey: "double_chance",
        line: null,
        stakeUnits: "1",
        selections: [
          { key: "home_or_draw", modelProbPct: 84, odd: 1.27 },
          { key: "away_or_draw", modelProbPct: 58, odd: 1.73 },
          { key: "home_or_away", modelProbPct: 70, odd: 1.36 },
        ],
      },
      { costUsd: "0.05" },
      threeHoursLater,
    );

    expect(view.outcomes.map((o) => o.id)).toEqual([
      "home_or_draw",
      "away_or_draw",
      "home_or_away",
    ]);
    expect(view.outcomes.map((o) => o.label)).toEqual([
      "Casa ou empate",
      "Empate ou fora",
      "Casa ou fora",
    ]);
    // de-vig Σ=2: implícita ~75% (NÃO ~37.5% de Σ=1) → edge +9.0pp (== persistido).
    expect(view.outcomes[0].marketProb).toBe("75%");
    expect(view.outcomes[0].edge).toBe("+9.0pp");
    expect(view.outcomes[0].isRecommended).toBe(true);
    expect(view.recommendation?.marketKey).toBe("double_chance");
    expect(view.recommendation?.selectionLabel).toBe("Casa ou empate");
  });
});

describe("toPreviousAnalysisItems", () => {
  // Row mínima: só os campos lidos pelo mapper. Cast pontual pra não montar a
  // DbPrediction inteira num teste de slicing/rotulagem (o mapeamento de view tem
  // cobertura própria em toAnalysisView acima). recommendation "pass" mantém a row
  // leve (a view de pass não precisa de odds/selections).
  function mkRow(o: {
    id: string;
    marketKey: string | null;
    createdAt: Date;
  }): PredictionWithAiCall {
    return {
      prediction: {
        id: o.id,
        recommendation: "pass",
        confidencePct: "55.00",
        rationale: "r",
        keyFactors: ["a"],
        minimumOdd: null,
        oddAtRecommendation: null,
        bookmaker: null,
        impliedProbPct: null,
        edgePct: null,
        modelVersion: "claude-opus-4-8",
        promptVersion: "v1",
        createdAt: o.createdAt,
        marketParams: null,
        stakeUnits: null,
      } as unknown as DbPrediction,
      aiCall: null,
      marketKey: o.marketKey,
      selections: [],
    };
  }

  it("1 só mercado: exclui a última (= seção) e mapeia o resto (== slice(1))", () => {
    // Mercado único (produção over/under): pular a 1ª-por-mercado é exatamente slice(1).
    const items = toPreviousAnalysisItems([
      mkRow({ id: "p3", marketKey: "over_under", createdAt: new Date(2026, 4, 19, 14, 0, 1) }),
      mkRow({ id: "p2", marketKey: "over_under", createdAt: new Date(2026, 4, 19, 13, 0, 2) }),
      mkRow({ id: "p1", marketKey: "over_under", createdAt: new Date(2026, 4, 19, 12, 0, 3) }),
    ]);
    expect(items.map((i) => i.id)).toEqual(["p2", "p1"]);
  });

  it("multi-mercado: exclui a ÚLTIMA de CADA mercado (essas viram seção, #243)", () => {
    // A última de cada mercado (cur_ou, cur_mr) vira seção por-mercado, então NÃO é
    // "anterior". As reanálises mais antigas entram — com marketLabel market-agnostic
    // do registry (AC3) e null coalesce 'over_under'.
    const items = toPreviousAnalysisItems([
      mkRow({ id: "cur_ou", marketKey: "over_under", createdAt: new Date(2026, 4, 19, 15, 0, 0) }),
      mkRow({ id: "cur_mr", marketKey: "match_result", createdAt: new Date(2026, 4, 19, 14, 0, 0) }),
      mkRow({ id: "old_mr", marketKey: "match_result", createdAt: new Date(2026, 4, 19, 13, 0, 0) }),
      mkRow({ id: "old_ou", marketKey: "over_under", createdAt: new Date(2026, 4, 19, 12, 30, 0) }),
      mkRow({ id: "hist", marketKey: null, createdAt: new Date(2026, 4, 19, 12, 0, 0) }),
    ]);
    expect(items.map((i) => i.id)).toEqual(["old_mr", "old_ou", "hist"]);
    expect(items.map((i) => i.marketLabel)).toEqual([
      getMarketPresentation("match_result").marketLabel,
      getMarketPresentation("over_under").marketLabel,
      // marketKey null (histórica) coalesce 'over_under' — espelha toAnalysisView.
      getMarketPresentation("over_under").marketLabel,
    ]);
  });

  it("rótulo de tempo carrega segundos (desambigua reanálises do mesmo minuto)", () => {
    const items = toPreviousAnalysisItems([
      mkRow({ id: "cur", marketKey: "over_under", createdAt: new Date(2026, 4, 19, 14, 23, 0) }),
      mkRow({ id: "prev", marketKey: "over_under", createdAt: new Date(2026, 4, 19, 14, 22, 7) }),
    ]);
    expect(items[0].generatedAt).toBe("19 mai · 14:22:07");
    // A id (não o timestamp) é a key — reanálises do mesmo minuto não colidem.
    expect(items[0].id).toBe("prev");
  });

  it("histórico vazio ou com 1 só (sem anteriores) → []", () => {
    expect(toPreviousAnalysisItems([])).toEqual([]);
    expect(
      toPreviousAnalysisItems([
        mkRow({ id: "only", marketKey: "over_under", createdAt: new Date() }),
      ]),
    ).toEqual([]);
  });
});

describe("toMarketAnalysisSections", () => {
  // Mesma row mínima do bloco acima: só os campos lidos pelo mapper (o mapeamento de
  // view tem cobertura própria em toAnalysisView). Pass mantém a row leve.
  function mkRow(o: {
    id: string;
    marketKey: string | null;
    createdAt: Date;
  }): PredictionWithAiCall {
    return {
      prediction: {
        id: o.id,
        recommendation: "pass",
        confidencePct: "55.00",
        rationale: "r",
        keyFactors: ["a"],
        minimumOdd: null,
        oddAtRecommendation: null,
        bookmaker: null,
        impliedProbPct: null,
        edgePct: null,
        modelVersion: "claude-opus-4-8",
        promptVersion: "v1",
        createdAt: o.createdAt,
        marketParams: null,
        stakeUnits: null,
      } as unknown as DbPrediction,
      aiCall: null,
      marketKey: o.marketKey,
      selections: [],
    };
  }

  it("≥2 mercados → uma seção por mercado, cada uma = a última daquele mercado (AC1)", () => {
    const sections = toMarketAnalysisSections([
      mkRow({ id: "ou2", marketKey: "over_under", createdAt: new Date(2026, 4, 19, 17, 0, 0) }),
      mkRow({ id: "mr1", marketKey: "match_result", createdAt: new Date(2026, 4, 19, 16, 0, 0) }),
      mkRow({ id: "ou1", marketKey: "over_under", createdAt: new Date(2026, 4, 19, 15, 0, 0) }),
      mkRow({ id: "mr0", marketKey: "match_result", createdAt: new Date(2026, 4, 19, 14, 0, 0) }),
    ]);
    // 1 seção por mercado; a última de cada (ou2 vence ou1, mr1 vence mr0).
    expect(sections.map((s) => s.id)).toEqual(["ou2", "mr1"]);
    expect(sections.map((s) => s.marketLabel)).toEqual([
      getMarketPresentation("over_under").marketLabel,
      getMarketPresentation("match_result").marketLabel,
    ]);
  });

  it("ordem = mercado (re)analisado mais recentemente primeiro (alimenta defaultOpen)", () => {
    // over/under é o mais recente globalmente → 1ª seção (índice 0 abre por padrão).
    const sections = toMarketAnalysisSections([
      mkRow({ id: "ou", marketKey: "over_under", createdAt: new Date(2026, 4, 19, 17, 0, 0) }),
      mkRow({ id: "mr", marketKey: "match_result", createdAt: new Date(2026, 4, 19, 16, 0, 0) }),
    ]);
    expect(sections[0].id).toBe("ou");
  });

  it("reanalisar um mercado o leva pro índice 0 com id NOVO (remonta/reabre, #243)", () => {
    // Antes: match_result era a última seção. Depois de reanalisar over/under (id novo,
    // createdAt mais recente), over/under salta pro índice 0 — a key React (=id) muda
    // só pra essa seção, então React remonta SÓ ela (reabre via defaultOpen).
    const sections = toMarketAnalysisSections([
      mkRow({ id: "ou_new", marketKey: "over_under", createdAt: new Date(2026, 4, 19, 18, 0, 0) }),
      mkRow({ id: "mr", marketKey: "match_result", createdAt: new Date(2026, 4, 19, 17, 0, 0) }),
      mkRow({ id: "ou_old", marketKey: "over_under", createdAt: new Date(2026, 4, 19, 15, 0, 0) }),
    ]);
    expect(sections[0].id).toBe("ou_new");
    expect(sections.map((s) => s.id)).toEqual(["ou_new", "mr"]);
  });

  it("marketId null (histórica) + over_under real → UMA seção, latest vence (AC4)", () => {
    // O bucket é COALESCED (marketKey ?? 'over_under'): uma row sem mercado e uma
    // over_under real NÃO viram duas seções — colapsam numa, com a mais recente vencendo.
    const merged = toMarketAnalysisSections([
      mkRow({ id: "ou_real", marketKey: "over_under", createdAt: new Date(2026, 4, 19, 14, 0, 0) }),
      mkRow({ id: "null_old", marketKey: null, createdAt: new Date(2026, 4, 19, 13, 0, 0) }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("ou_real");
    expect(merged[0].marketLabel).toBe(
      getMarketPresentation("over_under").marketLabel,
    );

    // Ordem inversa: a histórica null é a mais recente → ela vence dentro do bucket.
    const nullWins = toMarketAnalysisSections([
      mkRow({ id: "null_new", marketKey: null, createdAt: new Date(2026, 4, 19, 14, 0, 0) }),
      mkRow({ id: "ou_old", marketKey: "over_under", createdAt: new Date(2026, 4, 19, 13, 0, 0) }),
    ]);
    expect(nullWins).toHaveLength(1);
    expect(nullWins[0].id).toBe("null_new");
  });

  it("1 só mercado → 1 seção (caminho ≤1 = AnalysisResult cru, AC3)", () => {
    const sections = toMarketAnalysisSections([
      mkRow({ id: "ou1", marketKey: "over_under", createdAt: new Date(2026, 4, 19, 14, 0, 0) }),
      mkRow({ id: "ou0", marketKey: "over_under", createdAt: new Date(2026, 4, 19, 13, 0, 0) }),
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe("ou1");
  });

  it("popula marketKey (coalesced) e modelId (= modelVersion) por seção (#244)", () => {
    const sections = toMarketAnalysisSections([
      mkRow({ id: "ou", marketKey: "over_under", createdAt: new Date(2026, 4, 19, 15, 0, 0) }),
      mkRow({ id: "nullrow", marketKey: null, createdAt: new Date(2026, 4, 19, 14, 0, 0) }),
    ]);
    // marketKey = a key coalesced do bucket (key React da seção + hidden input do form).
    expect(sections.map((s) => s.marketKey)).toEqual(["over_under"]);
    // modelId = modelVersion CRU da análise (seed do dropdown do footer, #244).
    expect(sections[0].modelId).toBe("claude-opus-4-8");
  });

  it("histórico vazio → []", () => {
    expect(toMarketAnalysisSections([])).toEqual([]);
  });
});

describe("toAnalysisView — anytime_scorer (independent_binary, #290)", () => {
  // Prediction de scorer: recommendation = key do jogador, selections com label
  // (nome). getDescriptor('anytime_scorer') resolve (ativado em ALL_DESCRIPTORS).
  function scorerView(recommendation: string) {
    return toAnalysisView(
      {
      recommendation,
      confidencePct: "52",
      rationale: "Pedro é o melhor palpite de artilheiro.",
      keyFactors: ["forma recente"],
      minimumOdd: "2.100",
      oddAtRecommendation: "2.500",
      bookmaker: "Bet365",
      impliedProbPct: "40.00",
      edgePct: "12.00",
      modelVersion: "claude-opus-4-8",
      promptVersion: "anytime_scorer_v1",
      createdAt: baseCreatedAt,
      marketKey: "anytime_scorer",
      line: null,
      stakeUnits: "1.00",
      selections: [
        { key: "scorer_pedro", modelProbPct: 52, odd: 2.5, label: "Pedro" },
        {
          key: "scorer_arrascaeta",
          modelProbPct: 28,
          odd: 4.0,
          label: "Arrascaeta",
        },
      ],
      },
      null,
    );
  }

  it("renderiza o NOME do jogador (não a key crua) na recomendação e na grade", () => {
    const view = scorerView("scorer_pedro");
    expect(view.recommendation?.selectionLabel).toBe("Pedro");
    expect(view.recommendation?.betSummary?.market).toBe("Pedro");
    // grade N-vias: o outcome usa o nome, não scorer_pedro.
    const labels = view.outcomes.map((o) => o.label);
    expect(labels).toContain("Pedro");
    expect(labels).toContain("Arrascaeta");
    expect(labels.some((l) => l.startsWith("scorer_"))).toBe(false);
  });

  it("mostra o piso de edge do mercado = 8pp (não a constante 5)", () => {
    const view = scorerView("scorer_pedro");
    expect(view.minEdgeLabel).toBe("8pp");
    expect(view.minEdgePp).toBe(8);
  });

  it("edge da grade usa a implícita-TETO (1/odd*100), sem normalização Σ=1", () => {
    const view = scorerView("scorer_pedro");
    const pedro = view.outcomes.find((o) => o.label === "Pedro");
    // implícita-teto 1/2.5*100 = 40 → "40%"; edge model(52)−40 = +12pp.
    expect(pedro?.marketProb).toBe("40%");
    expect(pedro?.edge).toBe("+12.0pp");
  });
});
