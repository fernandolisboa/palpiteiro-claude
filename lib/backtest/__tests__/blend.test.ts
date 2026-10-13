import { describe, expect, it } from "vitest";

import {
  fitBlendWeight,
  pool1x2,
  poolBinary,
  walkForwardBlend,
} from "@/lib/backtest/blend";
import type { HistoricalMatch } from "@/lib/backtest/matches";
import type { EvaluatedMatch, StrategyOutput } from "@/lib/backtest/runner";
import { simulateValueBets, type PriceSource } from "@/lib/backtest/value-bets";

const model = { home: 0.5, draw: 0.3, away: 0.2 };
const market = { home: 0.4, draw: 0.3, away: 0.3 };

describe("pool1x2 / poolBinary", () => {
  it("w = 1 is the model, w = 0 is the market", () => {
    const m = pool1x2(model, market, 1);
    expect(m.home).toBeCloseTo(0.5, 10);
    expect(m.away).toBeCloseTo(0.2, 10);
    expect(pool1x2(model, market, 0).home).toBeCloseTo(0.4, 10);
    expect(poolBinary(0.6, 0.45, 1)).toBeCloseTo(0.6, 10);
    expect(poolBinary(0.6, 0.45, 0)).toBeCloseTo(0.45, 10);
  });

  it("is the normalized geometric mean and sums to 1", () => {
    const w = 0.3;
    const raw = (["home", "draw", "away"] as const).map(
      (k) => model[k] ** w * market[k] ** (1 - w),
    );
    const s = raw.reduce((a, b) => a + b, 0);
    const p = pool1x2(model, market, w);
    expect(p.home).toBeCloseTo(raw[0] / s, 12);
    expect(p.home + p.draw + p.away).toBeCloseTo(1, 12);
  });

  it("binary pool is the weighted logit", () => {
    const logit = (p: number) => Math.log(p / (1 - p));
    const z = 0.25 * logit(0.6) + 0.75 * logit(0.45);
    expect(poolBinary(0.6, 0.45, 0.25)).toBeCloseTo(1 / (1 + Math.exp(-z)), 12);
  });
});

const matchOf = (season: number, i: number, hg: number, ag: number) =>
  ({
    season,
    date: new Date(Date.UTC(season, 0, 1 + i)),
    home: "A",
    away: "B",
    homeGoals: hg,
    awayGoals: ag,
    closingPinnacle: { home: 2, draw: 3.5, away: 4 },
    closingAvg: null,
  }) satisfies HistoricalMatch;

function row(
  season: number,
  i: number,
  homeWins: boolean,
  outputs: Record<string, StrategyOutput | null>,
): EvaluatedMatch {
  const m = matchOf(season, i, homeWins ? 2 : 0, homeWins ? 0 : 1);
  return {
    match: m,
    outcome: homeWins ? "home" : "away",
    over25: 0,
    byStrategy: outputs,
  };
}

// Modelo "oráculo" (acerta quase sempre) e mercado sem informação.
const oracleRows = (season: number) =>
  Array.from({ length: 40 }, (_, i) => {
    const homeWins = i % 2 === 0;
    return row(season, i, homeWins, {
      model: {
        p1x2: homeWins
          ? { home: 0.9, draw: 0.05, away: 0.05 }
          : { home: 0.05, draw: 0.05, away: 0.9 },
      },
      market: { p1x2: { home: 0.45, draw: 0.1, away: 0.45 } },
    });
  });

describe("fitBlendWeight / walkForwardBlend", () => {
  it("puts all weight on an informative model and none on a useless one", () => {
    const rows = oracleRows(2022);
    expect(fitBlendWeight(rows, "model", "market", "1x2")).toBe(1);
    expect(fitBlendWeight(rows, "market", "model", "1x2")).toBe(0);
    expect(fitBlendWeight(rows, "model", "market", "over25")).toBeNull();
  });

  it("fits each season only on earlier seasons", () => {
    const rows = [...oracleRows(2021), ...oracleRows(2022)];
    const out = walkForwardBlend(rows, {
      name: "mix",
      model: "model",
      market: "market",
    });
    expect(out.weights[2021]["1x2"]).toBeNull();
    expect(out.weights[2022]["1x2"]).toBe(1);
    expect(out.rows[0].byStrategy.mix).toBeNull();
    expect(out.rows[40].byStrategy.mix?.p1x2?.home).toBeCloseTo(0.9, 10);
  });

  it("global fit uses fitRows instead of the league's own rows", () => {
    const rows = oracleRows(2022);
    const fitRows = oracleRows(2021).map((r) => ({
      ...r,
      byStrategy: { model: r.byStrategy.market, market: r.byStrategy.model },
    }));
    const out = walkForwardBlend(rows, {
      name: "mix",
      model: "model",
      market: "market",
      fitRows,
    });
    expect(out.weights[2022]["1x2"]).toBe(0);
  });
});

describe("simulateValueBets", () => {
  const price: PriceSource = {
    odds1x2: (r) => r.match.closingPinnacle,
    oddsOu25: () => null,
  };

  it("bets the max-edge selection above the gate at the book's odd", () => {
    // Odds 2 / 3.5 / 4 → implícita proporcional ≈ 0.452 / 0.258 / 0.226 (+ margem).
    // Modelo 0.6 em casa → edge ≈ +14.8 pp; fora 0.2 → negativo.
    const rows = [
      row(2023, 0, true, { m: { p1x2: { home: 0.6, draw: 0.2, away: 0.2 } } }),
      row(2023, 1, false, { m: { p1x2: { home: 0.6, draw: 0.2, away: 0.2 } } }),
      row(2023, 2, false, {
        m: { p1x2: { home: 0.46, draw: 0.27, away: 0.27 } },
      }),
    ];
    const s = simulateValueBets(rows, {
      model: "m",
      market: "1x2",
      price,
      method: "proportional",
      minEdgePp: 5,
    });
    expect(s.bets).toBe(2); // o terceiro jogo fica abaixo de 5 pp
    expect(s.roi).toBeCloseTo((1 + -1) / 2, 10); // ganha 1 (odd 2), perde 1
    // CLV: odd 2 × p_fechamento(casa) − 1, mesma casa e fechamento.
    const raw = [1 / 2, 1 / 3.5, 1 / 4];
    const pHome = raw[0] / raw.reduce((a, b) => a + b, 0);
    expect(s.clv).toBeCloseTo(2 * pHome - 1, 10);
  });
});
