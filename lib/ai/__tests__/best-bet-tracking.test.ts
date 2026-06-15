import { describe, expect, it } from "vitest";

import { getCartridge } from "@/lib/ai/markets/registry";
import { keepLatestPerMatch, type DashboardRow } from "@/lib/dashboard/kpis";

// AC#4 (#178): cada predição do fan-out conta no SEU mercado, sem dupla contagem no
// agregado. A cadeia que garante isso: predict() persiste `marketId` via
// descriptor.dbMarketKey → o dashboard re-deriva `marketKey` por JOIN markets.key →
// keepLatestPerMatch chaveia `(matchId, marketKey)`. O elo frágil é a IDENTIDADE
// cartridge.marketKey === descriptor.dbMarketKey === markets.key — pinada aqui.

const CANDIDATES = ["over_under", "match_result", "btts", "double_chance"];

describe("AC#4 — identidade da chave de dedup por mercado", () => {
  it("cada candidato: cartridge.marketKey === descriptor.dbMarketKey === a própria key", () => {
    for (const key of CANDIDATES) {
      const c = getCartridge(key);
      expect(c.marketKey).toBe(key);
      expect(c.descriptor.dbMarketKey).toBe(key);
    }
  });

  it("over_under multi-linha (extraLines) mantém 'over_under' → compartilha 1 slot de dedup", () => {
    const v3 = getCartridge("over_under", { extraLines: true });
    expect(v3.marketKey).toBe("over_under");
    expect(v3.descriptor.dbMarketKey).toBe("over_under");
  });
});

function row(over: Partial<DashboardRow>): DashboardRow {
  return {
    predictionId: "p",
    matchId: "m1",
    recommendation: "over",
    marketKey: "over_under",
    marketLabel: "Over/Under gols",
    league: "world_cup",
    homeTeam: "A",
    awayTeam: "B",
    stakeUnits: "1",
    oddAtRecommendation: "1.90",
    edgePct: "5",
    confidencePct: "55",
    createdAt: new Date("2026-06-15T00:00:00Z"),
    result: null,
    profitUnits: null,
    settledAt: null,
    ...over,
  };
}

describe("AC#4 — fan-out de N mercados não dupla-conta no agregado", () => {
  it("N predições de mercados DISTINTOS no mesmo jogo → todas sobrevivem (1 por mercado)", () => {
    const rows = CANDIDATES.map((mk, i) =>
      row({ predictionId: `p${i}`, marketKey: mk }),
    );
    const kept = keepLatestPerMatch(rows);
    expect(kept).toHaveLength(4);
    expect(new Set(kept.map((r) => r.marketKey))).toEqual(new Set(CANDIDATES));
  });

  it("re-run do MESMO mercado/jogo colapsa pra a mais recente (sem dupla contagem)", () => {
    const older = row({
      predictionId: "old",
      marketKey: "over_under",
      createdAt: new Date("2026-06-15T00:00:00Z"),
    });
    const newer = row({
      predictionId: "new",
      marketKey: "over_under",
      createdAt: new Date("2026-06-15T01:00:00Z"),
    });
    const other = row({
      predictionId: "mr",
      marketKey: "match_result",
      createdAt: new Date("2026-06-15T00:30:00Z"),
    });
    const kept = keepLatestPerMatch([older, newer, other]);
    expect(kept).toHaveLength(2);
    expect(kept.find((r) => r.marketKey === "over_under")?.predictionId).toBe(
      "new",
    );
  });
});
