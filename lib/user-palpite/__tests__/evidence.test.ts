import { describe, expect, it } from "vitest";

import { factorMultiplier } from "@/lib/ai/judgments/apply";
import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type {
  JudgmentAnswers,
  JudgmentFactor,
  JudgmentQuestionId,
} from "@/lib/ai/judgments/types";
import {
  combineAnswers,
  computeReadings,
  evidenceFromClaims,
  USER_NOUL,
} from "@/lib/user-palpite/evidence";
import type { PalpiteModelBase } from "@/lib/user-palpite/model-base";
import type { CheckedClaim, ClaimSignal } from "@/lib/user-palpite/types";

function answers(value = 0.3): JudgmentAnswers {
  return Object.fromEntries(
    JUDGMENT_QUESTION_IDS.map((id) => [id, { value, confidence: null }]),
  ) as JudgmentAnswers;
}

function base(jev: JudgmentAnswers | null): PalpiteModelBase {
  return {
    origin: "snapshot",
    snapshotId: "s1",
    modelVersion: "match_model_v1",
    snapshotWeightsVersion: jev ? "judgment_weights_v1" : null,
    source: "dixon_coles",
    degraded: false,
    fallbackReason: null,
    staleBase: false,
    lambdaHomeBase: 1.6,
    lambdaAwayBase: 1.1,
    rho: -0.07,
    jevAnswers: jev,
  };
}

function claim(signals: ClaimSignal[]): CheckedClaim {
  return {
    team: "home",
    topic: "absence",
    text: "o jogador citado está fora",
    players: ["Fulano"],
    index: 0,
    status: "unverifiable",
    evidence: "",
    sides: [{ side: "home", status: "unverifiable" }],
    playerChecks: [],
    signals,
  };
}

const ATTACK_HOME: JudgmentQuestionId = "attack_weakened_home";
const P = { kind: "score", home: 2, away: 0 } as const;

describe("evidenceFromClaims", () => {
  it("não verificável vale 0.7; confirmada sem JEV vale 0.85; confirmada com JEV não sobe", () => {
    const unverified = claim([{ questionId: ATTACK_HOME, strength: "unverified" }]);
    const confirmed = claim([{ questionId: ATTACK_HOME, strength: "confirmed" }]);
    expect(evidenceFromClaims([unverified], { jevApplied: true })).toEqual({
      [ATTACK_HOME]: USER_NOUL.unverified,
    });
    expect(evidenceFromClaims([confirmed], { jevApplied: false })).toEqual({
      [ATTACK_HOME]: USER_NOUL.confirmed,
    });
    expect(evidenceFromClaims([confirmed], { jevApplied: true })).toEqual({});
  });

  it("5 afirmações iguais = 1 (máximo, sem empilhar)", () => {
    const one = claim([{ questionId: ATTACK_HOME, strength: "unverified" }]);
    const five = Array.from({ length: 5 }, () => one);
    expect(evidenceFromClaims(five, { jevApplied: false })).toEqual(
      evidenceFromClaims([one], { jevApplied: false }),
    );
  });
});

describe("combineAnswers", () => {
  it("JEV forte domina o usuário (0.9 vs 0.7 → 0.9); JEV fraco cede (0.2 vs 0.85 → 0.85)", () => {
    const jev = answers(0.9);
    expect(combineAnswers(jev, { [ATTACK_HOME]: 0.7 })?.[ATTACK_HOME].value).toBe(0.9);
    const weak = answers(0.2);
    expect(combineAnswers(weak, { [ATTACK_HOME]: 0.85 })?.[ATTACK_HOME].value).toBe(0.85);
    // As demais perguntas ficam com o JEV intacto.
    expect(combineAnswers(weak, { [ATTACK_HOME]: 0.85 })?.high_stakes_away.value).toBe(0.2);
  });

  it("sem JEV: aplica só a evidência (o resto neutro 0.5); sem nada → null", () => {
    const out = combineAnswers(null, { [ATTACK_HOME]: 0.7 });
    expect(out?.[ATTACK_HOME].value).toBe(0.7);
    expect(out?.defense_weakened_away.value).toBe(0.5);
    expect(combineAnswers(null, {})).toBeNull();
  });
});

describe("computeReadings", () => {
  it("sem evidência, com === sem bit a bit (com e sem JEV)", () => {
    for (const jev of [answers(0.8), null]) {
      const r = computeReadings(base(jev), {}, P);
      expect(r.with).toEqual(r.without);
      expect(r.lambdaWith.lambdaHome).toBe(r.lambdaWithout.lambdaHome);
      expect(r.lambdaWith.lambdaAway).toBe(r.lambdaWithout.lambdaAway);
    }
  });

  it("desfalque de ataque do mandante baixa o λ do mandante e a chance do 2×0", () => {
    const r = computeReadings(base(null), { [ATTACK_HOME]: 0.7 }, P);
    expect(r.lambdaWith.lambdaHome).toBeLessThan(r.lambdaWithout.lambdaHome);
    expect(r.lambdaWith.lambdaAway).toBe(r.lambdaWithout.lambdaAway);
    expect(r.with.palpitePct).toBeLessThan(r.without.palpitePct);
  });

  it("cada fator com evidência do usuário fica entre 1 e o fator com noul 1 (teto real)", () => {
    const factorOf = (id: JudgmentQuestionId) =>
      id.replace(/_(home|away)$/, "") as JudgmentFactor;
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let i = 0; i < 200; i++) {
      const jev = rand() < 0.3 ? null : answers(rand());
      const ev: Partial<Record<JudgmentQuestionId, number>> = {};
      for (const id of JUDGMENT_QUESTION_IDS) {
        if (rand() < 0.5) ev[id] = rand() < 0.5 ? USER_NOUL.unverified : USER_NOUL.confirmed;
      }
      const r = computeReadings(base(jev), ev, P);
      for (const side of ["home", "away"] as const) {
        const factors = r.lambdaWith.multipliers?.[side].factors ?? {};
        for (const [id, m] of Object.entries(factors) as [JudgmentQuestionId, number][]) {
          const cap = factorMultiplier(factorOf(id), 1);
          expect(m).toBeGreaterThanOrEqual(Math.min(1, cap) - 1e-12);
          expect(m).toBeLessThanOrEqual(Math.max(1, cap) + 1e-12);
        }
      }
    }
  });
});
