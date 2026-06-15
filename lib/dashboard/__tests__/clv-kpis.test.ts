import { describe, expect, it } from "vitest";

import {
  computeDashboardKpis,
  computeSegmentedKpis,
  type DashboardRow,
} from "@/lib/dashboard/kpis";

// CLV agregado (#180): média do CLV por predição non-pass COM closing line, settled
// ou não. Pure-logic, sem DB.
function row(o: Partial<DashboardRow> = {}): DashboardRow {
  const predictionId = o.predictionId ?? "p";
  return {
    predictionId,
    matchId: `m-${predictionId}`,
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
    selectionId: "sel",
    marketId: "mkt",
    marketParams: { line: 2.5 },
    kickoffAt: new Date("2026-06-10T20:00:00Z"),
    impliedProbPct: null,
    closingOdd: null,
    closingOverroundPct: null,
    ...o,
  };
}

describe("computeDashboardKpis — CLV razão de odds", () => {
  it("é a MÉDIA de (oddRec/oddClose − 1)×100 sobre non-pass com closing", () => {
    const k = computeDashboardKpis([
      row({ predictionId: "a", oddAtRecommendation: "2.10", closingOdd: "1.95" }),
      row({ predictionId: "b", oddAtRecommendation: "2.00", closingOdd: "2.00" }),
    ]);
    const expected = ((2.1 / 1.95 - 1) * 100 + 0) / 2;
    expect(k.clvOddsRatio.value).toBeCloseTo(expected, 4);
    expect(k.clvOddsRatio.n).toBe(2);
  });

  it("exclui pass e rows SEM closing (n conta só quem tem closing)", () => {
    const k = computeDashboardKpis([
      row({ predictionId: "a", oddAtRecommendation: "2.10", closingOdd: "1.95" }),
      row({
        predictionId: "p",
        recommendation: "pass",
        selectionId: null,
        oddAtRecommendation: null,
        closingOdd: null,
      }),
      row({ predictionId: "c", oddAtRecommendation: "2.00", closingOdd: null }),
    ]);
    expect(k.clvOddsRatio.n).toBe(1);
  });

  it("não precisa de settlement: closing sem result entra no CLV", () => {
    const k = computeDashboardKpis([
      row({ predictionId: "a", closingOdd: "1.90", result: null, settledAt: null }),
    ]);
    expect(k.clvOddsRatio.n).toBe(1);
    expect(k.clvOddsRatio.value).not.toBeNull();
    // ...mas o Yield (settled-only) fica vazio — CLV é o sinal antecipado.
    expect(k.yield.n).toBe(0);
  });
});

describe("computeDashboardKpis — CLV no-vig", () => {
  it("computa quando há impliedProbPct + overround; independente da razão-de-odds", () => {
    const k = computeDashboardKpis([
      row({
        predictionId: "a",
        oddAtRecommendation: "2.00",
        closingOdd: "1.90",
        closingOverroundPct: "5.00",
        impliedProbPct: "50.00",
      }),
      // sem impliedProbPct → no-vig null, mas razão-de-odds ainda conta.
      row({
        predictionId: "b",
        oddAtRecommendation: "2.00",
        closingOdd: "1.90",
        closingOverroundPct: "5.00",
        impliedProbPct: null,
      }),
    ]);
    expect(k.clvOddsRatio.n).toBe(2);
    expect(k.clvNoVigDelta.n).toBe(1);
    expect(k.clvNoVigDelta.value).not.toBeNull();
  });
});

describe("computeSegmentedKpis — CLV por mercado", () => {
  it("cada segmento tem seu próprio CLV", () => {
    const seg = computeSegmentedKpis([
      row({
        predictionId: "a",
        matchId: "m1",
        marketKey: "over_under",
        oddAtRecommendation: "2.10",
        closingOdd: "1.95",
      }),
      row({
        predictionId: "b",
        matchId: "m2",
        marketKey: "match_result",
        oddAtRecommendation: "3.00",
        closingOdd: "3.30",
      }),
    ]);
    const ou = seg.segments.find((s) => s.marketKey === "over_under")!;
    const mr = seg.segments.find((s) => s.marketKey === "match_result")!;
    expect(ou.kpis.clvOddsRatio.value!).toBeGreaterThan(0); // peguei melhor preço
    expect(mr.kpis.clvOddsRatio.value!).toBeLessThan(0); // fechamento subiu mais
  });
});
