import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AnalysisResult } from "@/components/analysis-result";
import { MIN_EDGE_PP } from "@/lib/odds/scenario";
import type { AnalysisView, ScenariosView } from "@/lib/view/types";

const overScenarios: ScenariosView = {
  over: {
    modelProb: "58%",
    marketProb: "50.7%",
    odd: "1.92",
    edge: "+7.3pp",
    expectedReturn: "+11.4%",
    modelBreakEvenOdd: "1.72",
  },
  under: {
    modelProb: "42%",
    marketProb: "49.3%",
    odd: "1.95",
    edge: "-7.3pp",
    expectedReturn: "-18.1%",
    modelBreakEvenOdd: "2.38",
  },
  recommended: "over",
  framing:
    "a aposta em menos de 3 gols só sai do zero se a chance real for maior que 51.3% — na análise o modelo estimou 42%",
  note: null,
};

const baseView: AnalysisView = {
  kind: "OVER",
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
  minOdd: "1.85",
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
  minEdgeLabel: `${MIN_EDGE_PP}pp`,
  scenarios: overScenarios,
  rationale: "racional técnico",
  factors: ["fator um", "fator dois"],
  generatedAt: "19 mai · 14:22",
  promptVersion: "over_under_v1.2",
  model: "claude-sonnet-4.5",
  costUsd: "$0.014",
};

const passView: AnalysisView = {
  ...baseView,
  kind: "PASS",
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
  scenarios: {
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
    framing: `vantagens pequenas (abaixo de ${MIN_EDGE_PP}pp) ficam dentro da margem de erro do modelo — por isso não há recomendação`,
    note: null,
  },
};

describe("AnalysisResult — bloco 'Aposta recomendada' (#103)", () => {
  it("over: renders the plain-language bet, frozen odd, expected return and legend", () => {
    const markup = renderToStaticMarkup(<AnalysisResult view={baseView} />);

    expect(markup).toContain("aposta recomendada");
    expect(markup).toContain("Mais de 2.5 gols");
    expect(markup).toContain("pelo menos 3 gols no jogo");
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
  });

  it("over: keeps the contract order — frase leiga → odd → retorno → condição por último", () => {
    const markup = renderToStaticMarkup(<AnalysisResult view={baseView} />);

    const phrase = markup.indexOf("Mais de 2.5 gols");
    const odd = markup.indexOf("odd na análise");
    const evReturn = markup.indexOf("retorno esperado");
    const condition = markup.indexOf("vale a pena se odd");
    expect(phrase).toBeGreaterThan(-1);
    expect(odd).toBeGreaterThan(phrase);
    expect(evReturn).toBeGreaterThan(odd);
    expect(condition).toBeGreaterThan(evReturn);
  });

  it("over: positive tone paints the expected return with the reserved edge token", () => {
    const markup = renderToStaticMarkup(<AnalysisResult view={baseView} />);
    // ancora o token no VALOR do retorno.
    expect(markup).toMatch(/text-edge-fg[^>]*>\+11\.4%/);
  });

  it("under: renders the under phrasing", () => {
    const markup = renderToStaticMarkup(
      <AnalysisResult
        view={{
          ...baseView,
          kind: "UNDER",
          betSummary: {
            market: "Menos de 2.5 gols",
            plain: "no máximo 2 gols no jogo",
          },
        }}
      />,
    );
    expect(markup).toContain("Menos de 2.5 gols");
    expect(markup).toContain("no máximo 2 gols no jogo");
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
          scenarios: {
            ...overScenarios,
            over: {
              ...overScenarios.over,
              odd: "—",
              expectedReturn: "—",
            },
            under: {
              ...overScenarios.under,
              odd: "—",
              expectedReturn: "—",
            },
            framing: null,
            note: "odds do outro lado não registradas nesta análise",
          },
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

  it("renders the scenarios block even when degraded (scenarios null hides it without crashing)", () => {
    const markup = renderToStaticMarkup(
      <AnalysisResult view={{ ...baseView, scenarios: null }} />,
    );
    expect(markup).toContain("aposta recomendada");
    expect(markup).not.toContain("cenário alternativo");
  });
});
