import { describe, expect, it } from "vitest";

import { MatchResultOutputSchema } from "@/lib/ai/markets/match_result/schemas";

type RawOutput = Record<string, unknown>;

function validBase(over: RawOutput = {}): RawOutput {
  return {
    recommendation: "home",
    confidence_pct: 55,
    prob_home: 55,
    prob_draw: 27,
    prob_away: 18,
    rationale: "Mandante forte em casa contra um visitante irregular.",
    key_factors: ["Mando de campo", "Forma recente superior"],
    minimum_odd: 1.7,
    ...over,
  };
}

describe("MatchResultOutputSchema — valid 3-way distribution", () => {
  it("accepts a valid home recommendation with the full distribution", () => {
    const parsed = MatchResultOutputSchema.safeParse(validBase());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.prob_home).toBe(55);
      expect(parsed.data.prob_draw).toBe(27);
      expect(parsed.data.prob_away).toBe(18);
    }
  });

  it("accepts a draw recommendation", () => {
    const parsed = MatchResultOutputSchema.safeParse(
      validBase({ recommendation: "draw", confidence_pct: 33 }),
    );
    expect(parsed.success).toBe(true);
  });

  it("accepts an away recommendation", () => {
    const parsed = MatchResultOutputSchema.safeParse(
      validBase({ recommendation: "away", confidence_pct: 40 }),
    );
    expect(parsed.success).toBe(true);
  });

  it("does NOT reject when probs do not sum to exactly 100 (soft check, tolerance)", () => {
    const parsed = MatchResultOutputSchema.safeParse(
      validBase({ prob_home: 50, prob_draw: 30, prob_away: 30 }), // soma 110
    );
    expect(parsed.success).toBe(true);
  });
});

describe("MatchResultOutputSchema — minimum_odd presence rule", () => {
  it("accepts a valid 'pass' without minimum_odd", () => {
    const base = validBase({ recommendation: "pass", confidence_pct: 48 });
    delete base.minimum_odd;
    expect(MatchResultOutputSchema.safeParse(base).success).toBe(true);
  });

  it("rejects minimum_odd present when recommendation is 'pass'", () => {
    const parsed = MatchResultOutputSchema.safeParse(
      validBase({
        recommendation: "pass",
        confidence_pct: 50,
        minimum_odd: 2.0,
      }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects minimum_odd missing when recommendation is 'home'", () => {
    const noOdd = validBase();
    delete noOdd.minimum_odd;
    expect(MatchResultOutputSchema.safeParse(noOdd).success).toBe(false);
  });

  it("rejects minimum_odd missing when recommendation is 'draw'", () => {
    const noOdd = validBase({ recommendation: "draw" });
    delete noOdd.minimum_odd;
    expect(MatchResultOutputSchema.safeParse(noOdd).success).toBe(false);
  });
});

describe("MatchResultOutputSchema — decision fields stay strict", () => {
  it("rejects confidence_pct out of 0..100", () => {
    expect(
      MatchResultOutputSchema.safeParse(validBase({ confidence_pct: 150 }))
        .success,
    ).toBe(false);
  });

  it("rejects a prob out of 0..100", () => {
    expect(
      MatchResultOutputSchema.safeParse(validBase({ prob_home: 120 })).success,
    ).toBe(false);
  });

  it("rejects an unknown recommendation", () => {
    expect(
      MatchResultOutputSchema.safeParse(validBase({ recommendation: "over" }))
        .success,
    ).toBe(false);
  });

  it("rejects a missing prob field", () => {
    const base = validBase();
    delete base.prob_draw;
    expect(MatchResultOutputSchema.safeParse(base).success).toBe(false);
  });
});

describe("MatchResultOutputSchema — tolerant prose (mirrors over_under #45)", () => {
  it("truncates a pathologically long rationale at the 2000-char ceiling", () => {
    const rationale = "b".repeat(5000);
    const parsed = MatchResultOutputSchema.safeParse(validBase({ rationale }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.rationale.length).toBeLessThanOrEqual(2000);
      expect(parsed.data.rationale.endsWith("…")).toBe(true);
    }
  });

  it("clamps more than 5 key_factors to the first 5", () => {
    const seven = Array.from({ length: 7 }, (_, i) => `fator ${i + 1}`);
    const parsed = MatchResultOutputSchema.safeParse(
      validBase({ key_factors: seven }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.key_factors).toHaveLength(5);
    }
  });

  it("still rejects empty prose (cheap lower floor stays)", () => {
    expect(
      MatchResultOutputSchema.safeParse(validBase({ rationale: "" })).success,
    ).toBe(false);
    expect(
      MatchResultOutputSchema.safeParse(validBase({ key_factors: [] })).success,
    ).toBe(false);
  });
});
