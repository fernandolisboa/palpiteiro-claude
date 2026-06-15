import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/queries/clv-snapshots", () => ({
  getClosingSnapshotsForPredictions: vi.fn(),
}));

import { getClosingSnapshotsForPredictions } from "@/lib/db/queries/clv-snapshots";
import { enrichDashboardRowsWithClosing } from "@/lib/dashboard/clv-enrich";
import type { DashboardRow } from "@/lib/dashboard/kpis";

const fetchClosing = vi.mocked(getClosingSnapshotsForPredictions);

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

beforeEach(() => {
  vi.clearAllMocks();
  fetchClosing.mockResolvedValue(new Map());
});

describe("enrichDashboardRowsWithClosing", () => {
  it("só busca pra rows non-pass com marketId E selectionId (não pass, não nulls)", async () => {
    await enrichDashboardRowsWithClosing([
      row({ predictionId: "ok", matchId: "m1" }),
      row({
        predictionId: "pass",
        matchId: "m2",
        recommendation: "pass",
        selectionId: null,
      }),
      row({ predictionId: "nomkt", matchId: "m3", marketId: null }),
    ]);
    expect(fetchClosing).toHaveBeenCalledTimes(1);
    const inputs = fetchClosing.mock.calls[0][0];
    expect(inputs.map((i) => i.predictionId)).toEqual(["ok"]);
    expect(inputs[0].line).toBe(2.5);
  });

  it("anexa closingOdd/overround às rows com captura; deixa as demais intactas", async () => {
    fetchClosing.mockResolvedValue(
      new Map([
        [
          "a",
          {
            oddClose: "1.900",
            overroundPctClose: "3.50",
            bookmaker: "Pinnacle",
            capturedAt: new Date("2026-06-10T19:30:00Z"),
          },
        ],
      ]),
    );
    const input = [
      row({ predictionId: "a", matchId: "m1" }),
      row({ predictionId: "b", matchId: "m2" }), // sem closing no Map
    ];
    const out = await enrichDashboardRowsWithClosing(input);
    const a = out.find((r) => r.predictionId === "a")!;
    const b = out.find((r) => r.predictionId === "b")!;
    expect(a.closingOdd).toBe("1.900");
    expect(a.closingOverroundPct).toBe("3.50");
    expect(b.closingOdd).toBeNull();
    // não muta o array/row de entrada
    expect(input[0].closingOdd).toBeNull();
  });

  it("sem candidatos non-pass → não chama a query, retorna as rows como vieram", async () => {
    const input = [
      row({ predictionId: "pass", recommendation: "pass", selectionId: null }),
    ];
    const out = await enrichDashboardRowsWithClosing(input);
    expect(fetchClosing).not.toHaveBeenCalled();
    expect(out).toBe(input);
  });

  it("dedup: 2 reanálises do MESMO (jogo, mercado) → 1 input (a mais recente)", async () => {
    await enrichDashboardRowsWithClosing([
      row({
        predictionId: "old",
        matchId: "m1",
        createdAt: new Date("2026-06-10T00:00:00Z"),
      }),
      row({
        predictionId: "new",
        matchId: "m1",
        createdAt: new Date("2026-06-10T06:00:00Z"),
      }),
    ]);
    const inputs = fetchClosing.mock.calls[0][0];
    expect(inputs).toHaveLength(1);
    expect(inputs[0].predictionId).toBe("new");
  });
});
