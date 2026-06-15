import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  INITIAL_BATCH,
  UpcomingMatchesMobile,
} from "@/components/upcoming-matches-mobile";
import { UpcomingMatchesDesktop } from "@/components/upcoming-matches-desktop";
import type { MatchRowView } from "@/lib/view/types";

function fakeMatch(i: number): MatchRowView {
  return {
    id: `m${i}`,
    home: { name: `Casa ${i}`, short: "CAS", hue: 120 },
    away: { name: `Fora ${i}`, short: "FOR", hue: 210 },
    league: "wc",
    kickoff: "10 jun, 16:00",
    when: "amanhã",
    odds: {
      // Chips densos da match-list usam o label CURTO ("Over"/"Under") — espelha
      // toMatchRowOdds. Forma N-vias (#173): outcomes na ordem canônica.
      outcomes: [
        { label: "Over", odd: "1.90" },
        { label: "Under", odd: "1.95" },
      ],
    },
    hasPrediction: false,
    status: "scheduled",
    homeScore: null,
    awayScore: null,
  };
}

function fakeMatches(n: number): MatchRowView[] {
  return Array.from({ length: n }, (_, i) => fakeMatch(i));
}

// Conta linhas pelo marcador estável que cada MatchRow / linha desktop emite:
// o href `/match/<id>`. useState renderiza seu valor INICIAL sob
// renderToStaticMarkup, então o lote inicial é testável sem DOM.
function countRows(html: string): number {
  return html.split('href="/match/').length - 1;
}

describe("UpcomingMatchesMobile reveal (#134)", () => {
  it("renderiza só o lote inicial e mostra 'Carregar mais' quando há mais", () => {
    const html = renderToStaticMarkup(
      <UpcomingMatchesMobile matches={fakeMatches(16)} />,
    );
    expect(countRows(html)).toBe(INITIAL_BATCH);
    expect(html).toContain("Carregar mais");
  });

  it("renderiza todas as linhas e oculta 'Carregar mais' quando cabem no lote", () => {
    const html = renderToStaticMarkup(
      <UpcomingMatchesMobile matches={fakeMatches(10)} />,
    );
    expect(countRows(html)).toBe(10);
    expect(html).not.toContain("Carregar mais");
  });
});

describe("UpcomingMatchesDesktop reveal (#134)", () => {
  it("aplica o mesmo reveal de lote inicial na grade desktop", () => {
    const html = renderToStaticMarkup(
      <UpcomingMatchesDesktop matches={fakeMatches(16)} />,
    );
    expect(countRows(html)).toBe(INITIAL_BATCH);
    expect(html).toContain("Carregar mais");
  });
});

describe("UpcomingMatchesDesktop chip N-vias (1X2) — #173 PR-2", () => {
  it("renderiza os 3 outcomes 1X2 no chip desktop (bloco byte-distinto do mobile)", () => {
    const m: MatchRowView = {
      ...fakeMatch(0),
      odds: {
        outcomes: [
          { label: "Casa", odd: "2.10" },
          { label: "Empate", odd: "3.40" },
          { label: "Fora", odd: "3.90" },
        ],
      },
    };
    const html = renderToStaticMarkup(<UpcomingMatchesDesktop matches={[m]} />);
    expect(html).toContain("Casa");
    expect(html).toContain("Empate");
    expect(html).toContain("Fora");
    expect(html).toContain("2.10");
    expect(html).toContain("3.90");
  });
});
