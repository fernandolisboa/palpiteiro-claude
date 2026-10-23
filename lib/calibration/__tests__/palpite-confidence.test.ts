import { describe, expect, it } from "vitest";

import {
  deriveConfidenceCalibration,
  toConfidenceRow,
  type PalpiteConfidenceRow,
} from "../palpite-confidence";

// Calibração da confiança do palpite (#649). Puro.

describe("toConfidenceRow", () => {
  const raw = (headline: unknown, resultData: unknown = { homeScore: 1, awayScore: 2 }) => ({
    matchId: "m",
    headline,
    probableScore: { home: 0, away: 1 },
    resultData,
  });

  it("motor: P e acerto do resultado", () => {
    expect(
      toConfidenceRow(
        raw({ confidence: "baixa", confidenceProbPct: 30, confidenceSource: "snapshot" }),
      ),
    ).toEqual({ matchId: "m", era: "motor", level: "baixa", probPct: 30, hit: true });
  });

  it("llm: sem P mesmo que o jsonb traga algo estranho", () => {
    expect(toConfidenceRow(raw({ confidence: "alta" }))).toEqual({
      matchId: "m",
      era: "llm",
      level: "alta",
      probPct: null,
      hit: true,
    });
  });

  it("jsonb fora do formato ou placar nulo (override manual) → fora", () => {
    expect(toConfidenceRow(raw({ confidence: "altissima" }))).toBeNull();
    expect(
      toConfidenceRow(
        raw({ confidence: "media", confidenceProbPct: 140, confidenceSource: "snapshot" }),
      ),
    ).toBeNull();
    expect(
      toConfidenceRow(raw({ confidence: "media" }, { homeScore: null, awayScore: null })),
    ).toBeNull();
    expect(toConfidenceRow({ ...raw({ confidence: "media" }), probableScore: null })).toBeNull();
  });
});

describe("deriveConfidenceCalibration", () => {
  const row = (over: Partial<PalpiteConfidenceRow>): PalpiteConfidenceRow => ({
    matchId: "m1",
    era: "motor",
    level: "media",
    probPct: 45,
    hit: true,
    ...over,
  });

  it("por era e faixa: n, jogos distintos, previsto e acerto", () => {
    const [motor, llm] = deriveConfidenceCalibration([
      row({ matchId: "m1", probPct: 44, hit: true }),
      row({ matchId: "m1", probPct: 46, hit: false }),
      row({ matchId: "m2", level: "alta", probPct: 60, hit: true }),
      row({ matchId: "m3", level: null, probPct: null, hit: false }),
      row({ era: "llm", level: "alta", probPct: null, hit: false }),
    ]);
    expect(motor.era).toBe("motor");
    expect(motor.bands).toEqual([
      { level: "baixa", n: 0, matches: 0, meanForecast: null, hitRate: null },
      { level: "media", n: 2, matches: 1, meanForecast: 0.45, hitRate: 0.5 },
      { level: "alta", n: 1, matches: 1, meanForecast: 0.6, hitRate: 1 },
    ]);
    expect(motor.withoutConfidence).toBe(1);
    expect(llm.bands[2]).toEqual({
      level: "alta",
      n: 1,
      matches: 1,
      meanForecast: null,
      hitRate: 0,
    });
  });
});
