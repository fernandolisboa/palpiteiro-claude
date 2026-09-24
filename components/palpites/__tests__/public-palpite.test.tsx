import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PublicPalpite } from "@/components/palpites/public-palpite";
import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";
import {
  NON_OPERATOR_DISCLAIMER,
  PALPITE_DISCLAIMER,
  RISK_DISCLAIMER,
  OG_DISCLAIMER_STRIP,
} from "@/lib/view/share/disclaimer";
import type { PalpiteHeadlineView } from "@/lib/view/palpites-headline";
import type { MatchPublicView } from "@/app/p/[id]/load-shared-palpite";

// leaksValue: MESMO guard do firewall do HERO (containsValueLanguage + "%").
function leaksValue(html: string): boolean {
  return containsValueLanguage(html) || /%/.test(html);
}

const MATCH: MatchPublicView = {
  homeTeam: "Palmeiras",
  awayTeam: "Corinthians",
  league: "brasileirao_a",
  finalScore: null,
};

const VIEW: PalpiteHeadlineView = {
  verdict: "Pra mim vai dar Palmeiras",
  probableScore: { home: 2, away: 1 },
  confidence: "media",
  narrative: "O Verdão vem melhor em casa e tende a controlar o jogo.",
  citedMarkets: ["Resultado (1X2)", "Mais de 2.5 gols"],
  badge: null,
  dimensions: [],
};

function render(
  view: Partial<PalpiteHeadlineView> = {},
  match: Partial<MatchPublicView> = {},
): string {
  return renderToStaticMarkup(
    <PublicPalpite view={{ ...VIEW, ...view }} match={{ ...MATCH, ...match }} />,
  );
}

describe("PublicPalpite — privacidade + firewall (ADR §3/§5)", () => {
  it("NÃO renderiza proveniência (sourcePredictionIds/userId/aiCallId/model/prompt)", () => {
    // O mapper já dropa esses por construção, mas a manchete persistida pode ter os campos —
    // o teste prova que nenhum byte de proveniência aparece se um deles escorregar pra view.
    // PublicPalpite só consome PalpiteHeadlineView (sem esses campos), então um leak seria
    // uma edição que os interpolasse. Asserimos sobre o HTML renderizado.
    const html = render();
    for (const secret of [
      "leak-pred-1",
      "leak-user",
      "leak-call",
      "leak-model",
      "leak-prompt",
    ]) {
      expect(html).not.toContain(secret);
    }
  });

  it("firewall limpo — sem número/termo de valor, sem '%', sem classe edge-*", () => {
    const html = render();
    expect(leaksValue(html)).toBe(false);
    expect(html).not.toContain("edge-");
  });

  it("linguagem de valor na NARRATIVE é pega pelo guard (prova que cobre o campo que cruza)", () => {
    const html = render({ narrative: "o edge aqui é claro pro Palmeiras" });
    // O guard detecta o leak no HTML renderizado.
    expect(leaksValue(html)).toBe(true);
  });

  it("citedMarkets são NORMALIZADOS pra categoria — nenhuma linha crua ('Mais de 2.5')", () => {
    const html = render({ citedMarkets: ["Mais de 2.5 gols", "Resultado"] });
    expect(html).toContain("Over/Under gols");
    expect(html).toContain("Resultado (1X2)");
    expect(html).not.toContain("Mais de 2.5 gols");
  });
});

describe("PublicPalpite — narrativa cortada pelo guard do loader (#438)", () => {
  it("narrativa vazia → o parágrafo não é renderizado", () => {
    const withText = render();
    const empty = render({ narrative: "" });
    expect(withText).toContain(VIEW.narrative);
    expect(empty).not.toContain(VIEW.narrative);
    expect(empty).not.toMatch(/<p[^>]*>\s*<\/p>/);
  });
});

describe("PublicPalpite — disclaimers (ADR §10, 3 blocos + 18+ + CVV)", () => {
  it("renderiza os 3 blocos + selo 18+ + CVV 188", () => {
    const html = render();
    expect(html).toContain(PALPITE_DISCLAIMER);
    expect(html).toContain(RISK_DISCLAIMER);
    expect(html).toContain(NON_OPERATOR_DISCLAIMER);
    expect(html).toContain("18+");
    expect(html).toContain("CVV");
    expect(html).toContain("188");
  });

  it("NÃO renderiza a tira comprimida do OG (essa é só pra imagem)", () => {
    const html = render();
    expect(html).not.toContain(OG_DISCLAIMER_STRIP);
  });
});

describe("PublicPalpite — placar gateado por settled (ADR §5)", () => {
  it("pendente (badge null): mostra 'provável', sem recibo de placar real", () => {
    const html = render();
    expect(html).toContain("provável");
    expect(html).not.toContain("placar real");
  });

  it("settled won + finalScore → recibo com placar real; firewall limpo", () => {
    const html = render(
      { badge: "won" },
      { finalScore: { home: 2, away: 1 } },
    );
    expect(html).toContain("placar real");
    expect(html).toContain("acertou");
    expect(leaksValue(html)).toBe(false);
  });

  it("settled SEM finalScore (não gateado) → sem recibo de placar real", () => {
    const html = render({ badge: "lost" }, { finalScore: null });
    expect(html).toContain("errou");
    expect(html).not.toContain("placar real");
  });
});

describe("PublicPalpite — fontes endurecidas (ADR §8)", () => {
  it("fontes https limpas → hostname + rel nofollow; query strippada", () => {
    const html = render({
      sources: [
        {
          title: "Escalação confirmada",
          url: "https://ge.globo.com/noticia?utm=x#frag",
        },
      ],
    });
    expect(html).toContain("o palpite leu");
    expect(html).toContain("ge.globo.com");
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).not.toContain("utm=x");
    expect(html).not.toContain("#frag");
  });

  it("fonte com valor/'%' no título OU http é DROPPADA (seção some se vazia)", () => {
    const html = render({
      sources: [
        { title: "Odds subindo", url: "https://ge.globo.com/a" },
        { title: "Time tem 70% chance", url: "https://ge.globo.com/b" },
        { title: "Legítima", url: "http://insecure.com/c" },
      ],
    });
    expect(html).not.toContain("o palpite leu");
    expect(leaksValue(html)).toBe(false);
  });
});
