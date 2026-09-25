import { describe, expect, it } from "vitest";

import {
  isCodeJevMarket,
  runCodeJevEngine,
  selectionProbsFromMatrix,
} from "@/lib/ai/engine/code-jev";
import type { ModelScoreline } from "@/lib/ai/engine/model-scoreline";
import { JUDGMENT_QUESTION_IDS } from "@/lib/ai/judgments/questions";
import type {
  JudgmentAnswers,
  JudgmentQuestionId,
} from "@/lib/ai/judgments/types";
import {
  ANYTIME_SCORER,
  BTTS,
  CORRECT_SCORE,
  DOUBLE_CHANCE,
  MATCH_RESULT,
  OVER_UNDER,
} from "@/lib/odds/market-descriptor";
import { p1X2, pOverUnder, scorelineMatrix } from "@/lib/quant/scoreline-model";

function scoreline(lambdaHome: number, lambdaAway: number): ModelScoreline {
  return {
    source: "heuristic",
    degraded: false,
    lambdaHome,
    lambdaAway,
    matrix: scorelineMatrix(lambdaHome, lambdaAway),
  };
}

function answers(
  overrides: Partial<Record<JudgmentQuestionId, number>> = {}
): JudgmentAnswers {
  return Object.fromEntries(
    JUDGMENT_QUESTION_IDS.map((id) => [
      id,
      { value: overrides[id] ?? 0.1, confidence: null },
    ])
  ) as JudgmentAnswers;
}

const SL = scoreline(1.6, 1.0);
const round2 = (n: number) => Number(n.toFixed(2));

describe("isCodeJevMarket", () => {
  it("precifica os partition derivados de placar", () => {
    expect(isCodeJevMarket(MATCH_RESULT)).toBe(true);
    expect(isCodeJevMarket(OVER_UNDER)).toBe(true);
    expect(isCodeJevMarket(BTTS)).toBe(true);
    expect(isCodeJevMarket(DOUBLE_CHANCE)).toBe(true);
  });

  it("placar exato e scorer seguem no LLM", () => {
    expect(isCodeJevMarket(CORRECT_SCORE)).toBe(false);
    expect(isCodeJevMarket(ANYTIME_SCORER)).toBe(false);
  });
});

describe("selectionProbsFromMatrix", () => {
  it("1X2 lê p1X2 da matriz, em pp com 2 casas", () => {
    const p = p1X2(SL.matrix);
    expect(
      selectionProbsFromMatrix(
        "match_result",
        ["home", "draw", "away"],
        SL.matrix,
        null
      )
    ).toEqual({
      home: round2(p.home * 100),
      draw: round2(p.draw * 100),
      away: round2(p.away * 100),
    });
  });

  it("dupla chance soma ~200 (coberturas sobrepostas)", () => {
    const probs = selectionProbsFromMatrix(
      "double_chance",
      DOUBLE_CHANCE.selectionKeys,
      SL.matrix,
      null
    );
    const sum = Object.values(probs).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(200, 1);
  });

  it("over/under exige linha", () => {
    expect(() =>
      selectionProbsFromMatrix("over_under", ["over", "under"], SL.matrix, null)
    ).toThrow();
  });
});

describe("runCodeJevEngine", () => {
  const p = p1X2(SL.matrix);
  const home = round2(p.home * 100);
  const draw = round2(p.draw * 100);
  const away = round2(p.away * 100);

  it("escolhe a seleção de maior edge contra a implícita", () => {
    // Implícita dá valor no empate (+8) e um pouco no visitante (+6).
    const decision = runCodeJevEngine({
      dbMarketKey: "match_result",
      selectionKeys: MATCH_RESULT.selectionKeys,
      scoreline: SL,
      judgments: null,
      candidates: [
        {
          line: null,
          impliedByKey: { home: home + 14, draw: draw - 8, away: away - 6 },
        },
      ],
      minEdgePp: 5,
    });
    expect(decision.recommendation).toBe("draw");
    expect(decision.best?.key).toBe("draw");
    expect(decision.best?.edgePct).toBeCloseTo(8, 2);
    expect(decision.modelProbByKey).toEqual({ home, draw, away });
  });

  it("pass quando o melhor edge fica abaixo do piso", () => {
    const decision = runCodeJevEngine({
      dbMarketKey: "match_result",
      selectionKeys: MATCH_RESULT.selectionKeys,
      scoreline: SL,
      judgments: null,
      candidates: [
        {
          line: null,
          impliedByKey: { home: home - 4, draw: draw + 2, away: away + 2 },
        },
      ],
      minEdgePp: 5,
    });
    expect(decision.recommendation).toBe("pass");
    // A melhor candidata segue exposta (o narrador explica o "por que não").
    expect(decision.best?.key).toBe("home");
    expect(decision.best?.edgePct).toBeCloseTo(4, 2);
  });

  it("pass quando o edge não é mensurável", () => {
    const decision = runCodeJevEngine({
      dbMarketKey: "btts",
      selectionKeys: BTTS.selectionKeys,
      scoreline: SL,
      judgments: null,
      candidates: [{ line: null, impliedByKey: {} }],
      minEdgePp: 5,
    });
    expect(decision.recommendation).toBe("pass");
    expect(decision.best).toBeNull();
  });

  it("over/under multi-linha escolhe a linha + lado de maior edge", () => {
    const over = (line: number) => round2(pOverUnder(SL.matrix, line) * 100);
    const decision = runCodeJevEngine({
      dbMarketKey: "over_under",
      selectionKeys: ["over", "under"],
      scoreline: SL,
      judgments: null,
      candidates: [
        // 1.5: over +3
        {
          line: 1.5,
          impliedByKey: { over: over(1.5) - 3, under: 100 - over(1.5) + 3 },
        },
        // 2.5: under +9 (o maior)
        {
          line: 2.5,
          impliedByKey: { over: over(2.5) + 9, under: 100 - over(2.5) - 9 },
        },
        // 3.5: over +6
        {
          line: 3.5,
          impliedByKey: { over: over(3.5) - 6, under: 100 - over(3.5) + 6 },
        },
      ],
      minEdgePp: 5,
    });
    expect(decision.recommendation).toBe("under");
    expect(decision.line).toBe(2.5);
    expect(decision.modelProbByKey.over).toBe(over(2.5));
    expect(decision.evaluations).toHaveLength(6);
  });

  it("judgments=null → estatístico puro (λ intacto, applied=false)", () => {
    const decision = runCodeJevEngine({
      dbMarketKey: "match_result",
      selectionKeys: MATCH_RESULT.selectionKeys,
      scoreline: SL,
      judgments: null,
      candidates: [{ line: null, impliedByKey: { home, draw, away } }],
      minEdgePp: 5,
    });
    expect(decision.judgments.applied).toBe(false);
    expect(decision.judgments.multipliers).toBeNull();
    expect(decision.judgments.lambdaHome).toBe(1.6);
    expect(decision.judgments.lambdaAway).toBe(1.0);
    expect(decision.modelProbByKey).toEqual({ home, draw, away });
  });

  it("julgamentos 'sim' ajustam o λ e a probabilidade", () => {
    const decision = runCodeJevEngine({
      dbMarketKey: "match_result",
      selectionKeys: MATCH_RESULT.selectionKeys,
      scoreline: SL,
      // Ataque do mandante desfalcado (forte) → λ_casa cai.
      judgments: answers({ attack_weakened_home: 0.95 }),
      candidates: [{ line: null, impliedByKey: { home, draw, away } }],
      minEdgePp: 5,
    });
    expect(decision.judgments.applied).toBe(true);
    expect(decision.judgments.lambdaHome).toBeLessThan(1.6);
    expect(decision.judgments.lambdaAway).toBe(1.0);
    expect(decision.modelProbByKey.home).toBeLessThan(home);
    expect(decision.lambdaBase).toEqual({ home: 1.6, away: 1.0 });
  });

  it("todos 'não' (≤ 0.5) → mesmas probabilidades do estatístico", () => {
    const decision = runCodeJevEngine({
      dbMarketKey: "match_result",
      selectionKeys: MATCH_RESULT.selectionKeys,
      scoreline: SL,
      judgments: answers(),
      candidates: [{ line: null, impliedByKey: { home, draw, away } }],
      minEdgePp: 5,
    });
    expect(decision.judgments.applied).toBe(true);
    expect(decision.modelProbByKey).toEqual({ home, draw, away });
  });

  it("é determinístico", () => {
    const args = {
      dbMarketKey: "btts",
      selectionKeys: BTTS.selectionKeys,
      scoreline: SL,
      judgments: answers({ defense_weakened_away: 0.7 }),
      candidates: [{ line: null, impliedByKey: { yes: 50, no: 50 } }],
      minEdgePp: 5,
    };
    expect(runCodeJevEngine(args)).toEqual(runCodeJevEngine(args));
  });
});
