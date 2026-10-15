import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { RowTrailing } from "@/components/match-list/row-trailing";
import { UpcomingMatchesDesktop } from "@/components/upcoming-matches-desktop";
import { toMatchListRowView } from "@/lib/view/match";
import type { MatchInput } from "@/lib/view/match";
import type { MatchListRowView } from "@/lib/view/types";

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

function view(overrides: Partial<MatchInput> = {}, odds = true): MatchListRowView {
  return toMatchListRowView({
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
    timeZone: "UTC",
  });
}

// O lado direito da linha (#577) substituiu a célula de status do desktop: um lugar
// só decide placar / odds / estado nas duas árvores.
describe("RowTrailing — em andamento (#385)", () => {
  it("isInProgress (scheduled apitado): '—' sem odds e sem 'analisado'", () => {
    const m = view({
      status: "scheduled",
      kickoffAt: new Date(NOW.getTime() - 20 * 60 * 1000),
    });
    expect(m.isInProgress).toBe(true);
    const html = renderToStaticMarkup(<RowTrailing m={{ ...m, hasPrediction: true }} />);
    expect(html).toContain(">—<");
    expect(html).not.toContain("1,85");
    expect(html).not.toContain("analisado");
  });

  it("scheduled futuro: as odds lado a lado, sem selo ao vivo", () => {
    const m = view({ status: "scheduled" });
    expect(m.isInProgress).toBe(false);
    const html = renderToStaticMarkup(<RowTrailing m={m} />);
    expect(html).toContain("1,85");
    expect(html).toContain("grid-cols-2");
    expect(html).not.toContain("AO VIVO");
  });
});

describe("UpcomingMatchesDesktop — em andamento (#385)", () => {
  it("uma linha in-progress: AO VIVO uma vez (no lugar da hora), odds ausentes, chevron presente", () => {
    const m = view({
      status: "scheduled",
      kickoffAt: new Date(NOW.getTime() - 20 * 60 * 1000),
    });
    const html = renderToStaticMarkup(<UpcomingMatchesDesktop matches={[m]} />);
    // (a) indicador ao vivo presente UMA vez, no lugar da hora (sem a hora do apito)
    expect(html).toContain("animate-pulse");
    expect(html.toLowerCase().split("ao vivo")).toHaveLength(2);
    expect(html).not.toContain(">11:40<");
    // (b) odds pré-jogo NÃO renderizadas pra a linha ao vivo
    expect(html).not.toContain("1,85");
    expect(html).not.toContain("1,95");
    // (c) chevron mantido → linha segue clicável
    expect(html).toContain("lucide-chevron-right");
  });
});

describe("UpcomingMatchesDesktop — placar parcial (#574)", () => {
  it("live com placar: placar e legenda 'parcial' no lado direito, um selo só", () => {
    const m = toMatchListRowView({
      match: makeMatch({
        status: "live",
        kickoffAt: new Date(NOW.getTime() - 50 * 60 * 1000),
        homeScore: 1,
        awayScore: 0,
        updatedAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
      }),
      odds: null,
      hasPrediction: false,
      now: NOW,
      timeZone: "UTC",
    });
    const html = renderToStaticMarkup(<UpcomingMatchesDesktop matches={[m]} />);
    expect(html).toContain("parcial · atualizado há 2h");
    expect(html).toMatch(/1<span[^>]*>–<\/span>0/);
    expect(html.toLowerCase().split("ao vivo")).toHaveLength(2);
    expect(html).not.toContain("encerrado");
  });
});
