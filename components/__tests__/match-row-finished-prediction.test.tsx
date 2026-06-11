import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { MatchRow } from "@/components/match-row";
import type { MatchRowView } from "@/lib/view/types";

// O desktop status cell vive em app/page.tsx, que importa módulos server-only
// (auth, DB queries, sync de fixtures). Mockamos o suficiente pra importar o
// componente puro sem tocar em env/rede — replica o padrão dos testes em
// app/actions/__tests__.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/queries/matches", () => ({
  getMatchIdsWithPredictionsByUser: vi.fn(),
  getMatchesInRange: vi.fn(),
}));
vi.mock("@/lib/db/queries/odds-snapshots", () => ({
  getLatestOddsSnapshotsForMatches: vi.fn(),
}));
vi.mock("@/lib/db/queries/predictions", () => ({
  getRecentPredictionsByUser: vi.fn(),
}));
vi.mock("@/lib/sync/sync-upcoming-fixtures", () => ({
  ensureUpcomingFixturesSynced: vi.fn(),
}));

import { DesktopStatusCell } from "@/app/page";

function finishedAnalyzed(): MatchRowView {
  return {
    id: "m1",
    home: { name: "Brasil", short: "BRA", hue: 120 },
    away: { name: "Argentina", short: "ARG", hue: 210 },
    league: "wc",
    kickoff: "10 jun, 16:00",
    when: "ontem",
    odds: null,
    hasPrediction: true,
    status: "finished",
    homeScore: 2,
    awayScore: 1,
  };
}

// Comportamento escolhido (#99): um jogo encerrado que o usuário já analisou
// AINDA surfaça o marcador "analisado" — o resultado read-only segue acessível
// na página de detalhe. Mobile e desktop precisam concordar; testar as duas
// superfícies impede que voltem a divergir.
describe("finished + hasPrediction row surfaces 'analisado' on both surfaces (#99)", () => {
  it("mobile (MatchRow) shows both 'encerrado' and 'analisado'", () => {
    const html = renderToStaticMarkup(<MatchRow m={finishedAnalyzed()} />);
    expect(html).toContain("encerrado");
    expect(html).toContain("analisado");
  });

  it("desktop (DesktopStatusCell) shows both 'encerrado' and 'analisado'", () => {
    const html = renderToStaticMarkup(
      <DesktopStatusCell m={finishedAnalyzed()} />,
    );
    expect(html).toContain("encerrado");
    expect(html).toContain("analisado");
  });

  it("finished WITHOUT a prediction shows 'encerrado' but not 'analisado' on both surfaces", () => {
    const m: MatchRowView = { ...finishedAnalyzed(), hasPrediction: false };
    const mobile = renderToStaticMarkup(<MatchRow m={m} />);
    const desktop = renderToStaticMarkup(<DesktopStatusCell m={m} />);
    expect(mobile).toContain("encerrado");
    expect(mobile).not.toContain("analisado");
    expect(desktop).toContain("encerrado");
    expect(desktop).not.toContain("analisado");
  });
});
