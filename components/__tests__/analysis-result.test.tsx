import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AnalysisResult } from "@/components/analysis-result";
import { MIN_EDGE_PP } from "@/lib/odds/scenario";
import type { AnalysisView, OutcomeView } from "@/lib/view/types";

const baseView: AnalysisView = {
  recommendation: {
    marketKey: "over_under",
    marketLabel: "Over/Under gols",
    selectionKey: "over",
    selectionLabel: "Over",
    line: 2.5,
  },
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
  minOdd: "1.85",
  stakeUnits: "1.00 u",
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
  minEdgeLabel: `${MIN_EDGE_PP}pp`,
  rationale: "racional técnico",
  factors: ["fator um", "fator dois"],
  generatedAt: "19 mai · 14:22",
  promptVersion: "over_under_v1.2",
  model: "claude-sonnet-4.5",
  costUsd: "$0.014",
};

const passView: AnalysisView = {
  ...baseView,
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
  framing: `vantagens pequenas (abaixo de ${MIN_EDGE_PP}pp) ficam dentro da margem de erro do modelo — por isso não há recomendação`,
  note: null,
  oddAtRec: null,
  oddAtRecAgo: null,
  bookmaker: null,
  expectedReturn: null,
  expectedReturnTone: "neutral",
  evLegend: null,
};

// 1X2 (match_result) — recomendação N-vias por fixture mock (AC2, PURE, sem DB).
const matchResultOutcomes: OutcomeView[] = [
  {
    id: "home",
    label: "Casa",
    scenarioLabel: "Casa",
    modelProb: "50%",
    marketProb: "45.4%",
    odd: "2.10",
    edge: "+4.6pp",
    expectedReturn: "+5.0%",
    breakEven: "2.00",
    isRecommended: true,
  },
  {
    id: "draw",
    label: "Empate",
    scenarioLabel: "Empate",
    modelProb: "27%",
    marketProb: "28.1%",
    odd: "3.40",
    edge: "-1.1pp",
    expectedReturn: "-8.2%",
    breakEven: "3.70",
    isRecommended: false,
  },
  {
    id: "away",
    label: "Fora",
    scenarioLabel: "Fora",
    modelProb: "23%",
    marketProb: "26.5%",
    odd: "3.60",
    edge: "-3.5pp",
    expectedReturn: "-17.2%",
    breakEven: "4.35",
    isRecommended: false,
  },
];

const matchResultView: AnalysisView = {
  ...baseView,
  recommendation: {
    marketKey: "match_result",
    marketLabel: "Resultado (1X2)",
    selectionKey: "home",
    selectionLabel: "Casa",
    line: null,
  },
  outcomes: matchResultOutcomes,
  // 1X2 não tem break-even binário (R4).
  framing: null,
  note: null,
};

describe("AnalysisResult — bloco 'Aposta recomendada' (#103/#170)", () => {
  it("over: renders the structured bet (mercado + seleção + linha), STAKE, frozen odd, expected return and legend", () => {
    const markup = renderToStaticMarkup(<AnalysisResult view={baseView} />);

    expect(markup).toContain("aposta recomendada");
    // Frase estruturada data-driven (AC3): mercado + seleção + linha do view.
    expect(markup).toContain("Over/Under gols · Over 2.5");
    // STAKE da recomendação (R3, formato "1.00 u").
    expect(markup).toContain("stake");
    expect(markup).toContain("1.00 u");
    expect(markup).toContain("odd na análise (há 3h)");
    expect(markup).toContain("1.92 · bet365");
    expect(markup).toContain("retorno esperado");
    expect(markup).toContain("+11.4%");
    // copy obrigatória da legenda: sem "médio"/"longo prazo" o número induz a
    // leitura "vou ganhar 11.4% nesta aposta" (desfecho binário).
    expect(markup).toContain("ganho médio");
    expect(markup).toContain("longo prazo");
    expect(markup).toContain("na análise");
    expect(markup).toContain("vale a pena se odd ≥");
    expect(markup).toContain("1.85");
    // sem setas ↑/↓ nem "2.5 gols" hardcoded no destaque (AC3).
    expect(markup).not.toContain("↑");
    expect(markup).not.toContain("↓");
  });

  it("over: keeps the contract order — frase estruturada → stake → odd → retorno → condição por último", () => {
    const markup = renderToStaticMarkup(<AnalysisResult view={baseView} />);

    const phrase = markup.indexOf("Over/Under gols · Over 2.5");
    const stake = markup.indexOf(">stake<");
    const odd = markup.indexOf("odd na análise");
    const evReturn = markup.indexOf("retorno esperado");
    const condition = markup.indexOf("vale a pena se odd");
    expect(phrase).toBeGreaterThan(-1);
    expect(stake).toBeGreaterThan(phrase);
    expect(odd).toBeGreaterThan(stake);
    expect(evReturn).toBeGreaterThan(odd);
    expect(condition).toBeGreaterThan(evReturn);
  });

  it("over: positive tone paints the expected return with the reserved edge token", () => {
    const markup = renderToStaticMarkup(<AnalysisResult view={baseView} />);
    // ancora o token no VALOR do retorno.
    expect(markup).toMatch(/text-edge-fg[^>]*>\+11\.4%/);
  });

  it("under: renders the under selection structured phrasing", () => {
    const markup = renderToStaticMarkup(
      <AnalysisResult
        view={{
          ...baseView,
          recommendation: {
            marketKey: "over_under",
            marketLabel: "Over/Under gols",
            selectionKey: "under",
            selectionLabel: "Under",
            line: 2.5,
          },
        }}
      />,
    );
    expect(markup).toContain("Over/Under gols · Under 2.5");
  });

  it("neutral tone (minOdd > oddAtRec): warning legend renders and the value is not edge-colored", () => {
    const markup = renderToStaticMarkup(
      <AnalysisResult
        view={{
          ...baseView,
          minOdd: "2.05",
          expectedReturnTone: "neutral",
          evLegend:
            "a odd registrada na análise (1.92) estava abaixo da mínima sugerida (2.05) — só vale a pena se a odd subir para ≥ 2.05",
        }}
      />,
    );
    expect(markup).toContain("estava abaixo da mínima sugerida");
    expect(markup).toMatch(/text-foreground[^>]*>\+11\.4%/);
    // tom neutro vale pro card inteiro — inclusive a coluna recomendada do
    // bloco de cenários (mesmo número, mesmo tom).
    expect(markup).not.toMatch(/text-edge-fg[^>]*>\+11\.4%/);
  });

  it("neutral tone (EV <= 0): honest value with the negative-return note", () => {
    const markup = renderToStaticMarkup(
      <AnalysisResult
        view={{
          ...baseView,
          expectedReturn: "-0.9%",
          expectedReturnTone: "neutral",
          evLegend:
            "na odd registrada na análise, o retorno esperado é negativo — só vale a pena com odd ≥ 1.85",
        }}
      />,
    );
    expect(markup).toContain("retorno esperado é negativo");
    expect(markup).toContain("só vale a pena com odd ≥");
    expect(markup).toMatch(/text-foreground[^>]*>-0\.9%/);
    expect(markup).not.toMatch(/text-edge-fg[^>]*>-0\.9%/);
  });

  it("historical prediction without frozen odd renders em-dash and omits the bookmaker separator", () => {
    const markup = renderToStaticMarkup(
      <AnalysisResult
        view={{
          ...baseView,
          oddAtRec: "—",
          oddAtRecAgo: "há 2d",
          bookmaker: null,
          expectedReturn: "—",
          expectedReturnTone: "neutral",
          evLegend: null,
          framing: null,
          note: "odds do outro lado não registradas nesta análise",
          outcomes: [
            { ...baseView.outcomes[0], odd: "—", expectedReturn: "—" },
            { ...baseView.outcomes[1], odd: "—", expectedReturn: "—" },
          ],
        }}
      />,
    );
    // em-dash ancorado nas CÉLULAS degradadas (o separador do betSummary
    // também é "—" — um toContain solto passaria com qualquer render).
    expect(markup).toMatch(/odd na análise \(há 2d\)<\/span><span[^>]*>—</);
    expect(markup).toMatch(/retorno esperado<\/span><span[^>]*>—</);
    expect(markup).not.toContain("· bet365");
    // sem retorno na tela, sem legenda explicando o número.
    expect(markup).not.toContain("ganho médio");
  });

  it("pass: renders the no-bet phrase with the MIN_EDGE_PP threshold", () => {
    const markup = renderToStaticMarkup(<AnalysisResult view={passView} />);
    expect(markup).toContain("Sem aposta recomendada");
    expect(markup).toContain(
      `vantagem mínima de ${MIN_EDGE_PP}pp sobre o mercado`,
    );
  });
});

describe("AnalysisResult — bloco 'Cenários' integrado e grid de stats removido (#104)", () => {
  it("over: stats grid is gone — unified 'prob. do modelo' label, no 'confidence' anywhere", () => {
    const markup = renderToStaticMarkup(<AnalysisResult view={baseView} />);
    expect(markup).toContain("prob. do modelo");
    expect(markup).toContain("prob. do mercado");
    expect(markup).not.toContain("confidence");
  });

  it("pass: stats grid is gone — scenarios block carries the numbers, no 'confidence' label", () => {
    const markup = renderToStaticMarkup(<AnalysisResult view={passView} />);
    expect(markup).toContain("prob. do modelo");
    expect(markup).not.toContain("confidence");
    // copy de margem de erro presente no PASS (EV positivo sob pass coberto).
    expect(markup).toContain(
      "ficam dentro da margem de erro do modelo — por isso não há recomendação",
    );
  });

  it("over: renders both scenario columns with the recommended badge on the over side", () => {
    const markup = renderToStaticMarkup(<AnalysisResult view={baseView} />);
    expect(markup).toContain("mais de 2.5 gols");
    expect(markup).toContain("menos de 2.5 gols");
    expect(markup).toContain("recomendada");
    expect(markup).toContain("cenário alternativo");
    // Invariante (ADR 0012): o edge da coluna recomendada é o edgePct salvo
    // da row — o MESMO valor que o grid de stats exibia ("+7.3").
    expect(markup).toContain("+7.3pp");
  });

  it("degraded analysis (outcomes empty) hides the scenarios block without crashing", () => {
    const markup = renderToStaticMarkup(
      <AnalysisResult view={{ ...baseView, outcomes: [] }} />,
    );
    expect(markup).toContain("aposta recomendada");
    expect(markup).not.toContain("cenário alternativo");
  });
});

// AC2: recomendação 1X2 (3 outcomes) renderiza o destaque + 3 colunas, sem
// nenhuma string de mercado hardcoded (tudo vem do view). PURE, sem DB.
describe("AnalysisResult — recomendação N-vias (1X2, AC2)", () => {
  it("renders the 1X2 highlight + 3 scenario columns from the view", () => {
    const markup = renderToStaticMarkup(
      <AnalysisResult view={matchResultView} />,
    );
    // Destaque: seleção (sem linha) + label do mercado, ambos do view.
    expect(markup).toContain("Casa");
    expect(markup).toContain("Resultado (1X2)");
    // bloco aposta recomendada estruturado.
    expect(markup).toContain("Resultado (1X2) · Casa");
    // 3 colunas de cenário.
    expect(
      markup.split('data-scenario-col="').length - 1,
    ).toBe(3);
    expect(markup).toContain("Empate");
    expect(markup).toContain("Fora");
    // sem setas (de-hardcode AC3).
    expect(markup).not.toContain("↑");
    expect(markup).not.toContain("↓");
  });
});
