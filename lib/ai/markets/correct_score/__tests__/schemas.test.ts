import { describe, expect, it } from "vitest";

import {
  CORRECT_SCORE_KEYS,
  CorrectScoreOutputSchema,
} from "@/lib/ai/markets/correct_score/schemas";

type RawOutput = Record<string, unknown>;

// Distribuição plausível sobre as 16 células (somam ~100, mas a tolerância não
// exige soma exata). cs_1_1 é o pico.
function cellProbs(over: Record<string, number> = {}): Record<string, number> {
  const base: Record<string, number> = {};
  for (const k of CORRECT_SCORE_KEYS) base[k] = 6;
  base.cs_1_1 = 10;
  return { ...base, ...over };
}

function validBase(over: RawOutput = {}): RawOutput {
  return {
    recommendation: "cs_2_1",
    confidence_pct: 12,
    cell_probs: cellProbs(),
    rationale: "O placar mais provável deste jogo é 2-1 para o mandante.",
    key_factors: ["Mando de campo", "Ataque eficiente em casa"],
    minimum_odd: 9.5,
    ...over,
  };
}

describe("CorrectScoreOutputSchema — valid 16-cell distribution", () => {
  it("accepts a valid cell recommendation with the full distribution", () => {
    const parsed = CorrectScoreOutputSchema.safeParse(validBase());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.recommendation).toBe("cs_2_1");
      expect(Object.keys(parsed.data.cell_probs)).toHaveLength(16);
      expect(parsed.data.cell_probs.cs_1_1).toBe(10);
    }
  });

  it("accepts every one of the 16 cells as a recommendation", () => {
    for (const key of CORRECT_SCORE_KEYS) {
      const parsed = CorrectScoreOutputSchema.safeParse(
        validBase({ recommendation: key }),
      );
      expect(parsed.success, `cell ${key}`).toBe(true);
    }
  });

  it("does NOT reject when cell probs do not sum to 100 (soft check, clamp only)", () => {
    // Todas as 16 a 50 → soma 800. Aceito (normalização defensiva é downstream).
    const parsed = CorrectScoreOutputSchema.safeParse(
      validBase({
        cell_probs: Object.fromEntries(
          CORRECT_SCORE_KEYS.map((k) => [k, 50]),
        ),
      }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe("CorrectScoreOutputSchema — cell_probs completeness", () => {
  it("rejects cell_probs missing a cell (must contain all 16)", () => {
    const probs = cellProbs();
    delete probs.cs_3_3;
    expect(
      CorrectScoreOutputSchema.safeParse(validBase({ cell_probs: probs }))
        .success,
    ).toBe(false);
  });

  it("rejects a cell prob out of 0..100", () => {
    expect(
      CorrectScoreOutputSchema.safeParse(
        validBase({ cell_probs: cellProbs({ cs_0_0: 120 }) }),
      ).success,
    ).toBe(false);
  });
});

describe("CorrectScoreOutputSchema — minimum_odd presence rule", () => {
  it("accepts a valid 'pass' without minimum_odd", () => {
    const base = validBase({ recommendation: "pass", confidence_pct: 11 });
    delete base.minimum_odd;
    expect(CorrectScoreOutputSchema.safeParse(base).success).toBe(true);
  });

  it("rejects minimum_odd present when recommendation is 'pass'", () => {
    const parsed = CorrectScoreOutputSchema.safeParse(
      validBase({ recommendation: "pass", confidence_pct: 11, minimum_odd: 9 }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects minimum_odd missing when recommendation is a cell", () => {
    const noOdd = validBase();
    delete noOdd.minimum_odd;
    expect(CorrectScoreOutputSchema.safeParse(noOdd).success).toBe(false);
  });
});

describe("CorrectScoreOutputSchema — decision fields stay strict", () => {
  it("rejects confidence_pct out of 0..100", () => {
    expect(
      CorrectScoreOutputSchema.safeParse(validBase({ confidence_pct: 150 }))
        .success,
    ).toBe(false);
  });

  it("rejects an unknown recommendation (off-grid / not a cell)", () => {
    expect(
      CorrectScoreOutputSchema.safeParse(validBase({ recommendation: "cs_4_0" }))
        .success,
    ).toBe(false);
    expect(
      CorrectScoreOutputSchema.safeParse(validBase({ recommendation: "home" }))
        .success,
    ).toBe(false);
  });
});

describe("CorrectScoreOutputSchema — tolerant prose (mirrors match_result #45)", () => {
  it("truncates a pathologically long rationale at the 2000-char ceiling", () => {
    const rationale = "b".repeat(5000);
    const parsed = CorrectScoreOutputSchema.safeParse(validBase({ rationale }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.rationale.length).toBeLessThanOrEqual(2000);
      expect(parsed.data.rationale.endsWith("…")).toBe(true);
    }
  });

  it("clamps more than 5 key_factors to the first 5", () => {
    const seven = Array.from({ length: 7 }, (_, i) => `fator ${i + 1}`);
    const parsed = CorrectScoreOutputSchema.safeParse(
      validBase({ key_factors: seven }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.key_factors).toHaveLength(5);
    }
  });

  it("still rejects empty prose (cheap lower floor stays)", () => {
    expect(
      CorrectScoreOutputSchema.safeParse(validBase({ rationale: "" })).success,
    ).toBe(false);
    expect(
      CorrectScoreOutputSchema.safeParse(validBase({ key_factors: [] })).success,
    ).toBe(false);
  });
});
