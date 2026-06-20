import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// PalpiteHero usa useActionState(analyzeBestBet) — mock leve pra não puxar o server
// action server-only no env de teste. O render estático congela pending=false/state=null,
// então o mock nunca é chamado; serve só pra resolver o import.
vi.mock("@/app/actions/predictions", () => ({
  analyzeBestBet: vi.fn(),
}));

import { PalpiteHero } from "@/components/palpites/palpite-hero";
import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";
import {
  PALPITE_DISCLAIMER,
  type PalpiteHeadlineView,
} from "@/lib/view/palpites-headline";

// Manchete POVOADA de propósito (com confiança qualitativa + placar) — a asserção-chave
// é que NENHUM número de valor cruza pra UI. Espelha o POPULATED do guard de dado.
const POPULATED: PalpiteHeadlineView = {
  verdict: "Pra mim vai dar Palmeiras",
  probableScore: { home: 2, away: 1 },
  confidence: "media",
  narrative:
    "O Verdão vem melhor em casa e tende a controlar o jogo do meio pra frente.",
  citedMarkets: ["Resultado (1X2)", "Over/Under gols"],
  badge: null,
  dimensions: [],
};

// Firewall do HERO (PLAN §5): reusa o MESMO guard de DADO (containsValueLanguage, os 13
// padrões do ADR 0030 §3 com word-boundaries — edge/EV/stake/odd/yield/unidades/lucro/
// retorno/cotação/valor esperado/R$) como FONTE ÚNICA: a UI passa a casar exatamente o
// que a camada de dado barra (o \bedge\b já pega até uma classe `edge-*`). Soma a regra
// HERO-específica "sem %" (confiança é PALAVRA, nunca percentual; o guard de dado não bane
// % de propósito). Um vazamento — número de valor OU % — falha aqui.
function leaksValue(html: string): boolean {
  return containsValueLanguage(html) || /%/.test(html);
}

function render(props: Partial<Parameters<typeof PalpiteHero>[0]> = {}): string {
  return renderToStaticMarkup(
    <PalpiteHero
      heroPalpite={POPULATED}
      matchId="11111111-1111-1111-1111-111111111111"
      analyzable
      fanOutEnabled
      finalScore={null}
      {...props}
    />,
  );
}

describe("PalpiteHero — firewall de valor (ADR 0030 §3, inviolável)", () => {
  it("populated: ZERO número/termo de valor no DOM e nenhuma classe edge-*", () => {
    const html = render();
    expect(leaksValue(html)).toBe(false);
    expect(html).not.toContain("edge-");
  });

  it("populated settled (won): firewall continua limpo mesmo com recibo de placar real", () => {
    const html = render({
      heroPalpite: { ...POPULATED, badge: "won" },
      finalScore: { home: 2, away: 1 },
    });
    expect(leaksValue(html)).toBe(false);
    expect(html).not.toContain("edge-");
  });

  it("empty + CTA: a casca vazia também é firewall-limpa", () => {
    const html = render({ heroPalpite: null });
    expect(leaksValue(html)).toBe(false);
    expect(html).not.toContain("edge-");
  });
});

describe("PalpiteHero — confiança = palavra-chip (sem dígito/%/meter)", () => {
  it("rende a PALAVRA da confiança e nenhum dígito/% de confiança", () => {
    const html = render();
    expect(html).toContain("confiança média");
    // aria-label repete a palavra inteira (a11y).
    expect(html).toContain('aria-label="confiança média"');
    // Sem percentual nem meter/pip.
    expect(html).not.toMatch(/%/);
    expect(html).not.toContain("role=\"progressbar\"");
  });

  it.each([
    ["baixa" as const, "confiança baixa"],
    ["media" as const, "confiança média"],
    ["alta" as const, "confiança alta"],
  ])("confiança %s → palavra '%s'", (confidence, label) => {
    const html = render({ heroPalpite: { ...POPULATED, confidence } });
    expect(html).toContain(label);
  });
});

describe("PalpiteHero — settled honesty (palavra, nunca só cor; a11y)", () => {
  it("won → 'acertou' + token form-win, SEM 'errou'", () => {
    const html = render({
      heroPalpite: { ...POPULATED, badge: "won" },
      finalScore: { home: 2, away: 1 },
    });
    expect(html).toContain("acertou");
    expect(html).toContain("form-win");
    expect(html).not.toContain("errou");
  });

  it("lost → 'errou' + token form-loss, SEM 'acertou'", () => {
    const html = render({
      heroPalpite: { ...POPULATED, badge: "lost" },
      finalScore: { home: 0, away: 3 },
    });
    expect(html).toContain("errou");
    expect(html).toContain("form-loss");
    expect(html).not.toContain("acertou");
  });

  it("settled mostra o recibo: placar provável + placar real", () => {
    const html = render({
      heroPalpite: { ...POPULATED, badge: "won" },
      finalScore: { home: 2, away: 1 },
    });
    expect(html).toContain("provável");
    expect(html).toContain("placar real");
  });
});

describe("PalpiteHero — ficha de dimensões (#354, major D)", () => {
  it("0 dimensões → scorecard ESCONDIDO inteiro (sem 'e ainda')", () => {
    const html = render({ heroPalpite: { ...POPULATED, dimensions: [] } });
    expect(html).not.toContain("e ainda");
  });

  it("1–2 dimensões → renderiza os labels + badges, firewall limpo", () => {
    const html = render({
      heroPalpite: {
        ...POPULATED,
        dimensions: [
          { label: "Mandante ganha por 2+", badge: null },
          { label: "1º tempo: 1–0", badge: "won" },
        ],
      },
    });
    expect(html).toContain("e ainda");
    expect(html).toContain("Mandante ganha por 2+");
    expect(html).toContain("1º tempo: 1–0");
    expect(html).toContain("aguardando placar"); // pending badge
    expect(html).toContain("acertou"); // won badge
    expect(leaksValue(html)).toBe(false);
    expect(html).not.toContain("edge-");
  });

  it("várias dimensões settled + pending misturadas → firewall continua limpo", () => {
    const html = render({
      heroPalpite: {
        ...POPULATED,
        dimensions: [
          { label: "Mandante ganha por 2+", badge: "won" },
          { label: "Mandante não sofre gol", badge: "lost" },
          { label: "1º tempo: 1–0", badge: null },
          { label: "Mandante marca primeiro", badge: "won" },
        ],
      },
    });
    expect(html).toContain("Mandante não sofre gol");
    expect(html).toContain("Mandante marca primeiro");
    expect(html).toContain("acertou");
    expect(html).toContain("errou");
    expect(html).toContain("aguardando placar");
    expect(leaksValue(html)).toBe(false);
    expect(html).not.toContain("edge-");
  });
});

describe("PalpiteHero — fontes citadas (#378, ADR 0032)", () => {
  const SOURCES = [
    { title: "Palmeiras confirma escalação titular", url: "https://ge.globo.com/a" },
    { title: "Verdão chega embalado pra decisão", url: "https://espn.com.br/b" },
  ];

  it("sem sources → seção escondida (sem 'o palpite leu'), mas disclaimer continua presente", () => {
    const html = render({ heroPalpite: { ...POPULATED, sources: undefined } });
    expect(html).not.toContain("o palpite leu");
    // O disclaimer regulatório (último filho) NÃO depende das fontes.
    expect(html).toContain(PALPITE_DISCLAIMER);
  });

  it("com sources → títulos viram links reais (href, nova aba, rel seguro, texto do título)", () => {
    const html = render({ heroPalpite: { ...POPULATED, sources: SOURCES } });
    expect(html).toContain("o palpite leu");
    for (const s of SOURCES) {
      expect(html).toContain(`href="${s.url}"`);
      expect(html).toContain(s.title);
    }
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("com sources → firewall continua limpo (sem número/termo de valor, sem classe edge-*)", () => {
    const html = render({ heroPalpite: { ...POPULATED, sources: SOURCES } });
    expect(leaksValue(html)).toBe(false);
    expect(html).not.toContain("edge-");
  });

  it("disclaimer continua firewall-clean mesmo com as fontes presentes", () => {
    const html = render({ heroPalpite: { ...POPULATED, sources: SOURCES } });
    expect(html).toContain(PALPITE_DISCLAIMER);
    expect(containsValueLanguage(PALPITE_DISCLAIMER)).toBe(false);
  });
});

describe("PalpiteHero — estados empty/CTA/kill-switch/encerrado", () => {
  it("sem palpite + analyzable + flag on → CTA 'Analisar com IA' + teaser", () => {
    const html = render({ heroPalpite: null });
    expect(html).toContain("Analisar com IA");
    expect(html).toContain("E aí, quem leva esse jogo?");
  });

  it("sem palpite + analyzable + flag OFF → aviso suave, SEM botão de análise", () => {
    const html = render({ heroPalpite: null, fanOutEnabled: false });
    expect(html).toContain("temporariamente indisponível");
    expect(html).not.toContain("Analisar com IA");
  });

  it("sem palpite + NÃO analyzable (encerrado) → aviso de jogo encerrado, sem CTA", () => {
    const html = render({ heroPalpite: null, analyzable: false });
    expect(html).toContain("encerrado");
    expect(html).not.toContain("Analisar com IA");
  });

  it("populated + analyzable → botão ghost 'Analisar de novo'", () => {
    const html = render();
    expect(html).toContain("Analisar de novo");
  });

  it("populated kicker 'O PALPITE' presente", () => {
    const html = render();
    expect(html.toLowerCase()).toContain("o palpite");
  });
});
