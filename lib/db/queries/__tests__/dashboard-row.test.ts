import { describe, expect, it } from "vitest";

import {
  marketEnumToKey,
  toDashboardRow,
  type RawUserDashboardRow,
} from "../dashboard";

// Cobre o coalesce enum→key de getUserDashboardRows — o caminho PRIMÁRIO de
// paridade onde o backfill #162 (script manual) não rodou (CI/pglite/preview):
// `markets.key` chega null pelo LEFT JOIN e DEVE cair em `over_under`, nunca null.
function rawRow(
  overrides: Partial<RawUserDashboardRow> = {},
): RawUserDashboardRow {
  return {
    predictionId: "p1",
    matchId: "m1",
    recommendation: "over",
    market: "over_under_2_5",
    marketKey: "over_under",
    marketLabel: "Over/Under gols",
    league: "brasileirao_a",
    homeTeam: "Casa FC",
    awayTeam: "Visita EC",
    stakeUnits: "1.00",
    oddAtRecommendation: "1.92",
    edgePct: "7.30",
    confidencePct: "58.00",
    createdAt: new Date("2026-06-01T12:00:00Z"),
    result: "won",
    profitUnits: "0.92",
    settledAt: new Date("2026-06-02T12:00:00Z"),
    ...overrides,
  };
}

describe("marketEnumToKey", () => {
  it("mapeia o enum legado pra key do seed", () => {
    expect(marketEnumToKey("over_under_2_5")).toBe("over_under");
  });

  it("coalesce de valor desconhecido/garbage pra over_under (paridade, nunca null)", () => {
    expect(marketEnumToKey("totally_unknown")).toBe("over_under");
    expect(marketEnumToKey("")).toBe("over_under");
  });
});

describe("toDashboardRow — coalesce marketId-null (caminho PRIMÁRIO de paridade)", () => {
  it("row sem marketId (key/label do join null) cai em over_under + label do seed", () => {
    const row = toDashboardRow(rawRow({ marketKey: null, marketLabel: null }));
    expect(row.marketKey).toBe("over_under");
    expect(row.marketLabel).toBe("Over/Under gols");
  });

  it("usa a key/label canônicas do join quando markets resolve (não-null)", () => {
    const row = toDashboardRow(
      rawRow({ marketKey: "match_result", marketLabel: "Resultado (1X2)" }),
    );
    expect(row.marketKey).toBe("match_result");
    expect(row.marketLabel).toBe("Resultado (1X2)");
  });

  it("label cai pro fallback do key quando o join não trouxe label mas trouxe key", () => {
    const row = toDashboardRow(rawRow({ marketKey: "over_under", marketLabel: null }));
    expect(row.marketLabel).toBe("Over/Under gols");
  });

  it("não vaza o campo legado `market` pro DashboardRow", () => {
    const row = toDashboardRow(rawRow());
    expect("market" in row).toBe(false);
  });
});
