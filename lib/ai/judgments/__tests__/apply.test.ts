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
  const FACTORS = [
    "attack_weakened",
    "defense_weakened",
    "rotation_risk",
    "high_stakes",
  ] as const;

  it('noul ≤ 0.5 é neutro (m = 1): um "não" nunca move λ', () => {
    for (const f of FACTORS) {
      expect(factorMultiplier(f, 0.5)).toBe(1);
      expect(factorMultiplier(f, 0.2)).toBe(1);
      expect(factorMultiplier(f, 0)).toBe(1);
    }
  });

  it("noul 1 vai a 1 ± w com o sinal da tabela", () => {
    expect(factorMultiplier("attack_weakened", 1)).toBeCloseTo(0.94);
    expect(factorMultiplier("defense_weakened", 1)).toBeCloseTo(1.06);
    expect(factorMultiplier("rotation_risk", 1)).toBeCloseTo(0.95);
    expect(factorMultiplier("high_stakes", 1)).toBeCloseTo(1.03);
  });

  it("é monotônico e linear acima de 0.5", () => {
    expect(factorMultiplier("attack_weakened", 0.75)).toBeCloseTo(0.97);
  });

  it("valor não finito → neutro", () => {
    expect(factorMultiplier("attack_weakened", Number.NaN)).toBe(1);
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

  it("todos os fatores num time ficam dentro do clamp com os pesos v1", () => {
    const r = applyJudgments(
      LAMBDAS,
      answers({
        high_stakes_home: [1, 1],
        defense_weakened_away: [1, 1],
        attack_weakened_away: [1, 1],
        rotation_risk_away: [1, 1],
      })
    );
    expect(r.multipliers?.home.applied).toBeCloseTo(1.03 * 1.06);
    expect(r.multipliers?.away.applied).toBeCloseTo(0.94 * 0.95);
    expect(r.multipliers?.home.applied).toBeLessThanOrEqual(
      TEAM_MULTIPLIER_MAX
    );
    expect(r.multipliers?.away.applied).toBeGreaterThanOrEqual(
      TEAM_MULTIPLIER_MIN
    );
  });

  it('jogo típico (tudo "não") não enviesa λ', () => {
    const allNo = Object.fromEntries(
      JUDGMENT_QUESTION_IDS.map((id) => [id, [0.05, 1] as [number, number]])
    ) as Partial<Record<JudgmentQuestionId, [number, number]>>;
    const r = applyJudgments(LAMBDAS, answers(allNo));
    expect(r.lambdaHome).toBe(1.5);
    expect(r.lambdaAway).toBe(1.0);
  });
});
