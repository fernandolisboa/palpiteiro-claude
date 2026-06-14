import { describe, expect, it } from "vitest";

import { BttsOutputSchema } from "@/lib/ai/markets/btts/schemas";

type RawOutput = Record<string, unknown>;

function validBase(over: RawOutput = {}): RawOutput {
  return {
    recommendation: "yes",
    confidence_pct: 62,
    rationale: "Dois ataques eficientes e defesas frágeis sugerem ambos marcando.",
    key_factors: ["Ambos marcam com frequência", "Defesas vazadas"],
    minimum_odd: 1.8,
    ...over,
  };
}

describe("BttsOutputSchema — tolerant prose (issue #45)", () => {
  it("accepts a long rationale instead of rejecting it (the #45 bug)", () => {
    const rationale = "a".repeat(703); // > old .max(600)
    const parsed = BttsOutputSchema.safeParse(validBase({ rationale }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // 703 < 2000 ceiling → kept in full, not truncated.
      expect(parsed.data.rationale).toHaveLength(703);
    }
  });

  it("truncates a pathologically long rationale at the 2000-char ceiling", () => {
    const rationale = "b".repeat(5000);
    const parsed = BttsOutputSchema.safeParse(validBase({ rationale }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.rationale.length).toBeLessThanOrEqual(2000);
      expect(parsed.data.rationale.endsWith("…")).toBe(true);
    }
  });

  it("truncates an over-long key_factor item (was item .max(160))", () => {
    const long = "c".repeat(500);
    const parsed = BttsOutputSchema.safeParse(
      validBase({ key_factors: [long, "ok"] }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.key_factors[0].length).toBeLessThanOrEqual(300);
      expect(parsed.data.key_factors[0].endsWith("…")).toBe(true);
    }
  });

  it("accepts a single key_factor (count below old .min(2))", () => {
    const parsed = BttsOutputSchema.safeParse(
      validBase({ key_factors: ["único fator decisivo"] }),
    );
    expect(parsed.success).toBe(true);
  });

  it("clamps more than 5 key_factors to the first 5 (was .max(5) rejection)", () => {
    const seven = Array.from({ length: 7 }, (_, i) => `fator ${i + 1}`);
    const parsed = BttsOutputSchema.safeParse(
      validBase({ key_factors: seven }),
    );
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.key_factors).toHaveLength(5);
      expect(parsed.data.key_factors[0]).toBe("fator 1");
    }
  });

  it("still rejects empty prose (cheap lower floor stays)", () => {
    expect(BttsOutputSchema.safeParse(validBase({ rationale: "" })).success).toBe(
      false,
    );
    expect(
      BttsOutputSchema.safeParse(validBase({ key_factors: [] })).success,
    ).toBe(false);
  });
});

describe("BttsOutputSchema — decision fields stay strict", () => {
  it("rejects confidence_pct out of 0..100", () => {
    expect(
      BttsOutputSchema.safeParse(validBase({ confidence_pct: 150 })).success,
    ).toBe(false);
  });

  it("rejects an unknown recommendation", () => {
    expect(
      BttsOutputSchema.safeParse(validBase({ recommendation: "maybe" })).success,
    ).toBe(false);
  });

  it("rejects minimum_odd present when recommendation is 'pass'", () => {
    const parsed = BttsOutputSchema.safeParse(
      validBase({ recommendation: "pass", confidence_pct: 50, minimum_odd: 2.0 }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects minimum_odd missing when recommendation is 'yes'", () => {
    const noOdd = validBase();
    delete noOdd.minimum_odd;
    expect(BttsOutputSchema.safeParse(noOdd).success).toBe(false);
  });

  it("accepts a valid 'pass' without minimum_odd", () => {
    const base = validBase({ recommendation: "pass", confidence_pct: 48 });
    delete base.minimum_odd;
    expect(BttsOutputSchema.safeParse(base).success).toBe(true);
  });
});
