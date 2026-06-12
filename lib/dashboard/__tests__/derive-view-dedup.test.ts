import { describe, expect, it } from "vitest";

import type { DashboardRow } from "@/lib/dashboard/kpis";
import {
  deriveDashboardView,
  parseDashboardFilters,
} from "@/lib/dashboard/derive-view";

// End-to-end pelo funil real (deriveDashboardView): prova que reanálise NÃO infla
// KPIs/bankroll/tabela (ADR 0020 / #116). Pure-logic, sem mock/DB; nenhum import
// de lib/ai → zero custo de Anthropic.
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

function settled(
  result: "won" | "lost" | "void",
  profit: string,
  extra: Partial<DashboardRow> = {},
): DashboardRow {
  return row({
    result,
    profitUnits: profit,
    settledAt: new Date("2026-06-12T20:00:00Z"),
    ...extra,
  });
}

describe("deriveDashboardView — dedup de reanálise (#116)", () => {
  it("reanálise do mesmo jogo não infla KPIs, bankroll nem tabela", () => {
    const rows: DashboardRow[] = [
      // m1 analisado 2x, ambos settled won — só o mais novo deve contar
      settled("won", "1", {
        matchId: "m1",
        predictionId: "old",
        createdAt: new Date("2026-06-10T00:00:00Z"),
      }),
      settled("won", "1", {
        matchId: "m1",
        predictionId: "new",
        createdAt: new Date("2026-06-11T00:00:00Z"),
      }),
      // m2 distinto, settled won
      settled("won", "1", {
        matchId: "m2",
        predictionId: "m2p",
        createdAt: new Date("2026-06-10T12:00:00Z"),
      }),
    ];

    const { kpis, series, tableRows } = deriveDashboardView(
      rows,
      parseDashboardFilters({}),
    );

    // 3 predições, 2 jogos distintos → conta 2 (não 3).
    expect(kpis.counts.total).toBe(2);
    expect(kpis.counts.won).toBe(2);
    expect(kpis.yieldPct.n).toBe(2); // 2 bets settled na amostra, não 3
    // 1 ponto de bankroll por jogo distinto settled.
    expect(series).toHaveLength(2);

    const ids = tableRows.map((r) => r.id);
    expect(ids).toContain("new"); // a reanálise vence
    expect(ids).toContain("m2p");
    expect(ids).not.toContain("old"); // a antiga sai dos KPIs E da tabela
  });

  it("reanálise que troca over→pass: vence a mais recente (pass), não conta como aposta", () => {
    const rows: DashboardRow[] = [
      row({
        matchId: "m3",
        predictionId: "as-bet",
        recommendation: "over",
        createdAt: new Date("2026-06-10T00:00:00Z"),
      }),
      row({
        matchId: "m3",
        predictionId: "as-pass",
        recommendation: "pass",
        createdAt: new Date("2026-06-11T00:00:00Z"),
      }),
    ];

    const { kpis, tableRows } = deriveDashboardView(
      rows,
      parseDashboardFilters({}),
    );

    expect(kpis.counts.total).toBe(1); // um jogo, uma predição contada
    expect(kpis.counts.bets).toBe(0); // a mais recente é pass
    expect(kpis.counts.passes).toBe(1);
    expect(tableRows.map((r) => r.id)).toEqual(["as-pass"]);
  });
});
