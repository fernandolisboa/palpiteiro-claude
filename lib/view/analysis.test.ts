import { describe, expect, it } from "vitest";

import { toAnalysisView } from "./analysis";

const baseCreatedAt = new Date(2026, 4, 19, 14, 22);

describe("toAnalysisView", () => {
  it("maps over recommendation with positive edge and minOdd", () => {
    const view = toAnalysisView(
      {
        recommendation: "over",
        confidencePct: "58.00",
        rationale: "blah",
        keyFactors: ["a", "b"],
        minimumOdd: "1.750",
        edgePct: "7.30",
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
      },
      { costUsd: "0.014000" },
    );

    expect(view).toEqual({
      kind: "OVER",
      confidence: "58%",
      edge: "+7.3",
      minOdd: "1.75",
      rationale: "blah",
      factors: ["a", "b"],
      generatedAt: "19 mai · 14:22",
      promptVersion: "over_under_v1.1",
      model: "claude-sonnet-4.5",
      costUsd: "$0.014",
    });
  });

  it("pass recommendation has null edge/minOdd", () => {
    const view = toAnalysisView(
      {
        recommendation: "pass",
        confidencePct: "51.00",
        rationale: "no edge",
        keyFactors: ["a", "b"],
        minimumOdd: null,
        edgePct: null,
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
      },
      { costUsd: "0.011" },
    );

    expect(view.kind).toBe("PASS");
    expect(view.edge).toBeNull();
    expect(view.minOdd).toBeNull();
    expect(view.costUsd).toBe("$0.011");
  });

  it("handles missing aiCall (cost falls back to $0.000)", () => {
    const view = toAnalysisView(
      {
        recommendation: "under",
        confidencePct: "56",
        rationale: "x",
        keyFactors: ["a", "b"],
        minimumOdd: "1.80",
        edgePct: "6.70",
        modelVersion: "claude-sonnet-4-5-20250929",
        promptVersion: "over_under_v1.1",
        createdAt: baseCreatedAt,
      },
      null,
    );

    expect(view.kind).toBe("UNDER");
    expect(view.costUsd).toBe("$0.000");
  });
});
