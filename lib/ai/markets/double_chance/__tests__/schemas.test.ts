import { describe, expect, it } from "vitest";

import { DoubleChanceOutputSchema } from "@/lib/ai/markets/double_chance/schemas";

type RawOutput = Record<string, unknown>;

function validBase(over: RawOutput = {}): RawOutput {
  return {
    recommendation: "home_or_draw",
    confidence_pct: 88,
    // As duplas se sobrepõem → somam ~200 (não 100).
    prob_home_or_draw: 88,
    prob_away_or_draw: 60,
    prob_home_or_away: 52,
    rationale: "O mandante dificilmente perde este jogo em casa.",
    key_factors: ["Mando de campo", "Forma recente superior"],
    minimum_odd: 1.15,
    ...over,
  };
}

describe("DoubleChanceOutputSchema — valid 3-way (overlapping) distribution", () => {
  it("accepts a valid home_or_draw recommendation with the full distribution", () => {
    const parsed = DoubleChanceOutputSchema.safeParse(validBase());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.prob_home_or_draw).toBe(88);
      expect(parsed.data.prob_away_or_draw).toBe(60);
      expect(parsed.data.prob_home_or_away).toBe(52);
    }
  });

  it("accepts an away_or_draw recommendation", () => {
    const parsed = DoubleChanceOutputSchema.safeParse(
      validBase({ recommendation: "away_or_draw", confidence_pct: 60 }),
    );
    expect(parsed.success).toBe(true);
  });

  it("accepts a home_or_away recommendation", () => {
    const parsed = DoubleChanceOutputSchema.safeParse(
      validBase({ recommendation: "home_or_away", confidence_pct: 52 }),
    );
    expect(parsed.success).toBe(true);
  });

  it("does NOT reject when probs sum to ~200 (expected for overlapping pairs)", () => {
    const parsed = DoubleChanceOutputSchema.safeParse(
      validBase({
        prob_home_or_draw: 95,
        prob_away_or_draw: 55,
        prob_home_or_away: 50, // soma 200
      }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe("DoubleChanceOutputSchema — minimum_odd presence rule", () => {
  it("accepts a valid 'pass' without minimum_odd", () => {
    const base = validBase({ recommendation: "pass", confidence_pct: 80 });
    delete base.minimum_odd;
    expect(DoubleChanceOutputSchema.safeParse(base).success).toBe(true);
  });

  it("rejects minimum_odd present when recommendation is 'pass'", () => {
    const parsed = DoubleChanceOutputSchema.safeParse(
      validBase({
        recommendation: "pass",
        confidence_pct: 80,
        minimum_odd: 1.2,
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects minimum_odd missing when recommendation is a double chance", () => {
    const noOdd = validBase({ recommendation: "home_or_away" });
    delete noOdd.minimum_odd;
    expect(DoubleChanceOutputSchema.safeParse(noOdd).success).toBe(false);
  });
});

describe("DoubleChanceOutputSchema — decision fields stay strict", () => {
  it("rejects confidence_pct out of 0..100", () => {
    expect(
      DoubleChanceOutputSchema.safeParse(validBase({ confidence_pct: 150 }))
        .success,
    ).toBe(false);
  });

  it("rejects a prob out of 0..100", () => {
    expect(
      DoubleChanceOutputSchema.safeParse(validBase({ prob_home_or_draw: 120 }))
        .success,
    ).toBe(false);
  });

  it("rejects an unknown recommendation (e.g. the 1X2 'home')", () => {
    expect(
      DoubleChanceOutputSchema.safeParse(validBase({ recommendation: "home" }))
        .success,
    ).toBe(false);
  });

  it("rejects a missing prob field", () => {
    const base = validBase();
    delete base.prob_away_or_draw;
    expect(DoubleChanceOutputSchema.safeParse(base).success).toBe(false);
  });
});

describe("DoubleChanceOutputSchema — tolerant prose (mirrors match_result #45)", () => {
  it("truncates a pathologically long rationale at the 2000-char ceiling", () => {
    const rationale = "b".repeat(5000);
    const parsed = DoubleChanceOutputSchema.safeParse(validBase({ rationale }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.rationale.length).toBeLessThanOrEqual(2000);
      expect(parsed.data.rationale.endsWith("…")).toBe(true);
    }
  });

  it("clamps more than 5 key_factors to the first 5", () => {
    const seven = Array.from({ length: 7 }, (_, i) => `fator ${i + 1}`);
    const parsed = DoubleChanceOutputSchema.safeParse(
      validBase({ key_factors: seven }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.key_factors).toHaveLength(5);
    }
  });

  it("still rejects empty prose (cheap lower floor stays)", () => {
    expect(
      DoubleChanceOutputSchema.safeParse(validBase({ rationale: "" })).success,
    ).toBe(false);
    expect(
      DoubleChanceOutputSchema.safeParse(validBase({ key_factors: [] })).success,
    ).toBe(false);
  });
});
