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
