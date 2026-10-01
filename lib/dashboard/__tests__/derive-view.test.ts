import { describe, expect, it } from "vitest";

import type { DashboardRow } from "@/lib/dashboard/kpis";
import {
  deriveDashboardView,
  parseDashboardFilters,
} from "@/lib/dashboard/derive-view";

function row(overrides: Partial<DashboardRow> = {}): DashboardRow {
  const predictionId = overrides.predictionId ?? "p";
  return {
    predictionId,
    matchId: `match-${predictionId}`,
    recommendation: "over",
    marketKey: "over_under",
    marketLabel: "Over/Under gols",
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
    selectionId: null,
    selectionLabel: null,
    marketId: null,
    marketParams: null,
    kickoffAt: new Date("2026-06-10T20:00:00Z"),
    impliedProbPct: null,
    closingOdd: null,
    closingOverroundPct: null,
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

describe("parseDashboardFilters", () => {
  it("passes through each valid status, including push", () => {
    for (const s of ["pending", "won", "lost", "void", "push"] as const) {
      expect(parseDashboardFilters({ status: s }).status).toBe(s);
    }
  });

  it("defaults garbage / undefined status to 'all'", () => {
    expect(parseDashboardFilters({ status: "bogus" }).status).toBe("all");
    expect(parseDashboardFilters({}).status).toBe("all");
  });

  // R8: parseMarket é DINÂMICO contra as keys disponíveis (passadas), não mais
  // pinado a um literal. Key presente → passa; ausente / link antigo / sem lista
  // → degrada pra "all" (sem contrato externo de URL).
  it("passes through a market key only when it's in the available set", () => {
    expect(
      parseDashboardFilters({ market: "over_under" }, ["over_under"]).market,
    ).toBe("over_under");
    expect(
      parseDashboardFilters({ market: "btts" }, ["over_under", "btts"]).market,
    ).toBe("btts");
  });

  it("defaults an unavailable / legacy / missing market to 'all'", () => {
    // Mercado fora da lista disponível
    expect(
      parseDashboardFilters({ market: "btts" }, ["over_under"]).market,
    ).toBe("all");
    // Link antigo com o enum legado → "all" (não está nas keys canônicas)
    expect(
      parseDashboardFilters({ market: "over_under_2_5" }, ["over_under"])
        .market,
    ).toBe("all");
    // Sem lista de disponíveis → nada passa
    expect(parseDashboardFilters({ market: "over_under" }).market).toBe("all");
    expect(parseDashboardFilters({}, ["over_under"]).market).toBe("all");
  });

  it("liga fora do histórico do usuário degrada pra 'all' (#539)", () => {
    expect(parseDashboardFilters({ league: "ucl" }, [], ["bsa"]).league).toBe("all");
    expect(parseDashboardFilters({ league: "bsa" }, [], ["bsa"]).league).toBe("bsa");
    // sem a lista (chamadas antigas), só valida contra as ligas suportadas
    expect(parseDashboardFilters({ league: "ucl" }).league).toBe("ucl");
  });

  it("delegates league to parseLeagueFilter", () => {
    expect(parseDashboardFilters({ league: "ucl" }).league).toBe("ucl");
    expect(parseDashboardFilters({ league: "nope" }).league).toBe("all");
  });
});

describe("deriveDashboardView", () => {
  const rows: DashboardRow[] = [
    row({ predictionId: "pend", result: null, league: "world_cup" }),
    settled("won", "1", { predictionId: "won", league: "world_cup" }),
    settled("lost", "-1", { predictionId: "lost", league: "champions_league" }),
  ];

  it("dedupes + maps availableLeagues via leagueToKey", () => {
    const { availableLeagues } = deriveDashboardView(
      rows,
      parseDashboardFilters({}),
    );
    // world_cup -> wc (deduped from two rows), champions_league -> ucl
    expect(availableLeagues).toEqual(["wc", "ucl"]);
  });

  it("narrows table rows by a non-'all' status filter, then maps to row views", () => {
    const filters = parseDashboardFilters({ status: "won" });
    const { tableRows } = deriveDashboardView(rows, filters);
    expect(tableRows).toHaveLength(1);
    expect(tableRows[0].id).toBe("won"); // PredictionRowView.id === predictionId
    expect(tableRows[0].status).toBe("won");
  });

  it("narrows table rows by a league filter through the composition", () => {
    // only the champions_league row (-> ucl) survives the league filter.
    const filters = parseDashboardFilters({ league: "ucl" });
    const { tableRows } = deriveDashboardView(rows, filters);
    expect(tableRows.map((r) => r.id)).toEqual(["lost"]);
  });

  it("maps every row when filters are 'all'", () => {
    const { tableRows } = deriveDashboardView(rows, parseDashboardFilters({}));
    expect(tableRows.map((r) => r.id)).toEqual(["pend", "won", "lost"]);
  });

  it("produces a well-shaped kpis view and a settled-only series", () => {
    const { kpis, series } = deriveDashboardView(rows, parseDashboardFilters({}));
    // composition shape only — math is covered by kpis.test.ts
    expect(kpis.counts.total).toBe(3);
    expect(typeof kpis.yieldPct.value).toBe("string");
    expect(series).toHaveLength(2); // only the two settled rows
    expect(series.every((p) => typeof p.cumulative === "number")).toBe(true);
  });

  // R7: availableMarkets das rows-com-histórico (deduped), label de markets.label.
  it("exposes availableMarkets from the deduped rows with their labels", () => {
    const { availableMarkets } = deriveDashboardView(
      rows,
      parseDashboardFilters({}),
    );
    expect(availableMarkets).toEqual([
      { key: "over_under", label: "Over/Under gols" },
    ]);
  });

  it("segments by marketKey and the lone segment mirrors the aggregate (parity)", () => {
    const { kpis, segments } = deriveDashboardView(
      rows,
      parseDashboardFilters({}),
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].marketKey).toBe("over_under");
    expect(segments[0].marketLabel).toBe("Over/Under gols");
    // single-market history → segment KPI view === aggregate KPI view
    expect(segments[0].kpis).toEqual(kpis);
  });

  // R7 / empty-segment degradation: um mercado com aposta mas SEM resolução
  // (yield.n === 0) marca o segmento como vazio — a régua/bandas degradam pra "—".
  it("degrades a segment with no resolved bets to an empty state", () => {
    const pendingOnly: DashboardRow[] = [
      row({ predictionId: "pend1", result: null }),
    ];
    const { segments } = deriveDashboardView(
      pendingOnly,
      parseDashboardFilters({}),
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].empty).toBe(true);
    expect(segments[0].graduation.resolved).toBe(0);
    expect(segments[0].graduation.graduated).toBe(false);
    expect(segments[0].kpis.yieldPct.value).toBe("—");
  });

  // #539: liga e mercado recortam KPIs, segmentos e gráfico; status só a tabela.
  describe("recorte por filtro (#539)", () => {
    const multi: DashboardRow[] = [
      settled("won", "1", { predictionId: "wc-ou", league: "world_cup" }),
      settled("lost", "-1", {
        predictionId: "ucl-ou",
        league: "champions_league",
      }),
      settled("won", "0.8", {
        predictionId: "ucl-btts",
        matchId: "match-ucl-ou",
        league: "champions_league",
        marketKey: "btts",
        marketLabel: "Ambas marcam",
        recommendation: "yes",
      }),
      row({ predictionId: "wc-pend", league: "world_cup" }),
    ];

    it("liga recorta KPIs, segmentos e gráfico, não só a tabela", () => {
      const view = deriveDashboardView(
        multi,
        parseDashboardFilters({ league: "ucl" }),
      );
      expect(view.kpis.counts.total).toBe(2);
      expect(view.series.map((p) => p.profit)).toEqual([-1, 0.8]);
      expect(view.segments.map((s) => s.marketKey)).toEqual([
        "over_under",
        "btts",
      ]);
      expect(view.tableRows.map((r) => r.id)).toEqual(["ucl-ou", "ucl-btts"]);
    });

    it("mercado recorta KPIs e gráfico mas mantém todas as opções de mercado", () => {
      const view = deriveDashboardView(
        multi,
        parseDashboardFilters({ market: "btts" }, ["over_under", "btts"]),
      );
      expect(view.kpis.counts.total).toBe(1);
      expect(view.series).toHaveLength(1);
      expect(view.segments.map((s) => s.marketKey)).toEqual(["btts"]);
      expect(view.availableMarkets.map((m) => m.key)).toEqual([
        "over_under",
        "btts",
      ]);
      expect(view.availableLeagues).toEqual(["wc", "ucl"]);
    });

    it("status estreita só a tabela; KPIs e gráfico seguem o recorte inteiro", () => {
      const all = deriveDashboardView(multi, parseDashboardFilters({}));
      const won = deriveDashboardView(
        multi,
        parseDashboardFilters({ status: "won" }),
      );
      expect(won.kpis).toEqual(all.kpis);
      expect(won.series).toEqual(all.series);
      expect(won.segments).toEqual(all.segments);
      expect(won.tableRows.map((r) => r.id)).toEqual(["wc-ou", "ucl-btts"]);
    });

    it("recorte sem linhas zera KPIs e gráfico sem quebrar", () => {
      const view = deriveDashboardView(
        multi,
        parseDashboardFilters({ league: "wc", market: "btts" }, [
          "over_under",
          "btts",
        ]),
      );
      expect(view.kpis.counts.total).toBe(0);
      expect(view.series).toEqual([]);
      expect(view.segments).toEqual([]);
      expect(view.tableRows).toEqual([]);
    });
  });
});
