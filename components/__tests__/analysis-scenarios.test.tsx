import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AnalysisScenarios } from "@/components/analysis-scenarios";
import { MIN_EDGE_PP } from "@/lib/odds/scenario";
import type { ScenariosView } from "@/lib/view/types";

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

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

const passScenarios: ScenariosView = {
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
};

describe("AnalysisScenarios — bloco 'Cenários' (#104)", () => {
  it("over: badge 'recomendada' exatamente uma vez, na coluna do over", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios scenarios={overScenarios} returnTone="positive" />,
    );
    expect(countOccurrences(markup, "recomendada")).toBe(1);
    // badge no lado recomendado; o alternativo é rotulado como tal.
    expect(markup).toContain('data-scenario-col="recommended"');
    expect(markup).toContain('data-scenario-col="alternative"');
    expect(markup).toContain("cenário alternativo");
  });

  it("over: renders the five unified rows for both sides", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios scenarios={overScenarios} returnTone="positive" />,
    );
    for (const label of [
      "prob. do modelo",
      "prob. do mercado",
      "odd na análise",
      "edge",
      "retorno esperado",
    ]) {
      expect(countOccurrences(markup, label)).toBeGreaterThanOrEqual(2);
    }
    expect(markup).toContain("mais de 2.5 gols");
    expect(markup).toContain("menos de 2.5 gols");
  });

  it("coluna alternativa é NEUTRA: nenhum token accent-* ou edge-* (reserva pinada)", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios scenarios={overScenarios} returnTone="positive" />,
    );
    // O alternativo (under) renderiza DEPOIS do recomendado (over) — tudo a
    // partir do marcador da coluna alternativa (coluna + framing + rodapé)
    // precisa ficar fora das famílias reservadas accent-*/edge-*.
    const altStart = markup.indexOf('data-scenario-col="alternative"');
    expect(altStart).toBeGreaterThan(-1);
    const altOnwards = markup.slice(altStart);
    expect(altOnwards).not.toContain("edge-fg");
    expect(altOnwards).not.toContain("edge-soft");
    expect(altOnwards).not.toContain("edge-border");
    expect(altOnwards).not.toContain("accent-");
    // superfície neutra explícita (ausência de token sozinha passaria vazio).
    expect(altOnwards).toContain("bg-surface-2");
    // sanidade: a coluna recomendada (antes do marcador) usa os tokens accent.
    const recommendedPart = markup.slice(0, altStart);
    expect(recommendedPart).toContain("bg-accent-soft");
    expect(recommendedPart).toContain("border-accent-border");
  });

  it("coluna alternativa tem a linha acionável da odd de equilíbrio do modelo", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios scenarios={overScenarios} returnTone="positive" />,
    );
    expect(markup).toContain("pelo modelo, só sai do zero com odd ≥ 2.38");
  });

  it("framing usa linguagem de break-even — nunca 'vale a pena' nem 'hoje'", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios scenarios={overScenarios} returnTone="positive" />,
    );
    expect(markup).toContain("só sai do zero");
    expect(markup).toContain("na análise o modelo estimou");
    // "vale a pena" é reservado ao critério de 5pp do lado recomendado; copy
    // temporal de valores congelados nunca diz "hoje" (ADR 0012).
    expect(markup).not.toContain("vale a pena");
    expect(markup).not.toContain("hoje");
  });

  it("pass: nenhuma badge 'recomendada', colunas neutras e copy de margem de erro", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios scenarios={passScenarios} returnTone="neutral" />,
    );
    expect(countOccurrences(markup, "recomendada")).toBe(0);
    expect(markup).not.toContain("cenário alternativo");
    expect(countOccurrences(markup, 'data-scenario-col="neutral"')).toBe(2);
    // colunas neutras: nada das famílias reservadas no markup inteiro.
    expect(markup).not.toContain("edge-fg");
    expect(markup).not.toContain("accent-");
    // margem de erro cobre inclusive EV positivo sob pass (ADR 0012).
    expect(markup).toContain(
      `vantagens pequenas (abaixo de ${MIN_EDGE_PP}pp) ficam dentro da margem de erro do modelo — por isso não há recomendação`,
    );
    // em pass, os DOIS lados mostram a odd de equilíbrio do modelo.
    expect(markup).toContain("pelo modelo, só sai do zero com odd ≥ 1.89");
    expect(markup).toContain("pelo modelo, só sai do zero com odd ≥ 2.13");
  });

  it("histórica degradada: nota renderizada quando note != null e células em '—'", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios
        scenarios={{
          ...overScenarios,
          under: {
            ...overScenarios.under,
            odd: "—",
            expectedReturn: "—",
          },
          framing: null,
          note: "odds do outro lado não registradas nesta análise",
        }}
        returnTone="positive"
      />,
    );
    expect(markup).toContain("odds do outro lado não registradas nesta análise");
    // célula degradada ancorada no rótulo da linha.
    expect(markup).toMatch(/odd na análise<\/span><span[^>]*>—</);
  });

  it("rodapé: threshold via MIN_EDGE_PP e remissão ao OddsCard", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios scenarios={overScenarios} returnTone="positive" />,
    );
    expect(markup).toContain(
      `o app só recomenda com vantagem ≥ ${MIN_EDGE_PP}pp sobre o mercado`,
    );
    expect(markup).toContain("os números acima são informativos");
    expect(markup).toContain(
      "odds do momento da análise — as atuais estão no card acima",
    );
  });

  it("retorno esperado do lado recomendado só fica verde com tone positivo", () => {
    const positive = renderToStaticMarkup(
      <AnalysisScenarios scenarios={overScenarios} returnTone="positive" />,
    );
    expect(positive).toMatch(/text-edge-fg[^>]*>\+11\.4%/);

    // Tom neutro (minOdd acima da odd / EV ≤ 0 no view-mapper): sem verde no
    // retorno, mesmo positivo — espelha o bloco "Aposta recomendada".
    const neutral = renderToStaticMarkup(
      <AnalysisScenarios scenarios={overScenarios} returnTone="neutral" />,
    );
    expect(neutral).not.toMatch(/text-edge-fg[^>]*>\+11\.4%/);
    expect(neutral).toMatch(/text-foreground[^>]*>\+11\.4%/);
  });
});
