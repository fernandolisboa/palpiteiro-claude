import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// PalpiteHero usa useActionState(analyzeBestBet) — mock leve pra não puxar o server
// action server-only no env de teste. O render estático congela pending=false/state=null,
// então o mock nunca é chamado; serve só pra resolver o import.
vi.mock("@/app/actions/predictions", () => ({
  analyzeBestBet: vi.fn(),
}));

import { PalpiteHero } from "@/components/palpites/palpite-hero";
import type { PalpiteHeadlineView } from "@/lib/view/palpites-headline";

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
};

// Regex do firewall (PLAN §5): NENHUM termo/símbolo de valor pode aparecer no HERO.
// `odd` casa "odds"/"odd"; mantém word-ish boundaries via o set do plano.
const VALUE_LANGUAGE = /R\$|%|\bEV\b|stake|odd|edge|lucro|retorno/i;

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
    expect(html).not.toMatch(VALUE_LANGUAGE);
    expect(html).not.toContain("edge-");
  });

  it("populated settled (won): firewall continua limpo mesmo com recibo de placar real", () => {
    const html = render({
      heroPalpite: { ...POPULATED, badge: "won" },
      finalScore: { home: 2, away: 1 },
    });
    expect(html).not.toMatch(VALUE_LANGUAGE);
    expect(html).not.toContain("edge-");
  });

  it("empty + CTA: a casca vazia também é firewall-limpa", () => {
    const html = render({ heroPalpite: null });
    expect(html).not.toMatch(VALUE_LANGUAGE);
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
    expect(html).toContain("placar provável");
    expect(html).toContain("placar real");
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
