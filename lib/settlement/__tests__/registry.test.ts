import { describe, expect, it } from "vitest";

import { getSettlementRule } from "@/lib/settlement/registry";
import { overUnderRule } from "@/lib/settlement/rules/over_under";
import { SettlementError, type ResultData } from "@/lib/settlement/schemas";

function rd(totalGoals: number): ResultData {
  return { homeScore: null, awayScore: null, totalGoals };
}

describe("getSettlementRule", () => {
  it("resolves the over_under rule", () => {
    expect(getSettlementRule("over_under")).toBe(overUnderRule);
  });

  it("throws on an unknown rule key (mirrors getCartridge)", () => {
    expect(() => getSettlementRule("totally_unknown")).toThrow(
      /unknown settlement rule key/,
    );
  });
});

describe("overUnderRule (ADR 0016 scenario table)", () => {
  it("over wins above the line, loses below; line 2.5 never pushes", () => {
    expect(overUnderRule("over", { line: 2.5 }, rd(3))).toBe("won");
    expect(overUnderRule("over", { line: 2.5 }, rd(2))).toBe("lost");
  });

  it("under wins below the line, loses above", () => {
    expect(overUnderRule("under", { line: 2.5 }, rd(2))).toBe("won");
    expect(overUnderRule("under", { line: 2.5 }, rd(3))).toBe("lost");
  });

  it("whole line + matching total → push", () => {
    expect(overUnderRule("over", { line: 2.0 }, rd(2))).toBe("push");
    expect(overUnderRule("under", { line: 3.0 }, rd(3))).toBe("push");
  });

  it("line 2.5 (number) parses and never pushes for integer totals", () => {
    for (let total = 0; total <= 6; total++) {
      expect(overUnderRule("over", { line: 2.5 }, rd(total))).not.toBe("push");
    }
  });

  it("throws SettlementError on null params", () => {
    expect(() => overUnderRule("over", null, rd(3))).toThrow(SettlementError);
  });

  it("throws SettlementError on a non-numeric line", () => {
    expect(() => overUnderRule("over", { line: "x" }, rd(3))).toThrow(
      SettlementError,
    );
  });

  it("throws SettlementError on an extra key (strict)", () => {
    expect(() =>
      overUnderRule("over", { line: 2.5, extra: 1 }, rd(3)),
    ).toThrow(SettlementError);
  });
});
