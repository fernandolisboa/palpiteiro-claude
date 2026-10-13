import { describe, expect, it } from "vitest";

import type { BetLegParams } from "@/db/schema";
import type { AnalysisMarket } from "@/lib/bets/analysis-probs";
import {
  evaluateSlip,
  MATCH_STAKE_CAP_UNITS,
  type EvaluatedLeg,
  type GradedLeg,
  type ReferenceMarket,
  type SlipLegInput,
  type SlipMode,
} from "@/lib/bets/evaluate-slip";
import type { ModelScoreline } from "@/lib/quant/match-model";
import {
  jointProbability,
  p1X2,
  pOverUnder,
  pScoreline,
  scorelineMatrix,
} from "@/lib/quant/scoreline-model";

const MODEL: ModelScoreline = {
  source: "dixon_coles",
  degraded: false,
  lambdaHome: 1.6,
  lambdaAway: 1.0,
  matrix: scorelineMatrix(1.6, 1.0),
};

const CAPTURED_AT = new Date("2026-10-12T12:00:00Z");

function ref(odds: Record<string, number>): ReferenceMarket {
  return { bookmaker: "pinnacle", capturedAt: CAPTURED_AT, odds };
}

function analysisMarket(
  probs: Record<string, number>,
  predictionId = "pred-1"
): AnalysisMarket {
  return { predictionId, createdAt: new Date("2026-10-12T10:00:00Z"), probs };
}

function leg(
  kind: string,
  params: BetLegParams,
  userOdd: number | null = null,
  stakeUnits: number | null = null
): SlipLegInput {
  return { kind, params, userOdd, stakeUnits };
}

function evaluate(over: {
  mode?: SlipMode;
  legs: SlipLegInput[];
  model?: ModelScoreline | null;
  references?: Map<string, ReferenceMarket>;
  analysis?: Map<string, AnalysisMarket>;
  comboUserOdd?: number | null;
  comboStakeUnits?: number | null;
}) {
  return evaluateSlip({
    mode: over.mode ?? "simples",
    legs: over.legs,
    model: over.model === undefined ? MODEL : over.model,
    references: over.references ?? new Map(),
    analysis: over.analysis ?? new Map(),
    comboUserOdd: over.comboUserOdd ?? null,
    comboStakeUnits: over.comboStakeUnits ?? null,
  });
}

function graded(l: EvaluatedLeg | undefined): GradedLeg {
  if (!l || l.status !== "graded") {
    throw new Error(`perna não gradeada: ${l?.status}`);
  }
  return l;
}

const HOME = { selection: "home" } as BetLegParams;
const DRAW = { selection: "draw" } as BetLegParams;
const AWAY = { selection: "away" } as BetLegParams;
const OVER_25 = { selection: "over", line: 2.5 } as BetLegParams;
const OVER_15 = { selection: "over", line: 1.5 } as BetLegParams;

describe("evaluateSlip — perna de 1X2 pelo modelo de placar", () => {
  it("gradeia com a prob da matriz, odd justa 100/prob e o motor do modelo", () => {
    const res = evaluate({ legs: [leg("match_result", HOME)] });
    const l = graded(res.legs[0]);
    const expected = p1X2(MODEL.matrix).home * 100;
    expect(l.modelProbPct).toBeCloseTo(expected, 10);
    expect(l.fairOdd).toBeCloseTo(100 / expected, 10);
    expect(l.origin).toBe("model");
    expect(l.source).toBe("dixon_coles");
    expect(l.predictionId).toBeNull();
    expect(l.degradedData).toBe(false);
    expect(l.reference).toBeNull();
  });

  it("modelo heurístico degradado propaga source e degradedData", () => {
    const res = evaluate({
      legs: [leg("match_result", AWAY)],
      model: { ...MODEL, source: "heuristic", degraded: true },
    });
    const l = graded(res.legs[0]);
    expect(l.source).toBe("heuristic");
    expect(l.degradedData).toBe(true);
  });
});

describe("evaluateSlip — análise do mercado tem precedência sobre o modelo", () => {
  it("usa a prob da análise (origin analysis, predictionId, source null)", () => {
    const res = evaluate({
      legs: [leg("match_result", HOME)],
      analysis: new Map([
        ["match_result", analysisMarket({ home: 61.2 }, "pred-xyz")],
      ]),
    });
    const l = graded(res.legs[0]);
    expect(l.modelProbPct).toBe(61.2);
    expect(l.origin).toBe("analysis");
    expect(l.predictionId).toBe("pred-xyz");
    expect(l.source).toBeNull();
    expect(l.fairOdd).toBeCloseTo(100 / 61.2, 10);
  });

  it("seleção que a análise não gravou cai no modelo", () => {
    const res = evaluate({
      legs: [leg("match_result", AWAY)],
      analysis: new Map([["match_result", analysisMarket({ home: 61.2 })]]),
    });
    const l = graded(res.legs[0]);
    expect(l.origin).toBe("model");
    expect(l.predictionId).toBeNull();
    expect(l.modelProbPct).toBeCloseTo(p1X2(MODEL.matrix).away * 100, 10);
  });

  it("over/under só casa a análise da MESMA linha", () => {
    const analysis = new Map([
      ["over_under:2.5", analysisMarket({ over: 57 })],
    ]);
    const res = evaluate({
      legs: [leg("over_under", OVER_25), leg("over_under", OVER_15)],
      analysis,
    });
    expect(graded(res.legs[0]).origin).toBe("analysis");
    expect(graded(res.legs[0]).modelProbPct).toBe(57);
    const l15 = graded(res.legs[1]);
    expect(l15.origin).toBe("model");
    expect(l15.modelProbPct).toBeCloseTo(
      pOverUnder(MODEL.matrix, 1.5) * 100,
      10
    );
  });

  it("dupla chance mapeia home_draw → home_or_draw da análise", () => {
    const res = evaluate({
      legs: [leg("double_chance", { selection: "home_draw" } as BetLegParams)],
      analysis: new Map([
        ["double_chance", analysisMarket({ home_or_draw: 77 })],
      ]),
    });
    expect(graded(res.legs[0]).modelProbPct).toBe(77);
    expect(graded(res.legs[0]).origin).toBe("analysis");
  });
});

describe("evaluateSlip — edge só contra o mercado COMPLETO de-vigado", () => {
  const ODDS_1X2 = { home: 2.0, draw: 3.4, away: 4.0 };

  it("implícita normalizada pelo overround (Σ ≈ 100 nas 3 seleções, nunca 1/odd cru)", () => {
    const res = evaluate({
      legs: [
        leg("match_result", HOME),
        leg("match_result", DRAW),
        leg("match_result", AWAY),
      ],
      references: new Map([["match_result", ref(ODDS_1X2)]]),
    });
    const refs = res.legs.map((l) => graded(l).reference);
    for (const r of refs) expect(r).not.toBeNull();
    const sum = refs.reduce((s, r) => s + r!.impliedPct, 0);
    expect(sum).toBeCloseTo(100, 1);

    const overround = 1 / 2.0 + 1 / 3.4 + 1 / 4.0;
    const homeRef = refs[0]!;
    expect(homeRef.impliedPct).toBeCloseTo((0.5 / overround) * 100, 1);
    // Nunca o 1/odd cru (50%).
    expect(homeRef.impliedPct).not.toBeCloseTo(50, 1);
    expect(homeRef.odd).toBe(2.0);
    expect(homeRef.bookmaker).toBe("pinnacle");
    expect(homeRef.capturedAt).toBe(CAPTURED_AT);

    const homeLeg = graded(res.legs[0]);
    expect(homeRef.edgePct).toBeCloseTo(
      homeLeg.modelProbPct - homeRef.impliedPct,
      1
    );
  });

  it("mercado incompleto (falta uma seleção) → sem referência", () => {
    const res = evaluate({
      legs: [leg("match_result", HOME)],
      references: new Map([["match_result", ref({ home: 2.0, away: 4.0 })]]),
    });
    const l = graded(res.legs[0]);
    expect(l.reference).toBeNull();
    expect(l.belowEdgeFloor).toBe(false);
  });

  it("odd ≤ 1 em alguma seleção do mercado → sem referência", () => {
    const res = evaluate({
      legs: [leg("match_result", HOME)],
      references: new Map([
        ["match_result", ref({ home: 2.0, draw: 1, away: 4.0 })],
      ]),
    });
    expect(graded(res.legs[0]).reference).toBeNull();
  });

  it("over/under usa a captura da linha da perna", () => {
    const references = new Map([
      ["over_under:2.5", ref({ over: 1.9, under: 1.95 })],
    ]);
    const res = evaluate({
      legs: [leg("over_under", OVER_25), leg("over_under", OVER_15)],
      references,
    });
    const r25 = graded(res.legs[0]).reference;
    expect(r25).not.toBeNull();
    const overround = 1 / 1.9 + 1 / 1.95;
    expect(r25!.impliedPct).toBeCloseTo((1 / 1.9 / overround) * 100, 1);
    expect(graded(res.legs[1]).reference).toBeNull();
  });

  it("dupla chance de-viga com Σ = 200 (cobertura sobreposta)", () => {
    const references = new Map([
      [
        "double_chance",
        ref({ home_or_draw: 1.3, home_or_away: 1.35, away_or_draw: 1.8 }),
      ],
    ]);
    const res = evaluate({
      legs: (["home_draw", "home_away", "draw_away"] as const).map(
        (selection) => leg("double_chance", { selection } as BetLegParams)
      ),
      references,
    });
    const sum = res.legs.reduce(
      (s, l) => s + graded(l).reference!.impliedPct,
      0
    );
    expect(sum).toBeCloseTo(200, 1);
  });

  it("edge abaixo do piso → belowEdgeFloor; sinal oposto ao EV → coherenceWarning", () => {
    const res = evaluate({
      legs: [leg("match_result", HOME, 2.5)],
      references: new Map([["match_result", ref(ODDS_1X2)]]),
      analysis: new Map([["match_result", analysisMarket({ home: 45 })]]),
    });
    const l = graded(res.legs[0]);
    expect(l.reference!.edgePct).toBeLessThan(0);
    expect(l.belowEdgeFloor).toBe(true);
    expect(l.evPerUnit).toBeCloseTo(0.45 * 2.5 - 1, 10);
    expect(l.coherenceWarning).toBe(true);
  });

  it("placar exato NUNCA tem edge de referência", () => {
    const references = new Map([
      ["match_result", ref(ODDS_1X2)],
      ["over_under:2.5", ref({ over: 1.9, under: 1.95 })],
      ["btts", ref({ yes: 1.8, no: 2.0 })],
    ]);
    const res = evaluate({
      legs: [leg("exact_score", { home: 1, away: 0 } as BetLegParams, 7.5)],
      references,
    });
    const l = graded(res.legs[0]);
    expect(l.modelProbPct).toBeCloseTo(
      pScoreline(MODEL.matrix, 1, 0) * 100,
      10
    );
    expect(l.reference).toBeNull();
    expect(l.belowEdgeFloor).toBe(false);
    expect(l.coherenceWarning).toBe(false);
  });
});

describe("evaluateSlip — cartões/escanteios", () => {
  it("cards/corners → not_covered (mesmo com modelo)", () => {
    const res = evaluate({
      legs: [
        leg("cards", { selection: "over", line: 4.5 } as BetLegParams, 1.9),
        leg("corners", { selection: "under", line: 9.5 } as BetLegParams, 1.8),
      ],
    });
    expect(res.legs.map((l) => l.status)).toEqual([
      "not_covered",
      "not_covered",
    ]);
    expect(res.legs[0].userOdd).toBe(1.9);
    expect(res.cappedAtMatchLimit).toBe(false);
  });
});

describe("evaluateSlip — stake sugerido", () => {
  it("sem odd → sem EV, sem break-even e sem stake", () => {
    const res = evaluate({ legs: [leg("match_result", HOME)] });
    const l = graded(res.legs[0]);
    expect(l.evPerUnit).toBeNull();
    expect(l.breakEvenProbPct).toBeNull();
    expect(l.suggestedStake).toBeNull();
    expect(l.kellyInfo).toBeNull();
  });

  it("EV negativo → sem stake", () => {
    const res = evaluate({ legs: [leg("match_result", HOME, 1.2)] });
    const l = graded(res.legs[0]);
    expect(l.evPerUnit).toBeLessThan(0);
    expect(l.breakEvenProbPct).toBeCloseTo(100 / 1.2, 10);
    expect(l.suggestedStake).toBeNull();
    expect(l.kellyInfo).toBeNull();
  });

  it("EV exatamente zero → sem stake", () => {
    const res = evaluate({
      legs: [leg("match_result", HOME, 2.0)],
      analysis: new Map([["match_result", analysisMarket({ home: 50 })]]),
    });
    const l = graded(res.legs[0]);
    expect(l.evPerUnit).toBe(0);
    expect(l.suggestedStake).toBeNull();
  });

  it("EV positivo sem referência → bandas 1u + quarter-Kelly informativo", () => {
    const res = evaluate({
      legs: [leg("match_result", HOME, 2.5)],
      analysis: new Map([["match_result", analysisMarket({ home: 60 })]]),
    });
    const l = graded(res.legs[0]);
    expect(l.suggestedStake).toEqual({ units: 1, rule: "bandas" });
    expect(l.kellyInfo?.rule).toBe("quarter-kelly");
    expect(res.cappedAtMatchLimit).toBe(false);
  });

  it("Simples com várias pernas de valor: soma limitada ao teto de 3u por jogo", () => {
    const references = new Map([
      ["match_result", ref({ home: 2.5, draw: 3.3, away: 3.0 })],
      ["over_under:2.5", ref({ over: 2.5, under: 1.5 })],
    ]);
    const analysis = new Map([
      ["match_result", analysisMarket({ home: 60 })],
      ["over_under:2.5", analysisMarket({ over: 60 })],
    ]);
    const res = evaluate({
      legs: [leg("match_result", HOME, 2.5), leg("over_under", OVER_25, 2.5)],
      references,
      analysis,
    });
    expect(MATCH_STAKE_CAP_UNITS).toBe(3);
    const legs = res.legs.map(graded);
    // Cada perna sozinha daria 3u (edge ≥ 12pp, prob ≥ 55%) — 6u no total.
    for (const l of legs)
      expect(l.reference!.edgePct).toBeGreaterThanOrEqual(12);
    expect(res.cappedAtMatchLimit).toBe(true);
    const total = legs.reduce((s, l) => s + (l.suggestedStake?.units ?? 0), 0);
    expect(total).toBeLessThanOrEqual(MATCH_STAKE_CAP_UNITS);
    for (const l of legs) {
      expect(l.suggestedStake).toEqual({ units: 1.5, rule: "bandas" });
      // Kelly informativo é o SIMULTÂNEO (as duas estão na matriz).
      expect(l.kellyInfo?.rule).toBe("quarter-kelly-conjunto");
    }
    const kellyTotal = legs.reduce((s, l) => s + (l.kellyInfo?.units ?? 0), 0);
    expect(kellyTotal).toBeLessThanOrEqual(MATCH_STAKE_CAP_UNITS);
  });

  it("4 pernas de 1u → reduz em degraus de 0.5u e preenche o teto sem passar", () => {
    const analysis = new Map([
      ["match_result", analysisMarket({ home: 60 })],
      ["over_under:2.5", analysisMarket({ over: 60 })],
      ["btts", analysisMarket({ yes: 60 })],
      ["double_chance", analysisMarket({ home_or_draw: 80 })],
    ]);
    const res = evaluate({
      legs: [
        leg("match_result", HOME, 2.5),
        leg("over_under", OVER_25, 2.5),
        leg("btts", { selection: "yes" } as BetLegParams, 2.5),
        leg("double_chance", { selection: "home_draw" } as BetLegParams, 1.6),
      ],
      analysis,
    });
    expect(res.cappedAtMatchLimit).toBe(true);
    const legs = res.legs.map(graded);
    const total = legs.reduce((s, l) => s + (l.suggestedStake?.units ?? 0), 0);
    expect(total).toBe(MATCH_STAKE_CAP_UNITS);
    for (const l of legs) {
      const u = l.suggestedStake?.units ?? 0;
      expect(Number.isInteger(u * 2)).toBe(true);
      expect(u).toBeLessThanOrEqual(1);
    }
  });
});

describe("evaluateSlip — teto por jogo com muitas pernas", () => {
  it("7 pernas de 1u → nenhuma some: soma exatamente 3u em degraus de 0.5u", () => {
    const scores = ["1-0", "2-0", "2-1", "1-1", "0-0", "3-1", "0-1"].map((s) => {
      const [home, away] = s.split("-").map(Number);
      return leg("exact_score", { home, away } as BetLegParams, 60);
    });
    const res = evaluate({ legs: scores });
    const legs = res.legs.map(graded);
    for (const l of legs) expect(l.evPerUnit!).toBeGreaterThan(0);
    expect(res.cappedAtMatchLimit).toBe(true);
    const units = legs.map((l) => l.suggestedStake?.units ?? 0);
    expect(units.reduce((a, b) => a + b, 0)).toBe(MATCH_STAKE_CAP_UNITS);
    for (const u of units) expect(Number.isInteger(u * 2)).toBe(true);
    expect(units.filter((u) => u > 0).length).toBeGreaterThanOrEqual(6);
  });
});

describe("evaluateSlip — combinada", () => {
  it("perna da combinada não ganha stake sugerido nem Kelly (o stake é da combinada)", () => {
    const res = evaluate({
      mode: "combinada",
      legs: [leg("match_result", HOME, 3.0), leg("over_under", OVER_25, 3.0)],
      comboUserOdd: 9,
    });
    for (const l of res.legs.map(graded)) {
      expect(l.suggestedStake).toBeNull();
      expect(l.kellyInfo).toBeNull();
    }
  });

  it("conjunta sai da matriz (não do produto das marginais)", () => {
    const res = evaluate({
      mode: "combinada",
      legs: [leg("match_result", HOME, 2.0), leg("over_under", OVER_25, 1.9)],
      comboUserOdd: 3.8,
      comboStakeUnits: 2,
    });
    expect(res.mode).toBe("combinada");
    expect(res.cappedAtMatchLimit).toBe(false);
    const combo = res.combo;
    if (combo?.status !== "graded") throw new Error("combo não gradeada");
    const joint =
      jointProbability(MODEL.matrix, [(h, a) => h > a, (h, a) => h + a > 2.5]) *
      100;
    const pHome = p1X2(MODEL.matrix).home * 100;
    const pOver = pOverUnder(MODEL.matrix, 2.5) * 100;
    expect(combo.jointProbPct).toBeCloseTo(joint, 10);
    expect(combo.marginalsPct[0]).toBeCloseTo(pHome, 10);
    expect(combo.marginalsPct[1]).toBeCloseTo(pOver, 10);
    // Correlacionadas: a conjunta não é o produto.
    expect(combo.jointProbPct).not.toBeCloseTo((pHome * pOver) / 100, 2);
    expect(combo.jointProbPct).toBeLessThanOrEqual(Math.min(pHome, pOver));
    expect(combo.fairOdd).toBeCloseTo(100 / joint, 10);
    expect(combo.source).toBe("dixon_coles");
    expect(combo.comboUserOdd).toBe(3.8);
    expect(combo.comboStakeUnits).toBe(2);
    expect(combo.evPerUnit).toBeCloseTo((joint / 100) * 3.8 - 1, 10);
    expect(combo.breakEvenProbPct).toBeCloseTo(100 / 3.8, 10);
    if (combo.evPerUnit! > 0) {
      expect(combo.suggestedStake).toEqual({ units: 1, rule: "bandas" });
    } else {
      expect(combo.suggestedStake).toBeNull();
    }
  });

  it("sem odd combinada → sem EV nem stake da combinada", () => {
    const res = evaluate({
      mode: "combinada",
      legs: [
        leg("match_result", HOME),
        leg("btts", { selection: "yes" } as BetLegParams),
      ],
    });
    if (res.combo?.status !== "graded") throw new Error("combo não gradeada");
    expect(res.combo.evPerUnit).toBeNull();
    expect(res.combo.suggestedStake).toBeNull();
    expect(res.combo.kellyInfo).toBeNull();
  });

  it("modelo null → not_evaluated 'sem-modelo' (mesmo com as pernas vindas da análise)", () => {
    const res = evaluate({
      mode: "combinada",
      model: null,
      legs: [leg("match_result", HOME, 2.0), leg("over_under", OVER_25, 1.9)],
      analysis: new Map([
        ["match_result", analysisMarket({ home: 55 })],
        ["over_under:2.5", analysisMarket({ over: 52 })],
      ]),
      comboUserOdd: 3.8,
    });
    expect(res.combo).toEqual({
      status: "not_evaluated",
      reason: "sem-modelo",
    });
    expect(res.legs.map((l) => l.status)).toEqual(["graded", "graded"]);
  });

  it("perna fora da matriz (1º tempo) → not_evaluated 'fora-da-matriz'", () => {
    const res = evaluate({
      mode: "combinada",
      legs: [
        leg("match_result", HOME),
        leg("first_half_score", { home: 1, away: 0 } as BetLegParams),
      ],
      comboUserOdd: 6,
    });
    expect(res.combo).toEqual({
      status: "not_evaluated",
      reason: "fora-da-matriz",
    });
  });

  it("perna de cartões → not_evaluated 'fora-da-matriz'", () => {
    const res = evaluate({
      mode: "combinada",
      legs: [
        leg("match_result", HOME),
        leg("cards", { selection: "over", line: 4.5 } as BetLegParams),
      ],
    });
    expect(res.combo).toEqual({
      status: "not_evaluated",
      reason: "fora-da-matriz",
    });
  });
});

describe("evaluateSlip — modelo indisponível", () => {
  it("modelo null → pernas sem número viram no_data, sem lançar", () => {
    const res = evaluate({
      model: null,
      legs: [
        leg("match_result", HOME, 2.0, 1),
        leg("exact_score", { home: 2, away: 1 } as BetLegParams, 9),
        leg("corners", { selection: "over", line: 9.5 } as BetLegParams),
      ],
    });
    expect(res.legs.map((l) => l.status)).toEqual([
      "no_data",
      "no_data",
      "not_covered",
    ]);
    expect(res.legs[0].stakeUnits).toBe(1);
    expect(res.legs[0].userOdd).toBe(2.0);
    expect(res.cappedAtMatchLimit).toBe(false);
    expect(res.combo).toBeNull();
  });

  it("modelo null mas com análise → perna gradeada pela análise", () => {
    const res = evaluate({
      model: null,
      legs: [
        leg("match_result", HOME, 2.5),
        leg("btts", { selection: "no" } as BetLegParams, 2),
      ],
      analysis: new Map([["match_result", analysisMarket({ home: 60 })]]),
    });
    const l = graded(res.legs[0]);
    expect(l.origin).toBe("analysis");
    expect(l.suggestedStake).toEqual({ units: 1, rule: "bandas" });
    expect(l.kellyInfo?.rule).toBe("quarter-kelly");
    expect(res.legs[1].status).toBe("no_data");
  });
});
