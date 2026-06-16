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

  it("under recomendado: recomendada (under) é standalone PRIMEIRO; alternativa (over) colapsada e neutra", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios
        outcomes={underOutcomes}
        framing={underFraming}
        note={null}
        returnTone="positive"
      />,
    );
    // #242: a recomendada é forçada pra primeira/standalone; a alternativa fica no
    // <details>. O rótulo "cenário alternativo" mora no <summary> agora (não na
    // coluna), então o markup inteiro o contém mas o segmento da coluna alt não.
    expect(markup).toContain("cenário alternativo");
    const alt = columnSegment(markup, "alternative");
    expect(alt).toContain("mais de 2.5 gols");
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
    // #242: recomendada (home) standalone; as 2 alternativas (draw, away) ficam
    // colapsadas no <details>, em grade de 2 colunas (não mais 3 lado a lado).
    expect(markup).toContain("ver 2 cenários alternativos");
    expect(markup).toContain("min-[480px]:grid-cols-2");
  });
});

// R9: top-K com K=5 — mercado futuro N>5 trunca pra 5 colunas, recomendado
// SEMPRE presente, mantidos = [recomendado, depois top modelProb desc], e
// placeholder "+N outras" pro restante. PURO (fixture mock, sem DB).
describe("AnalysisScenarios — top-K truncation (N>5, R9)", () => {
  // 6 outcomes; o recomendado é o de MENOR modelProb (id "f", 20%) de propósito:
  // se a seleção fosse só "top-5 por modelProb", ele cairia fora — o invariante
  // "recomendado sempre presente" é o que o garante.
  const sixOutcomes: OutcomeView[] = [
    { id: "a", scenarioLabel: "Sel A", modelProb: "40%" },
    { id: "b", scenarioLabel: "Sel B", modelProb: "35%" },
    { id: "c", scenarioLabel: "Sel C", modelProb: "30%" },
    { id: "d", scenarioLabel: "Sel D", modelProb: "25%" },
    { id: "e", scenarioLabel: "Sel E", modelProb: "22%" },
    { id: "f", scenarioLabel: "Sel F", modelProb: "20%" },
  ].map((o) => ({
    ...o,
    label: o.scenarioLabel,
    marketProb: "—",
    odd: "—",
    edge: "—",
    expectedReturn: "—",
    breakEven: "—",
    isRecommended: o.id === "f",
  }));

  it("renders exactly 5 columns, recommended always kept, top modelProb desc, '+N outras' placeholder", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios
        outcomes={sixOutcomes}
        framing={null}
        note={null}
        returnTone="neutral"
      />,
    );

    // Exatamente 5 colunas (K=5), nunca as 6.
    expect(countOccurrences(markup, "data-scenario-col=")).toBe(5);
    // O recomendado (f, menor modelProb) está SEMPRE presente.
    expect(countOccurrences(markup, 'data-scenario-col="recommended"')).toBe(1);
    expect(markup).toContain("Sel F");
    // Mantidos = recomendado + top-4 por modelProb desc (a,b,c,d). "Sel E" (22%,
    // 5º maior) é o que cai fora — a única seleção escondida.
    expect(markup).toContain("Sel A");
    expect(markup).toContain("Sel B");
    expect(markup).toContain("Sel C");
    expect(markup).toContain("Sel D");
    expect(markup).not.toContain("Sel E");
    // Placeholder "+N outras" (1 escondida).
    expect(markup).toContain("+1 outras seleções não exibidas");
  });
});

// #242: o(s) cenário(s) alternativo(s) ficam colapsados num <details> nativo
// (fechado por padrão), com a recomendada dominante fora dele. Reduz a poluição da
// tela sem perder dado (o número-chave viaja no resumo).
describe("AnalysisScenarios — colapso do alternativo (#242)", () => {
  it("alternativo num <details> FECHADO por padrão; recomendada vem ANTES dele", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios
        outcomes={overOutcomes}
        framing={overFraming}
        note={null}
        returnTone="positive"
      />,
    );
    expect(markup).toContain("<details");
    expect(markup).not.toContain("<details open"); // fechado por padrão
    expect(markup).toContain("<summary");
    // a recomendada está FORA do <details> (renderizada antes); a alternativa dentro.
    const detailsStart = markup.indexOf("<details");
    expect(markup.indexOf('data-scenario-col="recommended"')).toBeLessThan(
      detailsStart,
    );
    expect(markup.indexOf('data-scenario-col="alternative"')).toBeGreaterThan(
      detailsStart,
    );
  });

  it("resumo (N=1) carrega o número que decide: rótulo + edge do alternativo", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios
        outcomes={overOutcomes}
        framing={overFraming}
        note={null}
        returnTone="positive"
      />,
    );
    expect(markup).toContain("ver cenário alternativo · menos de 2.5 gols -7.3pp");
  });

  it("pluralização: 1 alternativo = singular; ≥2 (1X2) = 'ver N cenários alternativos'", () => {
    const single = renderToStaticMarkup(
      <AnalysisScenarios
        outcomes={overOutcomes}
        framing={overFraming}
        note={null}
        returnTone="positive"
      />,
    );
    expect(single).toContain("ver cenário alternativo");
    expect(single).not.toContain("cenários alternativos");
    const multi = renderToStaticMarkup(
      <AnalysisScenarios
        outcomes={matchResultOutcomes}
        framing={null}
        note={null}
        returnTone="positive"
      />,
    );
    expect(multi).toContain("ver 2 cenários alternativos");
  });

  it("PASS não colapsa nada: sem <details> (não há recomendação a subordinar)", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios
        outcomes={passOutcomes}
        framing={passFraming}
        note={null}
        returnTone="neutral"
      />,
    );
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("<summary");
  });

  it("HelpHints ancoram só na coluna recomendada (sem duplicar âncoras)", () => {
    const markup = renderToStaticMarkup(
      <AnalysisScenarios
        outcomes={overOutcomes}
        framing={overFraming}
        note={null}
        returnTone="positive"
      />,
    );
    // showHints só na recomendada (sempre visível) → cada âncora de ajuda 1x.
    expect(countOccurrences(markup, "Ajuda: edge")).toBe(1);
    expect(countOccurrences(markup, "Ajuda: prob. do modelo")).toBe(1);
  });
});
