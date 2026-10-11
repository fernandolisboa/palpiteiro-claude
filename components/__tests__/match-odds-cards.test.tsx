import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { MatchOddsCards } from "@/components/match-odds-cards";
import type { OddsView } from "@/lib/view/types";

const OVER_UNDER: OddsView = {
  marketLabel: "Over/Under gols",
  outcomes: [
    { label: "Over 2.5", odd: "1.90", pct: "51.0%" },
    { label: "Under 2.5", odd: "1.95", pct: "49.0%" },
  ],
  bookmaker: "Pinnacle",
  overround: "3.9%",
  updatedAgo: "2 min",
};

const MATCH_RESULT: OddsView = {
  marketLabel: "Resultado (1X2)",
  outcomes: [
    { label: "Casa", odd: "2.10", pct: "44.0%" },
    { label: "Empate", odd: "3.40", pct: "27.2%" },
    { label: "Fora", odd: "3.20", pct: "28.9%" },
  ],
  bookmaker: "Pinnacle",
  overround: "8.3%",
  updatedAgo: "2 min",
};

// Server Component async: resolve a promise das odds e devolve os mesmos cards de antes.
async function render(views: {
  oddsView: OddsView | null;
  matchResultOddsView: OddsView | null;
}) {
  const el = await MatchOddsCards({
    odds: Promise.resolve(views),
    unavailable: null,
  });
  return renderToStaticMarkup(el);
}

describe("MatchOddsCards — cards de odds por streaming", () => {
  it("over/under + 1X2 → os dois cards", async () => {
    const html = await render({
      oddsView: OVER_UNDER,
      matchResultOddsView: MATCH_RESULT,
    });
    expect(html).toContain("Over/Under gols");
    expect(html).toContain("Resultado (1X2)");
  });

  it("sem captura 1X2 → só o over/under", async () => {
    const html = await render({ oddsView: OVER_UNDER, matchResultOddsView: null });
    expect(html).toContain("Over/Under gols");
    expect(html).not.toContain("Resultado (1X2)");
  });

  it("sem odds → o empty-state do OddsCard", async () => {
    const html = await render({ oddsView: null, matchResultOddsView: null });
    expect(html).toContain("Odds indisponíveis");
  });
});
