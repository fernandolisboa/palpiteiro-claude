import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildOgTextPieces,
  OgPalpiteImage,
  type OgTextPieces,
} from "@/components/palpites/og-palpite-image";
import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";
import {
  OG_DISCLAIMER_STRIP,
  PALPITE_DISCLAIMER,
} from "@/lib/view/share/disclaimer";
import type { PalpiteHeadlineView } from "@/lib/view/palpites-headline";

// A imagem OG é uma árvore de <div> com estilos inline do Satori (width:100% etc) — o "%"
// de CSS NÃO é conteúdo. O firewall se aplica ao TEXTO VISÍVEL, então removemos atributos
// (incl. style) e tags antes de rodar o guard. Espelha o leaksValue do HERO (value + "%").
function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ") // tira tags + seus atributos (style/className/etc).
    .replace(/\s+/g, " ")
    .trim();
}

function leaksValue(html: string): boolean {
  const text = visibleText(html);
  return containsValueLanguage(text) || /%/.test(text);
}

const MATCH = {
  homeName: "Palmeiras",
  awayName: "Corinthians",
  homeShort: "PAL",
  awayShort: "COR",
};

// View de leak DELIBERADO: proveniência no headline (sourcePredictionIds) + narrativa + fontes
// — pra provar que NADA disso entra na imagem.
const LEAK_VIEW: PalpiteHeadlineView = {
  verdict: "Pra mim vai dar Palmeiras",
  probableScore: { home: 2, away: 1 },
  confidence: "media",
  narrative: "NARRATIVA-SECRETA-QUE-NAO-PODE-VAZAR-NA-IMAGEM",
  citedMarkets: ["Resultado (1X2)", "Mais de 2.5 gols"],
  badge: null,
  dimensions: [],
  sources: [
    { title: "FONTE-SECRETA-TITULO", url: "https://leak.example.com/secret-path" },
  ],
};

describe("OgPalpiteImage — privacidade (ADR §3, render do artefato REAL)", () => {
  it("não vaza narrative, sources (título/url) nem é injetável por interpolação", () => {
    const pieces = buildOgTextPieces(LEAK_VIEW, MATCH);
    const ogHtml = renderToStaticMarkup(<OgPalpiteImage pieces={pieces} />);

    expect(ogHtml).not.toContain(LEAK_VIEW.narrative);
    expect(ogHtml).not.toContain("FONTE-SECRETA-TITULO");
    expect(ogHtml).not.toContain("leak.example.com");
    expect(ogHtml).not.toContain("secret-path");
    // citedMarkets não entram na imagem.
    expect(ogHtml).not.toContain("Mais de 2.5 gols");
    expect(leaksValue(ogHtml)).toBe(false);
  });

  it("o que ENTRA é só Object.values(pieces) (veredito/placar/confiança/times/iniciais/disclaimer)", () => {
    const pieces = buildOgTextPieces(LEAK_VIEW, MATCH);
    const ogHtml = renderToStaticMarkup(<OgPalpiteImage pieces={pieces} />);
    expect(ogHtml).toContain(pieces.verdict);
    expect(ogHtml).toContain(pieces.probableScore);
    expect(ogHtml).toContain(pieces.teams);
    expect(ogHtml).toContain(pieces.disclaimer);
  });
});

describe("buildOgTextPieces — guard de valor em render-time (BLOCKER 1)", () => {
  it("veredito com preço solto ('2.10') degrada pra forma SEM veredito (não assa preço no PNG)", () => {
    const view: PalpiteHeadlineView = {
      ...LEAK_VIEW,
      verdict: "Palmeiras a 2.10, vai dar Verdão",
    };
    const pieces = buildOgTextPieces(view, MATCH);
    expect(pieces.verdict).toBe(""); // veredito-livre
    expect(pieces.verdict).not.toContain("2.10");

    const ogHtml = renderToStaticMarkup(<OgPalpiteImage pieces={pieces} />);
    expect(ogHtml).not.toContain("2.10");
    expect(leaksValue(ogHtml)).toBe(false);
    // A forma sem-veredito ainda mostra times + placar + disclaimer.
    expect(ogHtml).toContain(pieces.teams);
    expect(ogHtml).toContain(pieces.probableScore);
    expect(ogHtml).toContain(OG_DISCLAIMER_STRIP);
  });

  it("veredito com vírgula-decimal ('1,95') também degrada", () => {
    const pieces = buildOgTextPieces(
      { ...LEAK_VIEW, verdict: "paga 1,95 fácil" },
      MATCH,
    );
    expect(pieces.verdict).toBe("");
  });

  it("veredito com '%' degrada", () => {
    const pieces = buildOgTextPieces(
      { ...LEAK_VIEW, verdict: "70% no Palmeiras" },
      MATCH,
    );
    expect(pieces.verdict).toBe("");
  });

  it("veredito com termo de valor ('edge') degrada", () => {
    const pieces = buildOgTextPieces(
      { ...LEAK_VIEW, verdict: "tem edge no Palmeiras" },
      MATCH,
    );
    expect(pieces.verdict).toBe("");
  });

  it("veredito LIMPO passa intacto", () => {
    const pieces = buildOgTextPieces(LEAK_VIEW, MATCH);
    expect(pieces.verdict).toBe("Pra mim vai dar Palmeiras");
  });
});

describe("buildOgTextPieces — placar provável é PLACAR, nunca decimal (MAJOR 4)", () => {
  it.each([
    [{ home: 2, away: 1 }, "2–1"],
    [{ home: 0, away: 0 }, "0–0"],
    [{ home: 10, away: 3 }, "10–3"],
  ])("probableScore %o → '%s' (case /^\\d{1,2}[–-]\\d{1,2}$/)", (score, expected) => {
    const pieces = buildOgTextPieces(
      { ...LEAK_VIEW, probableScore: score },
      MATCH,
    );
    expect(pieces.probableScore).toBe(expected);
    expect(pieces.probableScore).toMatch(/^\d{1,2}[–-]\d{1,2}$/);
  });
});

describe("OG_DISCLAIMER_STRIP — derivação + render", () => {
  it("renderiza na árvore da imagem (não só membership de const)", () => {
    const pieces = buildOgTextPieces(LEAK_VIEW, MATCH);
    const ogHtml = renderToStaticMarkup(<OgPalpiteImage pieces={pieces} />);
    expect(ogHtml).toContain(OG_DISCLAIMER_STRIP);
  });

  it("carrega o selo '18+' e é DERIVADO do PALPITE_DISCLAIMER", () => {
    expect(OG_DISCLAIMER_STRIP).toContain("18+");
    // A relação de composição: 18+ · <PALPITE_DISCLAIMER sem prefixo "É só um palpite, " e sem ponto>.
    const derived = `18+ · ${PALPITE_DISCLAIMER.replace(
      /^É só um palpite, /,
      "",
    ).replace(/\.$/, "")}`;
    expect(OG_DISCLAIMER_STRIP).toBe(derived);
  });

  it("a tira é COMPRIMIDA — não é o disclaimer completo verbatim", () => {
    expect(OG_DISCLAIMER_STRIP).not.toBe(PALPITE_DISCLAIMER);
  });
});

// Sanidade do tipo exportado (pega edição que mude a forma).
const _shape: OgTextPieces = buildOgTextPieces(LEAK_VIEW, MATCH);
void _shape;
