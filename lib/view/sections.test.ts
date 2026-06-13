import { describe, expect, it } from "vitest";

import type { NormalizedH2H } from "@/lib/providers/sports-data/types";

import { getMarketPresentation } from "./markets/presentation";
import { toH2HView } from "./sections";

// Confronto mínimo (toH2HView só lê score + kickoffTimestampMs + times).
function fx(homeGoals: number, awayGoals: number, ms: number): NormalizedH2H {
  return {
    id: `f-${ms}`,
    league: "brasileirao_a",
    kickoffAt: new Date(ms).toISOString(),
    kickoffTimestampMs: ms,
    homeTeam: "Casa FC",
    awayTeam: "Visita EC",
    status: "finished",
    score: { home: homeGoals, away: awayGoals },
  };
}

describe("toH2HView", () => {
  // 3 jogos: 2 over (3,4 gols), 1 under (1 gol) — ordenados por kickoff desc.
  const h2h: NormalizedH2H[] = [
    fx(2, 1, 3_000), // 3 gols → over
    fx(3, 1, 2_000), // 4 gols → over
    fx(1, 0, 1_000), // 1 gol  → under
  ];

  it("default = corte over/under (paridade): tags over/under + summary 'over X% · média Y gols'", () => {
    const view = toH2HView(h2h);
    expect(view.rows.map((r) => r.tag)).toEqual(["over", "over", "under"]);
    // over 2/3 = 67%; média (3+4+1)/3 = 2.7.
    expect(view.summary).toBe("over 67% · média 2.7 gols");
  });

  it("classify do registry over_under bate com o default", () => {
    const classify = getMarketPresentation("over_under").classifyH2H;
    const viaRegistry = toH2HView(h2h, 5, (h, a) => classify!(h, a, 2.5));
    expect(viaRegistry).toEqual(toH2HView(h2h));
  });

  it("mercado não baseado em gols (classify null): tags neutras + summary só com a média", () => {
    const view = toH2HView(h2h, 5, null);
    expect(view.rows.map((r) => r.tag)).toEqual(["", "", ""]);
    expect(view.summary).toBe("média 2.7 gols");
  });

  it("sem histórico: summary degrada", () => {
    expect(toH2HView([]).summary).toBe("sem histórico recente");
    expect(toH2HView([], 5, null).summary).toBe("sem histórico recente");
  });
});
