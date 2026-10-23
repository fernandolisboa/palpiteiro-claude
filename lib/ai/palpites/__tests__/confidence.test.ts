import { describe, expect, it } from "vitest";

import { scorelineMatrix } from "@/lib/quant/scoreline-model";

import {
  PALPITE_CONFIDENCE_BANDS,
  confidenceLevel,
  liveConfidenceProbs,
  matchResultProbsFromAnalyses,
  palpiteConfidence,
  pregameConfidenceProbs,
  scoreOutcome,
} from "../confidence";

// Confiança do palpite pelo motor (#649, ADR 0069). Puro.

const analysis = (
  engine: "llm" | "code_jev" | null,
  probs: Record<string, number> = { home: 58, draw: 24, away: 18 },
  marketKey = "match_result",
) => ({
  marketKey,
  engine,
  selections: Object.entries(probs).map(([key, modelProbPct]) => ({ key, modelProbPct })),
});

describe("faixas", () => {
  it("limites inclusivos: ≥40 média, ≥55 alta", () => {
    expect(PALPITE_CONFIDENCE_BANDS).toEqual({ media: 40, alta: 55 });
    expect(confidenceLevel(39.99)).toBe("baixa");
    expect(confidenceLevel(40)).toBe("media");
    expect(confidenceLevel(54.99)).toBe("media");
    expect(confidenceLevel(55)).toBe("alta");
    expect(confidenceLevel(0)).toBe("baixa");
    expect(confidenceLevel(100)).toBe("alta");
  });

  it("resultado do placar provável", () => {
    expect(scoreOutcome({ home: 2, away: 1 })).toBe("home");
    expect(scoreOutcome({ home: 1, away: 1 })).toBe("draw");
    expect(scoreOutcome({ home: 0, away: 0 })).toBe("draw");
    expect(scoreOutcome({ home: 1, away: 2 })).toBe("away");
  });
});

describe("palpiteConfidence", () => {
  const values = { home: 45, draw: 25, away: 30 };

  it("lê a P do resultado do placar provável e guarda a fonte", () => {
    expect(
      palpiteConfidence({ home: 1, away: 2 }, { values, source: "snapshot" }),
    ).toEqual({ level: "baixa", probPct: 30, source: "snapshot" });
    expect(
      palpiteConfidence({ home: 2, away: 0 }, { values, source: "analysis" }),
    ).toEqual({ level: "media", probPct: 45, source: "analysis" });
  });

  it("empate sai baixa (quase nunca passa de um terço)", () => {
    expect(
      palpiteConfidence({ home: 1, away: 1 }, { values, source: "snapshot" })?.level,
    ).toBe("baixa");
  });

  it("sem probabilidade → null (sem chip)", () => {
    expect(palpiteConfidence({ home: 1, away: 0 }, null)).toBeNull();
  });
});

describe("fontes pré-jogo", () => {
  it("base do modelo primeiro, normalizada a 100", () => {
    const probs = pregameConfidenceProbs(
      { probabilities: { match_result: { home: 50, draw: 25, away: 25.5 } } },
      [analysis("code_jev", { home: 10, draw: 10, away: 80 })],
    );
    expect(probs?.source).toBe("snapshot");
    const sum = probs!.values.home + probs!.values.draw + probs!.values.away;
    expect(sum).toBeCloseTo(100, 10);
    expect(probs!.values.home).toBeCloseTo((50 / 100.5) * 100, 10);
  });

  it("sem base: 1X2 do code_jev", () => {
    const probs = pregameConfidenceProbs(null, [analysis("code_jev")]);
    expect(probs?.source).toBe("analysis");
    expect(probs!.values.home).toBeCloseTo(58, 10);
    expect(probs!.values.draw).toBeCloseTo(24, 10);
    expect(probs!.values.away).toBeCloseTo(18, 10);
  });

  it("1X2 do motor LLM ou de motor desconhecido não serve", () => {
    expect(pregameConfidenceProbs(null, [analysis("llm")])).toBeNull();
    expect(pregameConfidenceProbs(null, [analysis(null)])).toBeNull();
  });

  it("análise de outro mercado ou com seleção faltando → null", () => {
    expect(
      pregameConfidenceProbs(null, [analysis("code_jev", undefined, "btts")]),
    ).toBeNull();
    expect(
      matchResultProbsFromAnalyses([analysis("code_jev", { home: 60, away: 20 })]),
    ).toBeNull();
    expect(
      matchResultProbsFromAnalyses([
        analysis("code_jev", { home: 0, draw: 0, away: 0 }),
      ]),
    ).toBeNull();
  });

  it("base com soma zero cai na análise", () => {
    expect(
      pregameConfidenceProbs(
        { probabilities: { match_result: { home: 0, draw: 0, away: 0 } } },
        [analysis("code_jev")],
      )?.source,
    ).toBe("analysis");
  });
});

describe("fonte ao vivo", () => {
  it("matriz em 0..1 vira pp com Σ = 100", () => {
    const probs = liveConfidenceProbs(scorelineMatrix(2.1, 0.8));
    expect(probs?.source).toBe("live_matrix");
    const { home, draw, away } = probs!.values;
    expect(home + draw + away).toBeCloseTo(100, 10);
    expect(home).toBeGreaterThan(55);
    expect(away).toBeLessThan(home);
  });
});
