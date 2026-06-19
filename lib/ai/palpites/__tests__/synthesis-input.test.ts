import { describe, expect, it } from "vitest";

import type { FanOutOutcome } from "@/lib/ai/best-bet";
import type { Prediction } from "@/lib/ai/predict";
import { summarizeAnalysesForSynthesis } from "@/lib/ai/palpites/synthesis-input";

// Prediction stub mínima: só os campos lidos pela projeção (Drizzle numeric → STRING).
function prediction(over: Partial<Prediction> = {}): Prediction {
  return {
    id: "pred-1",
    recommendation: "home",
    edgePct: "9.00",
    confidencePct: "60.00",
    oddAtRecommendation: "1.850",
    rationale: "Mandante superior.",
    ...over,
  } as unknown as Prediction;
}

function okOutcome(
  marketKey: string,
  pred: Prediction,
  selections: { key: string; modelProbPct: number; odd: number | null; label?: string }[],
): FanOutOutcome {
  return {
    ok: true,
    marketKey,
    result: { prediction: pred, marketKey, selections },
  };
}

describe("summarizeAnalysesForSynthesis", () => {
  it("projeta um outcome ok: lê os campos PERSISTIDOS Number()'d + marketLabel do descriptor", () => {
    const out = summarizeAnalysesForSynthesis([
      okOutcome("match_result", prediction(), [
        { key: "home", modelProbPct: 58, odd: 1.85 },
        { key: "draw", modelProbPct: 24, odd: 3.4 },
        { key: "away", modelProbPct: 18, odd: 4.2 },
      ]),
    ]);
    expect(out).toHaveLength(1);
    const a = out[0];
    expect(a.marketKey).toBe("match_result");
    expect(a.marketLabel).toBe("Resultado (1X2)");
    expect(a.recommendation).toBe("home");
    expect(a.recommendedLabel).toBe("Casa");
    expect(a.isPass).toBe(false);
    // numeric string → number no boundary.
    expect(a.edgePct).toBe(9);
    expect(a.confidencePct).toBe(60);
    expect(a.oddAtRecommendation).toBe(1.85);
    expect(a.modelProbPct).toBe(58); // da seleção recomendada
    expect(a.predictionId).toBe("pred-1");
    expect(a.selections).toHaveLength(3);
  });

  it("filtra outcomes de FALHA (só ok entram)", () => {
    const out = summarizeAnalysesForSynthesis([
      { ok: false, marketKey: "btts", message: "indisponível" },
      okOutcome("over_under", prediction(), [
        { key: "over", modelProbPct: 55, odd: 1.9 },
        { key: "under", modelProbPct: 45, odd: 2.0 },
      ]),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].marketKey).toBe("over_under");
  });

  it("trata pass: recommendation='pass', isPass=true, edge/odd/modelProb null, recommendedLabel null", () => {
    const out = summarizeAnalysesForSynthesis([
      okOutcome(
        "match_result",
        prediction({
          recommendation: "pass",
          edgePct: null,
          oddAtRecommendation: null,
        }),
        [
          { key: "home", modelProbPct: 40, odd: 2.5 },
          { key: "draw", modelProbPct: 30, odd: 3.0 },
          { key: "away", modelProbPct: 30, odd: 3.1 },
        ],
      ),
    ]);
    const a = out[0];
    expect(a.isPass).toBe(true);
    expect(a.recommendation).toBe("pass");
    expect(a.recommendedLabel).toBeNull();
    expect(a.edgePct).toBeNull();
    expect(a.oddAtRecommendation).toBeNull();
    expect(a.modelProbPct).toBeNull();
    // confidencePct ainda lido (numeric NOT NULL).
    expect(a.confidencePct).toBe(60);
  });

  it("ordena por edge desc (contexto); pass vai pro fim", () => {
    const out = summarizeAnalysesForSynthesis([
      okOutcome("over_under", prediction({ id: "p-lo", edgePct: "3.00" }), [
        { key: "over", modelProbPct: 51, odd: 1.95 },
        { key: "under", modelProbPct: 49, odd: 1.95 },
      ]),
      okOutcome("match_result", prediction({ id: "p-hi", edgePct: "12.00" }), [
        { key: "home", modelProbPct: 60, odd: 1.8 },
        { key: "draw", modelProbPct: 22, odd: 3.5 },
        { key: "away", modelProbPct: 18, odd: 4.0 },
      ]),
      okOutcome(
        "btts",
        prediction({ id: "p-pass", recommendation: "pass", edgePct: null }),
        [
          { key: "yes", modelProbPct: 50, odd: 1.9 },
          { key: "no", modelProbPct: 50, odd: 1.9 },
        ],
      ),
    ]);
    expect(out.map((a) => a.predictionId)).toEqual(["p-hi", "p-lo", "p-pass"]);
  });

  it("prefere o label threadado da seleção (dynamicSelections) ao selectionLabel do descriptor", () => {
    const out = summarizeAnalysesForSynthesis([
      okOutcome("anytime_scorer", prediction({ recommendation: "scorer_pedro" }), [
        { key: "scorer_pedro", modelProbPct: 35, odd: 2.5, label: "Pedro" },
      ]),
    ]);
    expect(out[0].recommendedLabel).toBe("Pedro");
    expect(out[0].selections[0].label).toBe("Pedro");
  });

  it("vazio → []", () => {
    expect(summarizeAnalysesForSynthesis([])).toEqual([]);
  });
});
