import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { MatchRow } from "@/components/match-row";
import { UpcomingMatchesDesktop } from "@/components/upcoming-matches-desktop";
import type { MatchListRowView } from "@/lib/view/types";

function finishedAnalyzed(): MatchListRowView {
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
    isInProgress: false,
    homeScore: 2,
    awayScore: 1,
    day: { key: "2026-06-10", label: "Ontem" },
    time: "16:00",
  };
}

// Comportamento escolhido (#99): um jogo encerrado que o usuário já analisou
// AINDA surfaça o marcador "analisado" — o resultado read-only segue acessível
// na página de detalhe. Mobile e desktop precisam concordar; testar as duas
// superfícies impede que voltem a divergir. Desde o #577 o desktop não tem mais
// célula de status: "encerrado" vem do lado direito (RowTrailing) e "analisado" é o
// selo ao lado dos nomes.
describe("finished + hasPrediction row surfaces 'analisado' on both surfaces (#99)", () => {
  it("mobile (MatchRow) shows the score, 'encerrado' and 'analisado'", () => {
    const html = renderToStaticMarkup(<MatchRow m={finishedAnalyzed()} />);
    expect(html).toMatch(/2<span[^>]*>–<\/span>1/);
    expect(html).toContain("encerrado");
    expect(html).toContain("analisado");
  });

  it("desktop (UpcomingMatchesDesktop) shows the score, 'encerrado' and 'analisado'", () => {
    const html = renderToStaticMarkup(
      <UpcomingMatchesDesktop matches={[finishedAnalyzed()]} />,
    );
    expect(html).toMatch(/2<span[^>]*>–<\/span>1/);
    expect(html).toContain("encerrado");
    expect(html).toContain("analisado");
  });

  it("finished WITHOUT a prediction shows 'encerrado' but not 'analisado' on both surfaces", () => {
    const m: MatchListRowView = { ...finishedAnalyzed(), hasPrediction: false };
    const mobile = renderToStaticMarkup(<MatchRow m={m} />);
    const desktop = renderToStaticMarkup(<UpcomingMatchesDesktop matches={[m]} />);
    expect(mobile).toContain("encerrado");
    expect(mobile).not.toContain("analisado");
    expect(desktop).toContain("encerrado");
    expect(desktop).not.toContain("analisado");
  });

  it("finished sem placar reportado: só 'encerrado', nunca um 0–0 nem 'sem odd'", () => {
    const m: MatchListRowView = { ...finishedAnalyzed(), homeScore: null, awayScore: null };
    for (const html of [
      renderToStaticMarkup(<MatchRow m={m} />),
      renderToStaticMarkup(<UpcomingMatchesDesktop matches={[m]} />),
    ]) {
      expect(html).toContain("encerrado");
      expect(html).not.toContain("–");
      expect(html).not.toContain("sem odd");
    }
  });
});
