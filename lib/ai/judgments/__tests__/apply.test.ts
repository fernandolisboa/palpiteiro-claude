import { describe, expect, it } from "vitest";

import {
  applyJudgments,
  factorMultiplier,
  JUDGMENT_WEIGHTS_VERSION,
  TEAM_MULTIPLIER_MAX,
  TEAM_MULTIPLIER_MIN,
} from "../apply";
import { JUDGMENT_QUESTION_IDS } from "../questions";
import type { JudgmentAnswers, JudgmentQuestionId } from "../types";

const LAMBDAS = { lambdaHome: 1.5, lambdaAway: 1.0 };

function answers(
  overrides: Partial<Record<JudgmentQuestionId, [number, number]>> = {}
): JudgmentAnswers {
  return Object.fromEntries(
    JUDGMENT_QUESTION_IDS.map((id) => {
      const [value, confidence] = overrides[id] ?? [0.5, 1];
      return [id, { value, confidence }];
    })
  ) as JudgmentAnswers;
}

describe("factorMultiplier", () => {
  it("noul 0.5 é neutro (m = 1) em todo fator", () => {
    for (const f of [
      "attack_weakened",
      "defense_weakened",
      "rotation_risk",
      "high_stakes",
    ] as const) {
      expect(factorMultiplier(f, 0.5, 1)).toBe(1);
    }
  });

  it("extremos ficam em [1 − w, 1 + w] com o sinal da tabela", () => {
    expect(factorMultiplier("attack_weakened", 1, 1)).toBeCloseTo(0.94);
    expect(factorMultiplier("attack_weakened", 0, 1)).toBeCloseTo(1.06);
    expect(factorMultiplier("defense_weakened", 1, 1)).toBeCloseTo(1.06);
    expect(factorMultiplier("rotation_risk", 1, 1)).toBeCloseTo(0.95);
    expect(factorMultiplier("high_stakes", 1, 1)).toBeCloseTo(1.03);
  });

  it("confidence abaixo de 0.3 → tratado como 0.5 (neutro)", () => {
    expect(factorMultiplier("attack_weakened", 1, 0.29)).toBe(1);
    expect(factorMultiplier("attack_weakened", 1, 0.3)).toBeCloseTo(0.94);
  });
});

describe("applyJudgments", () => {
  it("versiona os pesos", () => {
    expect(JUDGMENT_WEIGHTS_VERSION).toBe("judgment_weights_v1");
  });

  it("null → identidade com applied=false (fail-open)", () => {
    const r = applyJudgments(LAMBDAS, null);
    expect(r).toEqual({
      lambdaHome: 1.5,
      lambdaAway: 1.0,
      multipliers: null,
      applied: false,
    });
  });

  it("tudo em 0.5 → λ inalterados, applied=true", () => {
    const r = applyJudgments(LAMBDAS, answers());
    expect(r.applied).toBe(true);
    expect(r.lambdaHome).toBe(1.5);
    expect(r.lambdaAway).toBe(1.0);
    expect(r.multipliers?.home.applied).toBe(1);
  });

  it("defesa enfraquecida do mandante sobe o λ do VISITANTE", () => {
    const r = applyJudgments(
      LAMBDAS,
      answers({ defense_weakened_home: [1, 1] })
    );
    expect(r.lambdaHome).toBe(1.5);
    expect(r.lambdaAway).toBeCloseTo(1.0 * 1.06);
    expect(r.multipliers?.away.factors.defense_weakened_home).toBeCloseTo(1.06);
    expect(r.multipliers?.home.factors).not.toHaveProperty(
      "defense_weakened_home"
    );
  });

  it("ataque enfraquecido e rotação baixam o λ do PRÓPRIO time", () => {
    const r = applyJudgments(
      LAMBDAS,
      answers({ attack_weakened_away: [1, 1], rotation_risk_away: [1, 1] })
    );
    expect(r.lambdaHome).toBe(1.5);
    expect(r.lambdaAway).toBeCloseTo(1.0 * 0.94 * 0.95);
  });

  it("high stakes sobe o λ do próprio time (leve)", () => {
    const r = applyJudgments(LAMBDAS, answers({ high_stakes_home: [1, 1] }));
    expect(r.lambdaHome).toBeCloseTo(1.5 * 1.03);
    expect(r.lambdaAway).toBe(1.0);
  });

  it("clamp no teto: produto 1.06·1.05·1.03·1.06 vira 1.15", () => {
    const r = applyJudgments(
      LAMBDAS,
      answers({
        attack_weakened_home: [0, 1],
        rotation_risk_home: [0, 1],
        high_stakes_home: [1, 1],
        defense_weakened_away: [1, 1],
      })
    );
    expect(r.multipliers?.home.product).toBeGreaterThan(TEAM_MULTIPLIER_MAX);
    expect(r.multipliers?.home.applied).toBe(TEAM_MULTIPLIER_MAX);
    expect(r.lambdaHome).toBeCloseTo(1.5 * 1.15);
  });

  it("clamp no piso: produto 0.94·0.95·0.97·0.94 vira 0.85", () => {
    const r = applyJudgments(
      LAMBDAS,
      answers({
        attack_weakened_away: [1, 1],
        rotation_risk_away: [1, 1],
        high_stakes_away: [0, 1],
        defense_weakened_home: [0, 1],
      })
    );
    expect(r.multipliers?.away.product).toBeLessThan(TEAM_MULTIPLIER_MIN);
    expect(r.multipliers?.away.applied).toBe(TEAM_MULTIPLIER_MIN);
    expect(r.lambdaAway).toBeCloseTo(1.0 * 0.85);
  });

  it("confidence baixa neutraliza o fator no λ", () => {
    const r = applyJudgments(
      LAMBDAS,
      answers({ attack_weakened_home: [1, 0.1] })
    );
    expect(r.lambdaHome).toBe(1.5);
    expect(r.multipliers?.home.factors.attack_weakened_home).toBe(1);
  });
});
