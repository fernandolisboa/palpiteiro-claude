import { describe, expect, it } from "vitest";

import {
  applyTableFilters,
  computeBankrollSeries,
  computeDashboardKpis,
  computeGraduation,
  computeSegmentedKpis,
  computeYieldByStakeBand,
  keepLatestPerMatch,
  rowStatus,
  type DashboardRow,
} from "@/lib/dashboard/kpis";

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
    ...overrides,
  };
}

function settled(
  result: "won" | "lost" | "void" | "push",
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

describe("computeDashboardKpis", () => {
  it("returns null rates and zero counts for no predictions", () => {
    const k = computeDashboardKpis([]);
    expect(k.totalPredictions).toBe(0);
    expect(k.yield.value).toBeNull();
    expect(k.winRate.value).toBeNull();
    expect(k.passRate.value).toBeNull();
    expect(k.totalProfitUnits).toBe(0);
  });

  it("keeps rates null while nothing is settled (Copa not started)", () => {
    const k = computeDashboardKpis([row(), row({ recommendation: "under" })]);
    expect(k.settled).toBe(0);
    expect(k.pending).toBe(2);
    expect(k.yield.value).toBeNull();
    expect(k.winRate.value).toBeNull();
    // pass rate is decision-time: defined over all predictions even unsettled
    expect(k.passRate.value).toBe(0);
    expect(k.passRate.n).toBe(2);
  });

  it("computes yield from profit over staked volume, excluding pass stakes", () => {
    const rows = [
      settled("won", "0.92", { oddAtRecommendation: "1.92" }),
      settled("lost", "-1.00"),
      settled("void", "0", { recommendation: "pass", oddAtRecommendation: null }),
    ];
    const k = computeDashboardKpis(rows);
    expect(k.totalProfitUnits).toBeCloseTo(-0.08, 5);
    expect(k.stakedUnits).toBeCloseTo(2, 5); // pass stake excluded
    expect(k.yield.value).toBeCloseTo(-4, 5);
    expect(k.yield.n).toBe(2);
  });

  it("excludes a real bet that was annulled (void) from the yield denominator", () => {
    const base: DashboardRow[] = [
      settled("won", "0.92", { oddAtRecommendation: "1.92" }),
      settled("lost", "-1.00"),
    ];
    // A real over/under bet (non-pass) annulled to void via admin override:
    // keeps its stake + entry odd but profit 0.
    const withVoid: DashboardRow[] = [
      ...base,
      settled("void", "0", { recommendation: "over", oddAtRecommendation: "1.95" }),
    ];
    const k = computeDashboardKpis(withVoid);
    const baseK = computeDashboardKpis(base);
    expect(k.stakedUnits).toBeCloseTo(2, 5); // void stake NOT in denominator
    expect(k.yield.value).toBeCloseTo(-4, 5);
    expect(k.yield.n).toBe(2); // void not counted in sample size
    // void must not move the yield at all
    expect(k.yield.value).toBeCloseTo(baseK.yield.value!, 5);
    expect(k.stakedUnits).toBeCloseTo(baseK.stakedUnits, 5);
    expect(k.yield.n).toBe(baseK.yield.n);
    // void IS still a settled void in the counts (visibility unchanged)
    expect(k.void).toBe(1);
    expect(k.settled).toBe(3);
  });

  // push entra no enum no expand da Fase 1 (#161); nenhum caminho o emite ainda,
  // mas a exclusão estrutural do yield (ADR 0016 §5: no-action, devolve o stake)
  // já é tratada como o void. Lock pra garantir paridade quando o settlement
  // plugável (Fase 2 #166) começar a emitir push.
  it("excludes a push (no-action, stake returned) bet from the yield like void", () => {
    const base = [
      settled("won", "0.95", { oddAtRecommendation: "1.95" }),
      settled("lost", "-1", { predictionId: "p2", oddAtRecommendation: "1.95" }),
    ];
    const withPush = [
      ...base,
      settled("push", "0", {
        predictionId: "p3",
        recommendation: "over",
        oddAtRecommendation: "1.95",
      }),
    ];
    const k = computeDashboardKpis(withPush);
    const baseK = computeDashboardKpis(base);
    // push stake NOT in the denominator; yield identical to the push-free wallet
    expect(k.stakedUnits).toBeCloseTo(2, 5);
    expect(k.yield.value).toBeCloseTo(baseK.yield.value!, 5);
    expect(k.yield.n).toBe(baseK.yield.n);
    // push is neither a win nor a loss — win rate unmoved
    expect(k.winRate.value).toBeCloseTo(baseK.winRate.value!, 5);
    expect(k.won).toBe(1);
    expect(k.lost).toBe(1);
    // push IS still a settled row (visibility), just not yield-bearing
    expect(k.settled).toBe(3);
  });

  it("yields null for a wallet of only settled void real bets (zero denominator)", () => {
    // All real (non-pass) bets annulled to void: won/lost set is empty, so the
    // yield denominator is 0. Must report null/0 and never divide by zero.
    const rows = [
      settled("void", "0", { recommendation: "over", oddAtRecommendation: "1.95" }),
      settled("void", "0", { recommendation: "under", oddAtRecommendation: "2.10" }),
    ];
    const k = computeDashboardKpis(rows);
    expect(k.yield.value).toBeNull();
    expect(k.yield.n).toBe(0);
    expect(k.stakedUnits).toBe(0);
    expect(k.void).toBe(2);
    expect(k.settled).toBe(2);
  });

  it("yield numerator reflects only won/lost, even when a profitable void is present", () => {
    // Guard against the numerator silently summing over void: a void carrying a
    // nonzero profitUnits (settlement-invariant violation) must NOT move yield.
    const wonLost = [
      settled("won", "0.92", { oddAtRecommendation: "1.92" }),
      settled("lost", "-1.00"),
    ];
    const withDirtyVoid = [
      ...wonLost,
      settled("void", "5.00", { recommendation: "over", oddAtRecommendation: "1.95" }),
    ];
    const baseK = computeDashboardKpis(wonLost);
    const k = computeDashboardKpis(withDirtyVoid);
    expect(k.yield.value).toBeCloseTo(baseK.yield.value!, 5);
    expect(k.yield.n).toBe(baseK.yield.n);
  });

  // #167 / ADR 0019: o Yield já é stake-aware (Σ profit / Σ stake). Com stakes
  // mistos (1–3u) o peso do stake é load-bearing: o Yield agregado DIFERE da
  // média não-ponderada dos yields por aposta. Mistura histórico 1u com novos
  // 1–3u e prova que soma certo (ADR 0019 §6).
  it("yield is stake-weighted across mixed 1–3u stakes (≠ unweighted mean)", () => {
    const rows = [
      // won 3u @ 2.00 → profit +3.0
      settled("won", "3.00", {
        predictionId: "w3",
        stakeUnits: "3.00",
        oddAtRecommendation: "2.00",
      }),
      // lost 2u → profit -2.0
      settled("lost", "-2.00", {
        predictionId: "l2",
        stakeUnits: "2.00",
        oddAtRecommendation: "1.95",
      }),
      // won 1u @ 1.90 → profit +0.9
      settled("won", "0.90", {
        predictionId: "w1",
        stakeUnits: "1.00",
        oddAtRecommendation: "1.90",
      }),
      // histórico 1u (won @ 1.90) → profit +0.9 — soma junto, sem retrofit
      settled("won", "0.90", {
        predictionId: "hist1",
        stakeUnits: "1.00",
        oddAtRecommendation: "1.90",
      }),
    ];
    const k = computeDashboardKpis(rows);
    expect(k.stakedUnits).toBeCloseTo(7, 5); // 3 + 2 + 1 + 1
    expect(k.totalProfitUnits).toBeCloseTo(2.8, 5); // 3 - 2 + 0.9 + 0.9
    // Yield = (Σ profit / Σ stake) * 100 = (2.8 / 7) * 100 = 40
    expect(k.yield.value).toBeCloseTo(40, 5);
    expect(k.yield.n).toBe(4);
    // A média NÃO-ponderada dos yields por aposta seria 45 — o peso do stake é
    // o que move o agregado pra 40. Sem stake-weighting este teste falha.
    const perBetYields = [100, -100, 90, 90]; // (profit/stake)*100 por aposta
    const unweightedMean =
      perBetYields.reduce((a, b) => a + b, 0) / perBetYields.length;
    expect(unweightedMean).toBeCloseTo(45, 5);
    expect(k.yield.value).not.toBeCloseTo(unweightedMean, 1);
    // Win rate ignora o stake (3 won / 4 = 75%) — só o Yield é ponderado.
    expect(k.winRate.value).toBeCloseTo(75, 5);
  });

  it("excludes void from win rate denominator", () => {
    const rows = [
      settled("won", "1"),
      settled("lost", "-1"),
      settled("void", "0", { recommendation: "pass", oddAtRecommendation: null }),
    ];
    const k = computeDashboardKpis(rows);
    expect(k.winRate.value).toBe(50); // 1 / (1 + 1)
    expect(k.winRate.n).toBe(2);
  });

  it("flags low sample below 20 and clears it at 20", () => {
    const nineteen = computeDashboardKpis(
      Array.from({ length: 19 }, () => settled("won", "0.92")),
    );
    expect(nineteen.winRate.n).toBe(19);
    expect(nineteen.winRate.lowSample).toBe(true);

    const twenty = computeDashboardKpis(
      Array.from({ length: 20 }, () => settled("won", "0.92")),
    );
    expect(twenty.winRate.n).toBe(20);
    expect(twenty.winRate.lowSample).toBe(false);
  });
});

describe("computeBankrollSeries", () => {
  it("is empty when nothing is settled", () => {
    expect(computeBankrollSeries([row(), row()])).toEqual([]);
  });

  it("accumulates profit in settledAt order, excluding pending rows", () => {
    const rows = [
      row(), // pending, ignored
      settled("won", "1.00", { settledAt: new Date("2026-06-12T20:00:00Z") }),
      settled("lost", "-0.50", { settledAt: new Date("2026-06-13T20:00:00Z") }),
      settled("won", "2.00", { settledAt: new Date("2026-06-14T20:00:00Z") }),
    ];
    const series = computeBankrollSeries(rows);
    expect(series.map((p) => p.cumulative)).toEqual([1, 0.5, 2.5]);
  });
});

describe("applyTableFilters", () => {
  const rows = [
    row({ predictionId: "pend", result: null }),
    settled("won", "1", { predictionId: "won", league: "world_cup" }),
    settled("lost", "-1", { predictionId: "lost", league: "champions_league" }),
  ];

  it("filters by status", () => {
    const out = applyTableFilters(rows, {
      status: "won",
      league: "all",
      market: "all",
    });
    expect(out.map((r) => r.predictionId)).toEqual(["won"]);
  });

  it("filters by league key", () => {
    const out = applyTableFilters(rows, {
      status: "all",
      league: "ucl",
      market: "all",
    });
    expect(out.map((r) => r.predictionId)).toEqual(["lost"]);
  });

  it("returns everything with all-filters", () => {
    const out = applyTableFilters(rows, {
      status: "all",
      league: "all",
      market: "all",
    });
    expect(out).toHaveLength(3);
  });
});

describe("rowStatus", () => {
  it("maps a missing outcome to pending", () => {
    expect(rowStatus(row())).toBe("pending");
    expect(rowStatus(settled("won", "1"))).toBe("won");
  });
});

// ─── Dedup por (matchId, marketKey) — R1 ─────────────────────────────────────

describe("keepLatestPerMatch keys on (matchId, marketKey)", () => {
  it("keeps both markets of the same match (each is an independent bet)", () => {
    const out = keepLatestPerMatch([
      settled("won", "1", {
        matchId: "m1",
        predictionId: "ou",
        marketKey: "over_under",
        marketLabel: "Over/Under gols",
      }),
      settled("lost", "-1", {
        matchId: "m1",
        predictionId: "btts",
        marketKey: "btts",
        marketLabel: "Ambos marcam",
      }),
    ]);
    // Sem a chave composta, uma das duas seria DROPADA (mesmo matchId).
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.predictionId).sort()).toEqual(["btts", "ou"]);
  });

  it("still collapses reanalyses within the same (match, market)", () => {
    const out = keepLatestPerMatch([
      settled("won", "1", {
        matchId: "m1",
        predictionId: "old",
        marketKey: "over_under",
        createdAt: new Date("2026-06-10T00:00:00Z"),
      }),
      settled("won", "1", {
        matchId: "m1",
        predictionId: "new",
        marketKey: "over_under",
        createdAt: new Date("2026-06-11T00:00:00Z"),
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].predictionId).toBe("new");
  });
});

// ─── Segmentação por mercado (#171) ──────────────────────────────────────────

describe("computeSegmentedKpis", () => {
  // Paridade (R2): histórico SÓ over/under — incl. uma row que veio do fallback
  // enum→key (marketId null na query → marketKey "over_under" aqui) — o agregado
  // é byte-a-byte igual ao único segmento.
  it("single market (incl. a fallback-key row) → aggregate === segment", () => {
    const rows = [
      settled("won", "0.92", { predictionId: "a", oddAtRecommendation: "1.92" }),
      settled("lost", "-1.00", { predictionId: "b" }),
      // "row histórica": veio sem marketId, a query coalesceu pra over_under.
      settled("won", "0.95", {
        predictionId: "legacy",
        marketKey: "over_under",
        marketLabel: "Over/Under gols",
        oddAtRecommendation: "1.95",
      }),
    ];
    const { aggregate, segments } = computeSegmentedKpis(rows);
    expect(segments).toHaveLength(1);
    expect(segments[0].marketKey).toBe("over_under");
    expect(segments[0].kpis).toEqual(aggregate);
  });

  // Multi-mercado: 2 marketKeys → cada um segmenta certo; o agregado soma os dois.
  it("two markets segment independently and the aggregate sums them", () => {
    const rows = [
      // over_under: won 1u @2.00 (+1) e lost 1u (-1) → yield 0, n=2
      settled("won", "1.00", {
        predictionId: "ou-w",
        marketKey: "over_under",
        marketLabel: "Over/Under gols",
        oddAtRecommendation: "2.00",
      }),
      settled("lost", "-1.00", {
        predictionId: "ou-l",
        marketKey: "over_under",
        marketLabel: "Over/Under gols",
      }),
      // btts: won 1u @2.00 (+1) → yield 100, n=1
      settled("won", "1.00", {
        predictionId: "btts-w",
        marketKey: "btts",
        marketLabel: "Ambos marcam",
        oddAtRecommendation: "2.00",
      }),
    ];
    const { aggregate, segments } = computeSegmentedKpis(rows);
    expect(segments.map((s) => s.marketKey)).toEqual(["over_under", "btts"]);

    const ou = segments.find((s) => s.marketKey === "over_under")!;
    const btts = segments.find((s) => s.marketKey === "btts")!;
    expect(ou.kpis.yield.value).toBeCloseTo(0, 5); // (+1 -1) / 2
    expect(ou.kpis.yield.n).toBe(2);
    expect(btts.kpis.yield.value).toBeCloseTo(100, 5); // +1 / 1
    expect(btts.kpis.yield.n).toBe(1);

    // Agregado soma os volumes dos dois mercados.
    expect(aggregate.stakedUnits).toBeCloseTo(3, 5); // 1 + 1 + 1
    expect(aggregate.totalProfitUnits).toBeCloseTo(1, 5); // +1 -1 +1
    expect(aggregate.yield.value).toBeCloseTo((1 / 3) * 100, 5);
    expect(aggregate.yield.n).toBe(3);
    expect(aggregate.won).toBe(2);
    expect(aggregate.lost).toBe(1);
  });

  // R6: push NÃO distorce winRate POR SEGMENTO (não basta o teste agregado).
  it("a push does not distort win rate within its own segment", () => {
    const base = [
      settled("won", "0.95", {
        predictionId: "ou-w",
        marketKey: "over_under",
        marketLabel: "Over/Under gols",
        oddAtRecommendation: "1.95",
      }),
      settled("lost", "-1.00", {
        predictionId: "ou-l",
        marketKey: "over_under",
        marketLabel: "Over/Under gols",
      }),
    ];
    const withPush = [
      ...base,
      settled("push", "0", {
        predictionId: "ou-p",
        marketKey: "over_under",
        marketLabel: "Over/Under gols",
        recommendation: "over",
        oddAtRecommendation: "1.95",
      }),
    ];
    const baseSeg = computeSegmentedKpis(base).segments[0];
    const pushSeg = computeSegmentedKpis(withPush).segments[0];
    // O push fica no MESMO segmento over_under e não move winRate nem yield.
    expect(pushSeg.kpis.winRate.value).toBeCloseTo(baseSeg.kpis.winRate.value!, 5);
    expect(pushSeg.kpis.winRate.n).toBe(baseSeg.kpis.winRate.n);
    expect(pushSeg.kpis.yield.value).toBeCloseTo(baseSeg.kpis.yield.value!, 5);
    expect(pushSeg.kpis.yield.n).toBe(baseSeg.kpis.yield.n);
    // push segue visível como settled no segmento.
    expect(pushSeg.kpis.settled).toBe(3);
  });
});

// ─── Régua de graduação D9 (R3) ──────────────────────────────────────────────

describe("computeGraduation", () => {
  it("is not graduated below 30 resolved bets even with positive yield", () => {
    const rows = Array.from({ length: 29 }, (_, i) =>
      settled("won", "0.50", { predictionId: `w${i}`, oddAtRecommendation: "1.50" }),
    );
    const g = computeGraduation(computeDashboardKpis(rows));
    expect(g.resolved).toBe(29);
    expect(g.target).toBe(30);
    expect(g.graduated).toBe(false);
  });

  it("graduates at >=30 resolved with positive yield", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      settled("won", "0.50", { predictionId: `w${i}`, oddAtRecommendation: "1.50" }),
    );
    const g = computeGraduation(computeDashboardKpis(rows));
    expect(g.resolved).toBe(30);
    expect(g.graduated).toBe(true);
  });

  it("does NOT graduate at >=30 resolved when yield is negative", () => {
    // 30 losses → yield negative, resolved 30 → still not graduated.
    const rows = Array.from({ length: 30 }, (_, i) =>
      settled("lost", "-1.00", { predictionId: `l${i}` }),
    );
    const g = computeGraduation(computeDashboardKpis(rows));
    expect(g.resolved).toBe(30);
    expect(g.graduated).toBe(false);
  });

  it("guards the zero-denominator (yield null) case", () => {
    // No resolved bets (only pending) → yield.value null → not graduated, no NaN.
    const g = computeGraduation(computeDashboardKpis([row(), row()]));
    expect(g.resolved).toBe(0);
    expect(g.graduated).toBe(false);
  });
});

// ─── Breakdown por banda de stake (R4) ───────────────────────────────────────

describe("computeYieldByStakeBand", () => {
  it("scopes to settled bets and computes EXACT independent per-band yields", () => {
    const rows = [
      // 1u: won @2.00 (+1.0) + lost (-1.0) → stake 2, profit 0 → yield 0
      settled("won", "1.00", { predictionId: "w1", stakeUnits: "1.00", oddAtRecommendation: "2.00" }),
      settled("lost", "-1.00", { predictionId: "l1", stakeUnits: "1.00" }),
      // 2u: won @2.00 (+2.0) → stake 2, profit 2 → yield 100
      settled("won", "2.00", { predictionId: "w2", stakeUnits: "2.00", oddAtRecommendation: "2.00" }),
      // 3u: lost (-3.0) → stake 3, profit -3 → yield -100
      settled("lost", "-3.00", { predictionId: "l3", stakeUnits: "3.00" }),
      // pass (stake "1.00") MUST NOT inflate the 1u band
      settled("void", "0", {
        predictionId: "pass1",
        recommendation: "pass",
        stakeUnits: "1.00",
        oddAtRecommendation: null,
      }),
      // a void real bet (1u) MUST NOT enter the 1u band either
      settled("void", "0", {
        predictionId: "void1",
        recommendation: "over",
        stakeUnits: "1.00",
        oddAtRecommendation: "1.95",
      }),
      // a push real bet (1u, no-action — devolve o stake) também é excluída
      settled("push", "0", {
        predictionId: "push1",
        recommendation: "over",
        stakeUnits: "1.00",
        oddAtRecommendation: "1.95",
      }),
    ];
    const bands = computeYieldByStakeBand(rows);
    const byBand = Object.fromEntries(bands.map((b) => [b.band, b]));

    expect(byBand["1u"].yield.value).toBeCloseTo(0, 5);
    expect(byBand["1u"].yield.n).toBe(2); // pass + void + push excluídos
    expect(byBand["1u"].stakedUnits).toBeCloseTo(2, 5);

    expect(byBand["2u"].yield.value).toBeCloseTo(100, 5);
    expect(byBand["2u"].yield.n).toBe(1);

    expect(byBand["3u"].yield.value).toBeCloseTo(-100, 5);
    expect(byBand["3u"].yield.n).toBe(1);
  });

  it("collapses an all-1u history into the 1u band == aggregate (parity)", () => {
    const rows = [
      settled("won", "0.92", { predictionId: "a", stakeUnits: "1.00", oddAtRecommendation: "1.92" }),
      settled("lost", "-1.00", { predictionId: "b", stakeUnits: "1.00" }),
      settled("won", "0.90", { predictionId: "c", stakeUnits: "1.00", oddAtRecommendation: "1.90" }),
    ];
    const agg = computeDashboardKpis(rows);
    const bands = computeYieldByStakeBand(rows);
    const oneU = bands.find((b) => b.band === "1u")!;
    const twoU = bands.find((b) => b.band === "2u")!;
    const threeU = bands.find((b) => b.band === "3u")!;

    // Tudo cai na banda 1u; o yield 1u é o agregado.
    expect(oneU.yield.value).toBeCloseTo(agg.yield.value!, 5);
    expect(oneU.yield.n).toBe(agg.yield.n);
    expect(oneU.stakedUnits).toBeCloseTo(agg.stakedUnits, 5);
    // 2u/3u vazias → yield null, n 0.
    expect(twoU.yield.value).toBeNull();
    expect(twoU.yield.n).toBe(0);
    expect(threeU.yield.value).toBeNull();
    expect(threeU.yield.n).toBe(0);
  });
});

// ─── Filtro de mercado dinâmico (R5) ─────────────────────────────────────────

describe("applyTableFilters by marketKey", () => {
  it("filters rows by the canonical marketKey", () => {
    const rows = [
      settled("won", "1", { predictionId: "ou", marketKey: "over_under", marketLabel: "Over/Under gols" }),
      settled("won", "1", { predictionId: "btts", marketKey: "btts", marketLabel: "Ambos marcam" }),
    ];
    const out = applyTableFilters(rows, {
      status: "all",
      league: "all",
      market: "btts",
    });
    expect(out.map((r) => r.predictionId)).toEqual(["btts"]);
  });
});
