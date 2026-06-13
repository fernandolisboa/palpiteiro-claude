import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AnalysisScenarios } from "@/components/analysis-scenarios";
import { MIN_EDGE_PP } from "@/lib/odds/scenario";
import type { OutcomeView } from "@/lib/view/types";

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// Isola o trecho de uma coluna: do seu marcador data-scenario-col até o
// próximo marcador (ou o fim do markup, na última coluna). Independe da ordem
// de render — a coluna alternativa pode vir antes (under recomendado) ou
// depois (over recomendado) da recomendada.
function columnSegment(
  markup: string,
  col: "recommended" | "alternative",
): string {
  const marker = `data-scenario-col="${col}"`;
  const start = markup.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const next = markup.indexOf("data-scenario-col=", start + marker.length);
  return next === -1 ? markup.slice(start) : markup.slice(start, next);
}

// Fixtures no shape novo (outcomes[] da forma N-vias). scenarioLabel = rótulo
// leigo da coluna ("mais/menos de 2.5 gols"), idêntico ao SIDE_LABEL pré-pivot.
const overOutcomes: OutcomeView[] = [
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
];
const overFraming =
  "a aposta em menos de 3 gols só sai do zero se a chance real for maior que 51.3% — na análise o modelo estimou 42%";

// Espelho do caso under-recomendado: a coluna alternativa (over) renderiza
// ANTES da recomendada (a ordem do array é [over, under]).
const underOutcomes: OutcomeView[] = [
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
];
const underFraming =
  "a aposta em pelo menos 3 gols só sai do zero se a chance real for maior que 50.5% — na análise o modelo estimou 44%";

const passOutcomes: OutcomeView[] = [
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
];
const passFraming = `vantagens pequenas (abaixo de ${MIN_EDGE_PP}pp) ficam dentro da margem de erro do modelo — por isso não há recomendação`;

// 1X2 (match_result): 3 outcomes → 3 colunas (AC2). Labels/valores de fixture
// mock — sem DB. home recomendado.
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

describe("AnalysisScenarios — bloco 'Cenários' (#104)", () => {
  it("over: badge 'recomendada' exatamente uma vez, na coluna do over", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios
        outcomes={overOutcomes}
        framing={overFraming}
        note={null}
        returnTone="positive"
      />,
    );
    expect(countOccurrences(markup, "recomendada")).toBe(1);
    // badge no lado recomendado; o alternativo é rotulado como tal.
    expect(markup).toContain('data-scenario-col="recommended"');
    expect(markup).toContain('data-scenario-col="alternative"');
    expect(markup).toContain("cenário alternativo");
  });

  it("over: renders the five unified rows for both sides", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios
        outcomes={overOutcomes}
        framing={overFraming}
        note={null}
        returnTone="positive"
      />,
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
    // scenarioLabel verbatim — paridade VISUAL com o header pré-pivot.
    expect(markup).toContain("mais de 2.5 gols");
    expect(markup).toContain("menos de 2.5 gols");
  });

  it("coluna alternativa é NEUTRA: nenhum token accent-* ou edge-* (reserva pinada)", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios
        outcomes={overOutcomes}
        framing={overFraming}
        note={null}
        returnTone="positive"
      />,
    );
    // Aqui (over recomendado) a alternativa é a última coluna — o segmento
    // vai até o fim do markup, então framing + rodapé também ficam fora das
    // famílias reservadas accent-*/edge-*.
    const alt = columnSegment(markup, "alternative");
    expect(alt).not.toContain("edge-fg");
    expect(alt).not.toContain("edge-soft");
    expect(alt).not.toContain("edge-border");
    expect(alt).not.toContain("accent-");
    // superfície neutra explícita (ausência de token sozinha passaria vazio).
    expect(alt).toContain("bg-surface-2");
    // sanidade: a coluna recomendada usa os tokens accent.
    const recommended = columnSegment(markup, "recommended");
    expect(recommended).toContain("bg-accent-soft");
    expect(recommended).toContain("border-accent-border");
  });

  it("under recomendado: coluna alternativa (over, renderizada PRIMEIRO) é neutra e a badge cai no under", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios
        outcomes={underOutcomes}
        framing={underFraming}
        note={null}
        returnTone="positive"
      />,
    );
    // A alternativa renderiza antes da recomendada — o segmento é delimitado
    // pelo próximo marcador, não pelo fim do markup.
    const alt = columnSegment(markup, "alternative");
    expect(alt).toContain("mais de 2.5 gols");
    expect(alt).toContain("cenário alternativo");
    expect(alt).not.toContain("edge-fg");
    expect(alt).not.toContain("edge-soft");
    expect(alt).not.toContain("edge-border");
    expect(alt).not.toContain("accent-");
    expect(alt).toContain("bg-surface-2");

    // badge exatamente uma vez, dentro da coluna recomendada (under).
    expect(countOccurrences(markup, "recomendada")).toBe(1);
    const recommended = columnSegment(markup, "recommended");
    expect(recommended).toContain("menos de 2.5 gols");
    expect(recommended).toContain("recomendada");
    expect(recommended).toContain("bg-accent-soft");
    expect(recommended).toContain("border-accent-border");
  });

  it("coluna alternativa tem a linha acionável da odd de equilíbrio do modelo", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios
        outcomes={overOutcomes}
        framing={overFraming}
        note={null}
        returnTone="positive"
      />,
    );
    expect(markup).toContain("pelo modelo, só sai do zero com odd ≥ 2.38");
  });

  it("framing usa linguagem de break-even — nunca 'vale a pena' nem 'hoje'", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios
        outcomes={overOutcomes}
        framing={overFraming}
        note={null}
        returnTone="positive"
      />,
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
      <AnalysisScenarios
        outcomes={passOutcomes}
        framing={passFraming}
        note={null}
        returnTone="neutral"
      />,
    );
    expect(countOccurrences(markup, "recomendada")).toBe(0);
    expect(markup).not.toContain("cenário alternativo");
    expect(countOccurrences(markup, 'data-scenario-col="neutral"')).toBe(2);
    // colunas neutras: nada das famílias reservadas no markup inteiro.
    expect(markup).not.toContain("edge-fg");
    expect(markup).not.toContain("accent-");
    // margem de erro cobre inclusive EV positivo sob pass (ADR 0012).
    expect(markup).toContain(passFraming);
    // em pass, os DOIS lados mostram a odd de equilíbrio do modelo.
    expect(markup).toContain("pelo modelo, só sai do zero com odd ≥ 1.89");
    expect(markup).toContain("pelo modelo, só sai do zero com odd ≥ 2.13");
  });

  it("histórica degradada: nota renderizada quando note != null e células em '—'", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios
        outcomes={[
          overOutcomes[0],
          { ...overOutcomes[1], odd: "—", expectedReturn: "—" },
        ]}
        framing={null}
        note="odds do outro lado não registradas nesta análise"
        returnTone="positive"
      />,
    );
    expect(markup).toContain("odds do outro lado não registradas nesta análise");
    // célula degradada ancorada no rótulo da linha.
    expect(markup).toMatch(/odd na análise<\/span><span[^>]*>—</);
  });

  it("rodapé: threshold via MIN_EDGE_PP e remissão ao OddsCard", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios
        outcomes={overOutcomes}
        framing={overFraming}
        note={null}
        returnTone="positive"
      />,
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
      <AnalysisScenarios
        outcomes={overOutcomes}
        framing={overFraming}
        note={null}
        returnTone="positive"
      />,
    );
    expect(positive).toMatch(/text-edge-fg[^>]*>\+11\.4%/);

    // Tom neutro (minOdd acima da odd / EV ≤ 0 no view-mapper): sem verde no
    // retorno, mesmo positivo — espelha o bloco "Aposta recomendada".
    const neutral = renderToStaticMarkup(
      <AnalysisScenarios
        outcomes={overOutcomes}
        framing={overFraming}
        note={null}
        returnTone="neutral"
      />,
    );
    expect(neutral).not.toMatch(/text-edge-fg[^>]*>\+11\.4%/);
    expect(neutral).toMatch(/text-foreground[^>]*>\+11\.4%/);
  });
});

// AC2: mercado N-vias (1X2) renderiza 3 colunas por fixture mock (PURO, sem DB).
describe("AnalysisScenarios — N-vias (1X2, AC2)", () => {
  it("3 outcomes → 3 colunas data-driven; badge na recomendada, demais alternativas", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios
        outcomes={matchResultOutcomes}
        framing={null}
        note={null}
        returnTone="positive"
      />,
    );
    // 3 colunas: 1 recomendada (home) + 2 alternativas (draw, away).
    expect(countOccurrences(markup, "data-scenario-col=")).toBe(3);
    expect(countOccurrences(markup, 'data-scenario-col="recommended"')).toBe(1);
    expect(countOccurrences(markup, 'data-scenario-col="alternative"')).toBe(2);
    expect(countOccurrences(markup, "recomendada")).toBe(1);
    // rótulos leigos das colunas vêm do view (sem hardcode "Casa"/"Empate"/"Fora"
    // no componente — AC3).
    expect(markup).toContain("Casa");
    expect(markup).toContain("Empate");
    expect(markup).toContain("Fora");
    // grid de 3 colunas em telas largas.
    expect(markup).toContain("min-[480px]:grid-cols-3");
  });
});
