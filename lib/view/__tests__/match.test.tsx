import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { MatchRow } from "@/components/match-row";
import type { MatchInput } from "@/lib/view/match";
import { toMatchRowView } from "@/lib/view/match";
import type { MatchStatus } from "@/lib/view/types";

// Deterministic anchor so relative time helpers don't depend on wall clock.
const NOW = new Date("2026-06-11T12:00:00.000Z");
const KICKOFF = new Date("2026-06-11T18:00:00.000Z");

function makeMatch(overrides: Partial<MatchInput> = {}): MatchInput {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    league: "world_cup",
    homeTeam: "FC Barcelona",
    awayTeam: "Real Madrid CF",
    kickoffAt: KICKOFF,
    status: "scheduled",
    homeScore: null,
    awayScore: null,
    ...overrides,
  };
}

describe("toMatchRowView scores + status", () => {
  it("maps homeScore/awayScore for a finished match", () => {
    const view = toMatchRowView({
      match: makeMatch({ status: "finished", homeScore: 2, awayScore: 1 }),
      odds: null,
      hasPrediction: false,
      now: NOW,
    });

    expect(view.status).toBe("finished");
    expect(view.homeScore).toBe(2);
    expect(view.awayScore).toBe(1);
  });

  it("preserves a 0–0 finished score (does not collapse to null)", () => {
    const view = toMatchRowView({
      match: makeMatch({ status: "finished", homeScore: 0, awayScore: 0 }),
      odds: null,
      hasPrediction: false,
      now: NOW,
    });

    expect(view.homeScore).toBe(0);
    expect(view.awayScore).toBe(0);
  });

  it("leaves scores null for a scheduled match even if db carries digits", () => {
    const view = toMatchRowView({
      // A provider may leave stray score columns on a non-finished row; the view
      // must not surface them.
      match: makeMatch({ status: "scheduled", homeScore: 3, awayScore: 1 }),
      odds: null,
      hasPrediction: false,
      now: NOW,
    });

    expect(view.status).toBe("scheduled");
    expect(view.homeScore).toBeNull();
    expect(view.awayScore).toBeNull();
  });

  it("leaves scores null for live/postponed/cancelled even with digits present", () => {
    for (const status of ["live", "postponed", "cancelled"] as MatchStatus[]) {
      const view = toMatchRowView({
        match: makeMatch({ status, homeScore: 1, awayScore: 1 }),
        odds: null,
        hasPrediction: false,
        now: NOW,
      });

      expect(view.status).toBe(status);
      expect(view.homeScore).toBeNull();
      expect(view.awayScore).toBeNull();
    }
  });

  it("keeps scores null when a finished match has no reported score", () => {
    const view = toMatchRowView({
      match: makeMatch({ status: "finished", homeScore: null, awayScore: null }),
      odds: null,
      hasPrediction: false,
      now: NOW,
    });

    expect(view.status).toBe("finished");
    expect(view.homeScore).toBeNull();
    expect(view.awayScore).toBeNull();
  });
});

describe("MatchRow rendering by status", () => {
  function render(match: MatchInput, odds = false) {
    const view = toMatchRowView({
      match,
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
    return renderToStaticMarkup(<MatchRow m={view} />);
  }

  it("shows the score + 'encerrado' marker for a finished match, not odds", () => {
    const markup = render(
      makeMatch({ status: "finished", homeScore: 2, awayScore: 1 }),
      true,
    );

    // Score digits and the finished marker are present.
    expect(markup).toContain(">2<");
    expect(markup).toContain(">1<");
    expect(markup.toLowerCase()).toContain("encerrado");
    // Odds chip / "sem odd" must NOT render for a finished match (score branch).
    expect(markup).not.toContain("sem odd");
    expect(markup).not.toContain("Over");
    expect(markup).not.toContain("Under");
  });

  it("renders postponed/cancelled sanely (label, not a 0–0)", () => {
    const postponed = render(makeMatch({ status: "postponed" }));
    expect(postponed).toContain("Adiado");
    expect(postponed.toLowerCase()).not.toContain("encerrado");

    const cancelled = render(makeMatch({ status: "cancelled" }));
    expect(cancelled).toContain("Cancelado");
    expect(cancelled.toLowerCase()).not.toContain("encerrado");
  });

  it("keeps odds rendering unchanged for a scheduled match", () => {
    const markup = render(makeMatch({ status: "scheduled" }), true);
    expect(markup).toContain("1.85");
    expect(markup).toContain("1.95");
    expect(markup.toLowerCase()).not.toContain("encerrado");
  });

  it("shows 'sem odd' for a scheduled match without odds", () => {
    const markup = render(makeMatch({ status: "scheduled" }), false);
    expect(markup).toContain("sem odd");
  });
});
