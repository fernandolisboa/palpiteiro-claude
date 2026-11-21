import { describe, expect, it } from "vitest";

import { asStoredOdd, storedOddText } from "@/lib/odds/stored-odd";

describe("odd como o banco grava (numeric(6,3))", () => {
  it("o número em memória é o texto do insert", () => {
    for (const odd of [2.0025, 1.0005, 3.3335, 2.9005, 1.85049, 2.35]) {
      expect(asStoredOdd(odd)).toBe(Number(storedOddText(odd)));
    }
  });

  it("2.0025 → 2.002 (toFixed), não 2.003 (Math.round)", () => {
    expect(storedOddText(2.0025)).toBe("2.002");
    expect(asStoredOdd(2.0025)).toBe(2.002);
  });
});
