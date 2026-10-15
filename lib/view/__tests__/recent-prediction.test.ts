import { describe, expect, it } from "vitest";

import { toRecentPredictionView } from "@/lib/view/recent-prediction";

const base = {
  predictionId: "p1",
  matchId: "m1",
  league: "brasileirao_a" as const,
  homeTeam: "Flamengo",
  awayTeam: "Palmeiras",
  recommendation: "home",
  marketKey: "match_result" as string | null,
  marketLabel: "Resultado (1X2)" as string | null,
  marketParams: null as { line: number } | null,
  selectionLabel: "Casa" as string | null,
  edgePct: "4.20",
  createdAt: new Date("2026-09-28T12:00:00Z"),
};

describe("toRecentPredictionView — rótulo e mercado (#539)", () => {
  it("1X2 mostra a sigla do time (não 'Casa' nem 'HOME'), com o mercado ao lado", () => {
    const v = toRecentPredictionView(base, "UTC");
    expect(v.rec).toBe(v.home);
    expect(v.rec).toBe("FLA");
    expect(v.market).toBe("Resultado (1X2)");
  });

  it("over/under mantém o token e mostra a linha", () => {
    const v = toRecentPredictionView(
      {
        ...base,
        recommendation: "over",
        marketKey: "over_under",
        marketLabel: "Over/Under gols",
        marketParams: { line: 2.5 },
        selectionLabel: "Over",
      },
      "UTC"
    );
    expect(v.rec).toBe("Mais de 2,5");
    expect(v.recKind).toBe("over");
    expect(v.market).toBe("Total de gols");
  });

  it("row legada sem marketId cai em over/under", () => {
    const v = toRecentPredictionView(
      {
        ...base,
        recommendation: "under",
        marketKey: null,
        marketLabel: null,
        selectionLabel: null,
      },
      "UTC"
    );
    expect(v.rec).toBe("Menos de 2,5");
    expect(v.recKind).toBe("under");
    expect(v.market).toBe("Total de gols");
  });

  it("artilheiro usa o nome do jogador", () => {
    const v = toRecentPredictionView(
      {
        ...base,
        recommendation: "scorer_pedro",
        marketKey: "anytime_scorer",
        marketLabel: "Artilheiro",
        selectionLabel: "Pedro",
      },
      "UTC"
    );
    expect(v.rec).toBe("Pedro");
    expect(v.market).toBe("Artilheiro");
  });
});
