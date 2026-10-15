import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { RecentPredCard } from "@/components/recent-pred-card";
import type { RecentMatchView } from "@/lib/view/types";

function card(overrides: Partial<RecentMatchView> = {}): RecentMatchView {
  return {
    matchId: "m1",
    league: "bsa",
    home: "PAL",
    away: "FLA",
    when: "sáb 17/10",
    bets: [
      { market: "Ambas marcam", rec: "Não", edge: "+5,6 pontos" },
      { market: "Total de gols", rec: "Mais de 2,5", edge: "+4,0 pontos" },
    ],
    moreBets: 1,
    passCount: 3,
    ...overrides,
  };
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("RecentPredCard — um cartão por jogo (ADR 0058)", () => {
  it("liga, data do jogo, siglas, até duas apostas com a vantagem, +N e sem aposta", () => {
    const html = renderToStaticMarkup(<RecentPredCard p={card()} listHref="/jogos?league=all" />);
    const t = text(html);
    expect(t).toContain("Brasileirão");
    expect(t).toContain("sáb 17/10");
    expect(t).toContain("PAL × FLA");
    expect(t).toContain("Ambas marcam Não vantagem +5,6 pontos");
    expect(t).toContain("+1 aposta");
    expect(t).toContain("3 mercados sem aposta");
    expect(html).toContain('href="/match/m1?back=%2Fjogos%3Fleague%3Dall"');
    expect(t).not.toMatch(/PASS/);
  });

  it("sem nenhuma aposta: 'Sem aposta em N mercados'", () => {
    const t = text(renderToStaticMarkup(<RecentPredCard p={card({ bets: [], moreBets: 0, passCount: 5 })} />));
    expect(t).toContain("Sem aposta em 5 mercados");
    expect(t).not.toContain("vantagem");
  });

  it("singular: 1 mercado", () => {
    const t = text(
      renderToStaticMarkup(<RecentPredCard p={card({ bets: card().bets.slice(0, 1), moreBets: 0, passCount: 1 })} />),
    );
    expect(t).toContain("1 mercado sem aposta");
    expect(t).not.toContain("aposta s ");
  });
});
