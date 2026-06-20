import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { DesktopStatusCell } from "@/components/desktop-status-cell";
import { UpcomingMatchesDesktop } from "@/components/upcoming-matches-desktop";
import { toMatchRowView } from "@/lib/view/match";
import type { MatchInput } from "@/lib/view/match";
import type { MatchRowView } from "@/lib/view/types";

// Relógio fixo; o kickoff é deslocado relativo a este NOW pra derivar isInProgress.
const NOW = new Date("2026-06-11T12:00:00.000Z");

function makeMatch(overrides: Partial<MatchInput> = {}): MatchInput {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    league: "world_cup",
    homeTeam: "Brazil",
    awayTeam: "Argentina",
    kickoffAt: new Date(NOW.getTime() + 60 * 60 * 1000),
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    ...overrides,
  };
}

function view(overrides: Partial<MatchInput> = {}, odds = true): MatchRowView {
  return toMatchRowView({
    match: makeMatch(overrides),
    odds: odds
      ? {
          bookmaker: "bet365",
          overOdd: "1.85",
          underOdd: "1.95",
          capturedAt: NOW,
        }
      : null,
    hasPrediction: false,
    now: NOW,
  });
}

describe("DesktopStatusCell — em andamento (#385)", () => {
  it("isInProgress (scheduled apitado): renderiza a LiveBadge (animate-pulse + warn-fg), não '—'/'analisado'", () => {
    const m = view({
      status: "scheduled",
      kickoffAt: new Date(NOW.getTime() - 20 * 60 * 1000),
    });
    expect(m.isInProgress).toBe(true);
    const html = renderToStaticMarkup(<DesktopStatusCell m={m} />);
    expect(html).toContain("AO VIVO");
    expect(html).toContain("animate-pulse");
    expect(html).toContain("text-warn-fg");
    expect(html).not.toContain("analisado");
  });

  it("scheduled futuro: SEM badge ao vivo", () => {
    const m = view({ status: "scheduled" });
    expect(m.isInProgress).toBe(false);
    const html = renderToStaticMarkup(<DesktopStatusCell m={m} />);
    expect(html).not.toContain("AO VIVO");
    expect(html).not.toContain("animate-pulse");
  });
});

describe("UpcomingMatchesDesktop — em andamento (#385)", () => {
  it("uma linha in-progress: 'ao vivo'/animate-pulse presente, odds ausentes, chevron presente (clicável)", () => {
    const m = view({
      status: "scheduled",
      kickoffAt: new Date(NOW.getTime() - 20 * 60 * 1000),
    });
    const html = renderToStaticMarkup(<UpcomingMatchesDesktop matches={[m]} />);
    // (a) indicador ao vivo presente (célula de odds + célula de status)
    expect(html).toContain("animate-pulse");
    expect(html.toLowerCase()).toContain("ao vivo");
    // (b) odds pré-jogo NÃO renderizadas pra a linha ao vivo
    expect(html).not.toContain("1.85");
    expect(html).not.toContain("1.95");
    // (c) chevron mantido → linha segue clicável
    expect(html).toContain("lucide-chevron-right");
  });
});
