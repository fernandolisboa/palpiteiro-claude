import { describe, expect, it } from "vitest";

import { keepLatestPerMatch, type DashboardRow } from "@/lib/dashboard/kpis";

// Pure-logic: factory de dados, sem mock, sem DB, sem nada de lib/ai (zero custo
// de Anthropic). keepLatestPerMatch só lê matchId + createdAt.
function row(overrides: Partial<DashboardRow> = {}): DashboardRow {
  const predictionId = overrides.predictionId ?? "p";
  return {
    predictionId,
    matchId: `match-${predictionId}`,
    recommendation: "over",
    market: "over_under_2_5",
    league: "world_cup",
    homeTeam: "A",
    awayTeam: "B",
    stakeUnits: "1.00",
    oddAtRecommendation: "2.00",
    edgePct: "5.00",
    confidencePct: "55.00",
    createdAt: new Date("2026-06-10T00:00:00Z"),
    result: null,
    profitUnits: null,
    settledAt: null,
    ...overrides,
  };
}

describe("keepLatestPerMatch", () => {
  it("colapsa reanálises do mesmo jogo na mais recente (maior createdAt)", () => {
    const out = keepLatestPerMatch([
      row({
        matchId: "m1",
        predictionId: "old",
        createdAt: new Date("2026-06-10T00:00:00Z"),
      }),
      row({
        matchId: "m1",
        predictionId: "new",
        createdAt: new Date("2026-06-11T00:00:00Z"),
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].predictionId).toBe("new");
  });

  it("mantém jogos distintos", () => {
    const out = keepLatestPerMatch([
      row({ matchId: "m1", predictionId: "a" }),
      row({ matchId: "m2", predictionId: "b" }),
      row({ matchId: "m3", predictionId: "c" }),
    ]);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.predictionId).sort()).toEqual(["a", "b", "c"]);
  });

  it("é order-independent: a mais recente vence em qualquer ordem de entrada", () => {
    const older = row({
      matchId: "m1",
      predictionId: "old",
      createdAt: new Date("2026-06-10T00:00:00Z"),
    });
    const newer = row({
      matchId: "m1",
      predictionId: "new",
      createdAt: new Date("2026-06-12T00:00:00Z"),
    });

    // antiga primeiro (a query ordena DESC, mas o helper não depende disso)
    const ascending = keepLatestPerMatch([older, newer]);
    expect(ascending).toHaveLength(1);
    expect(ascending[0].predictionId).toBe("new");

    // nova primeiro → mesmo resultado
    const descending = keepLatestPerMatch([newer, older]);
    expect(descending).toHaveLength(1);
    expect(descending[0].predictionId).toBe("new");
  });

  it("retorna [] pra entrada vazia", () => {
    expect(keepLatestPerMatch([])).toEqual([]);
  });
});
