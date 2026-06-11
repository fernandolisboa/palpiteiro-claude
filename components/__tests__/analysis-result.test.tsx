import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AnalysisResult } from "@/components/analysis-result";
import { MIN_EDGE_PP } from "@/lib/odds/scenario";
import type { AnalysisView } from "@/lib/view/types";

const baseView: AnalysisView = {
  kind: "OVER",
  confidence: "58%",
  edge: "+7.3",
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
  rationale: "racional técnico",
  factors: ["fator um", "fator dois"],
  generatedAt: "19 mai · 14:22",
  promptVersion: "over_under_v1.2",
  model: "claude-sonnet-4.5",
  costUsd: "$0.014",
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
    // ancora o token no VALOR do retorno (o Stat de edge também usa edge-fg).
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
        }}
      />,
    );
    expect(markup).toContain("odd na análise (há 2d)");
    expect(markup).toContain("—");
    expect(markup).not.toContain("· bet365");
  });

  it("pass: renders the no-bet phrase with the MIN_EDGE_PP threshold", () => {
    const markup = renderToStaticMarkup(
      <AnalysisResult
        view={{
          ...baseView,
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
        }}
      />,
    );
    expect(markup).toContain("Sem aposta recomendada");
    expect(markup).toContain(
      `vantagem mínima de ${MIN_EDGE_PP}pp sobre o mercado`,
    );
    // renderToStaticMarkup escapa "<" — o Stat de edge sai como &lt;5pp,
    // sourced de MIN_EDGE_PP (mesmo texto visível de antes).
    expect(markup).toContain(`&lt;${MIN_EDGE_PP}pp`);
  });
});
