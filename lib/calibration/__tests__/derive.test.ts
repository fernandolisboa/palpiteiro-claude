import { describe, expect, it } from "vitest";

import {
  deriveCalibration,
  deriveCalibrationByEngine,
  deriveCalibrationByMarket,
  filterByEngineSegment,
  filterByMarket,
  parseEngineSegment,
} from "@/lib/calibration/derive";
import { parseMarketSegment } from "@/lib/calibration/markets";
import { logLoss } from "@/lib/calibration/metrics";
import type { MarketCalibrationRow } from "@/lib/db/queries/calibration";

const row = (
  promptVersion: string,
  modelPOver: number,
  marketPOver: number,
  overHappened: 0 | 1,
): MarketCalibrationRow => ({
  marketKey: "over_under",
  promptVersion,
  model: [{ p: modelPOver, y: overHappened }],
  market: [{ p: marketPOver, y: overHappened }],
  isBet: true,
  engine: "llm",
  engineConfig: null,
});

const JEV_CONFIG = "lambda=heuristic;judg=jev_judgments_v1;w=judgment_weights_v1";
const jevRow = (
  modelPOver: number,
  marketPOver: number,
  overHappened: 0 | 1,
  isBet = true,
): MarketCalibrationRow => ({
  marketKey: "over_under",
  promptVersion: "narrator_v1",
  model: [{ p: modelPOver, y: overHappened }],
  market: [{ p: marketPOver, y: overHappened }],
  isBet,
  engine: "code_jev",
  engineConfig: JEV_CONFIG,
});

describe("deriveCalibration", () => {
  it("vazio → overall null, byVersion vazio", () => {
    const { overall, byVersion } = deriveCalibration([]);
    expect(overall).toBeNull();
    expect(byVersion).toHaveLength(0);
  });

  it("agrupa por versão + overall agregado", () => {
    const rows = [
      row("over_under_v3.2", 0.6, 0.55, 1),
      row("over_under_v3.2", 0.4, 0.5, 0),
      row("over_under_v3.1", 0.5, 0.5, 1),
    ];
    const { overall, byVersion } = deriveCalibration(rows);
    expect(overall?.n).toBe(3);
    expect(byVersion.map((g) => g.version)).toEqual([
      "over_under_v3.2", // n=2 primeiro
      "over_under_v3.1", // n=1
    ]);
    expect(byVersion[0].n).toBe(2);
  });

  it("skill > 0 quando o modelo bate o mercado (log-loss menor)", () => {
    // modelo perfeito (p bate y), mercado no fio da navalha (0.5) → skill LL > 0.
    const rows = [
      row("v", 0.99, 0.5, 1),
      row("v", 0.01, 0.5, 0),
    ];
    const { overall } = deriveCalibration(rows);
    expect(overall!.model.logLoss).toBeLessThan(overall!.market.logLoss);
    expect(overall!.logLossSkill).toBeGreaterThan(0);
    expect(overall!.brierSkill).toBeGreaterThan(0);
  });

  it("skill < 0 quando o mercado bate o modelo", () => {
    const rows = [
      row("v", 0.5, 0.99, 1),
      row("v", 0.5, 0.01, 0),
    ];
    const { overall } = deriveCalibration(rows);
    expect(overall!.logLossSkill).toBeLessThan(0);
  });
});

describe("deriveCalibration · versão do code_jev", () => {
  it("agrupa o code_jev pelas tags do motor, não pelo narrador", () => {
    const rows = [
      row("over_under_v3.2", 0.6, 0.55, 1),
      jevRow(0.55, 0.5, 1),
      jevRow(0.45, 0.5, 0),
    ];
    const { overall, byVersion } = deriveCalibration(rows);
    expect(overall?.n).toBe(3);
    expect(byVersion.map((g) => [g.version, g.n])).toEqual([
      [JEV_CONFIG, 2],
      ["over_under_v3.2", 1],
    ]);
  });

  it("code_jev sem tags de config cai no promptVersion", () => {
    const { byVersion } = deriveCalibration([
      { ...jevRow(0.5, 0.5, 1), engineConfig: null },
    ]);
    expect(byVersion[0].version).toBe("narrator_v1");
  });
});

describe("segmentação por motor", () => {
  const rows = [
    row("over_under_v3.2", 0.6, 0.55, 1),
    row("over_under_v3.2", 0.4, 0.5, 0),
    jevRow(0.55, 0.5, 1, false),
    { ...row("x", 0.5, 0.5, 1), engine: null },
  ];

  it("parseEngineSegment: enum válido passa; o resto vira 'all'", () => {
    expect(parseEngineSegment("llm")).toBe("llm");
    expect(parseEngineSegment("code_jev")).toBe("code_jev");
    expect(parseEngineSegment(undefined)).toBe("all");
    expect(parseEngineSegment("foo")).toBe("all");
    expect(parseEngineSegment(["llm"])).toBe("all");
  });

  it("filterByEngineSegment: 'all' mantém tudo (inclusive não atribuídas)", () => {
    expect(filterByEngineSegment(rows, "all")).toHaveLength(4);
    expect(filterByEngineSegment(rows, "llm")).toHaveLength(2);
    expect(filterByEngineSegment(rows, "code_jev")).toHaveLength(1);
  });

  it("deriveCalibrationByEngine: uma linha por motor, na ordem do enum", () => {
    const { engines, unattributed } = deriveCalibrationByEngine(rows);
    expect(engines.map((e) => e.engine)).toEqual(["llm", "code_jev"]);
    expect(engines[0].group?.n).toBe(2);
    expect(engines[0].bets).toBe(2);
    expect(engines[1].group?.n).toBe(1);
    expect(engines[1].bets).toBe(0);
    expect(unattributed).toBe(1);
  });

  it("motor sem amostra aparece com group null", () => {
    const { engines } = deriveCalibrationByEngine([
      row("over_under_v3.2", 0.6, 0.55, 1),
    ]);
    expect(engines[1]).toEqual({ engine: "code_jev", bets: 0, group: null });
  });

  it("as métricas do segmento batem com deriveCalibration no recorte", () => {
    const { engines } = deriveCalibrationByEngine(rows);
    const { overall } = deriveCalibration(filterByEngineSegment(rows, "llm"));
    expect(engines[0].group?.model.logLoss).toBeCloseTo(
      overall!.model.logLoss,
      12,
    );
    expect(engines[0].group?.logLossSkill).toBeCloseTo(
      overall!.logLossSkill,
      12,
    );
  });
});

// 1X2 um-contra-o-resto: 3 pares por predição, na ordem away/draw/home.
const oneX2 = (
  model: [number, number, number],
  market: [number, number, number],
  winner: "away" | "draw" | "home",
  isBet = true,
): MarketCalibrationRow => {
  const ys = (["away", "draw", "home"] as const).map((k) =>
    k === winner ? 1 : 0,
  );
  return {
    marketKey: "match_result",
    promptVersion: "match_result_v1",
    model: model.map((p, i) => ({ p, y: ys[i] })),
    market: market.map((p, i) => ({ p, y: ys[i] })),
    isBet,
    engine: "llm",
    engineConfig: null,
  };
};

describe("calibração por mercado (#453)", () => {
  const rows = [
    row("over_under_v3.2", 0.6, 0.55, 1),
    oneX2([0.2, 0.3, 0.5], [0.25, 0.3, 0.45], "home"),
    oneX2([0.4, 0.3, 0.3], [0.35, 0.3, 0.35], "draw", false),
  ];

  it("filterByMarket recorta pelo marketKey", () => {
    expect(filterByMarket(rows, "over_under")).toHaveLength(1);
    expect(filterByMarket(rows, "match_result")).toHaveLength(2);
    expect(filterByMarket(rows, "btts")).toHaveLength(0);
  });

  it("deriveCalibrationByMarket: todos os mercados, na ordem, sem amostra → null", () => {
    const byMarket = deriveCalibrationByMarket(rows);
    expect(byMarket.map((m) => m.market)).toEqual([
      "over_under",
      "match_result",
      "btts",
      "double_chance",
    ]);
    const mr = byMarket[1];
    expect(mr.bets).toBe(1);
    expect(mr.group?.n).toBe(2); // predições
    expect(mr.group?.model.n).toBe(6); // pares um-contra-o-resto
    expect(byMarket[2].group).toBeNull();
    expect(byMarket[3].group).toBeNull();
  });

  it("N-ário: métricas saem dos pares achatados (um-contra-o-resto)", () => {
    const mr = filterByMarket(rows, "match_result");
    const { overall } = deriveCalibration(mr);
    expect(overall?.model.logLoss).toBeCloseTo(
      logLoss(mr.flatMap((r) => r.model)),
      12,
    );
    expect(overall?.logLossSkill).toBeCloseTo(
      logLoss(mr.flatMap((r) => r.market)) -
        logLoss(mr.flatMap((r) => r.model)),
      12,
    );
  });

  it("parseMarketSegment: fora do enum cai em over/under", () => {
    expect(parseMarketSegment("btts")).toBe("btts");
    expect(parseMarketSegment("double_chance")).toBe("double_chance");
    expect(parseMarketSegment("correct_score")).toBe("over_under");
    expect(parseMarketSegment(["btts"])).toBe("over_under");
    expect(parseMarketSegment(undefined)).toBe("over_under");
  });
});
