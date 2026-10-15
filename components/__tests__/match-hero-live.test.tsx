import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { MatchHero } from "@/components/match-hero";
import type { MatchHeroView } from "@/lib/view/types";

function heroView(): MatchHeroView {
  return {
    id: "m1",
    home: { name: "Brasil", short: "BRA", hue: 120 },
    away: { name: "Argentina", short: "ARG", hue: 210 },
    league: "wc",
    kickoff: "em 2h",
    when: "hoje, 18:00",
    odds: null,
    hasPrediction: false,
    status: "scheduled",
    isInProgress: false,
    homeScore: null,
    awayScore: null,
  };
}

// Após extrair a LiveBadge compartilhada (#385), o pill do hero deixa de ser
// in-line e passa a usar "AO VIVO" (era "LIVE"). Guarda o refactor + o gate.
describe("MatchHero — pill ao vivo (#385)", () => {
  it("status='live' renderiza o pulso (animate-pulse + warn-fg + 'AO VIVO')", () => {
    const html = renderToStaticMarkup(
      <MatchHero view={heroView()} status="live" />,
    );
    expect(html).toContain("animate-pulse");
    expect(html).toContain("text-warn-fg");
    expect(html).toContain("AO VIVO");
  });

  it("status='scheduled' NÃO renderiza pill ao vivo", () => {
    const html = renderToStaticMarkup(
      <MatchHero view={heroView()} status="scheduled" />,
    );
    expect(html).not.toContain("animate-pulse");
    expect(html).not.toContain("AO VIVO");
  });
});

describe("MatchHero — placar parcial (#574)", () => {
  it("com liveScore e sem placar final: mostra o parcial e a legenda, sem 'encerrado'", () => {
    const html = renderToStaticMarkup(
      <MatchHero
        view={{
          ...heroView(),
          status: "live",
          liveScore: { home: 2, away: 1, caption: "parcial · atualizado há 2h" },
        }}
        status="live"
      />,
    );
    expect(html).toMatch(/2<span[^>]*>–<\/span>1/);
    expect(html).toContain("parcial · atualizado há 2h");
    expect(html).not.toContain("encerrado");
    expect(html).not.toContain(">vs<");
  });

  it("placar final tem prioridade e mantém 'encerrado'", () => {
    const html = renderToStaticMarkup(
      <MatchHero
        view={{
          ...heroView(),
          liveScore: { home: 2, away: 1, caption: "parcial" },
        }}
        status="finished"
        score={{ home: 3, away: 1 }}
      />,
    );
    expect(html).toContain("encerrado");
    expect(html).not.toContain("parcial");
  });
});
