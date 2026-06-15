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

  // #175: linhas extras 1.5 e 3.5 liquidam pela MESMA regra parametrizada (lê a
  // linha de marketParams). Limites: o gol decisivo é o 2º (1.5) e o 4º (3.5);
  // meia-linha → nenhum total inteiro empata (push inalcançável).
  it("line 1.5: 0-1 gol → under ganha/over perde; 2+ → over ganha/under perde", () => {
    // Abaixo da linha (0 ou 1 gol): under ganha, over perde.
    expect(overUnderRule("under", { line: 1.5 }, rd(0))).toBe("won");
    expect(overUnderRule("over", { line: 1.5 }, rd(0))).toBe("lost");
    expect(overUnderRule("under", { line: 1.5 }, rd(1))).toBe("won");
    expect(overUnderRule("over", { line: 1.5 }, rd(1))).toBe("lost");
    // No/Acima da linha (2+ gols): over ganha, under perde.
    expect(overUnderRule("over", { line: 1.5 }, rd(2))).toBe("won");
    expect(overUnderRule("under", { line: 1.5 }, rd(2))).toBe("lost");
    expect(overUnderRule("over", { line: 1.5 }, rd(5))).toBe("won");
    expect(overUnderRule("under", { line: 1.5 }, rd(5))).toBe("lost");
  });

  it("line 1.5 never pushes for integer totals", () => {
    for (let total = 0; total <= 6; total++) {
      expect(overUnderRule("over", { line: 1.5 }, rd(total))).not.toBe("push");
      expect(overUnderRule("under", { line: 1.5 }, rd(total))).not.toBe("push");
    }
  });

  it("line 3.5: 0-3 gols → under ganha/over perde; 4+ → over ganha/under perde", () => {
    // Abaixo da linha (0..3 gols): under ganha, over perde.
    for (const total of [0, 1, 2, 3]) {
      expect(overUnderRule("under", { line: 3.5 }, rd(total))).toBe("won");
      expect(overUnderRule("over", { line: 3.5 }, rd(total))).toBe("lost");
    }
    // Acima da linha (4+ gols): over ganha, under perde.
    for (const total of [4, 5, 7]) {
      expect(overUnderRule("over", { line: 3.5 }, rd(total))).toBe("won");
      expect(overUnderRule("under", { line: 3.5 }, rd(total))).toBe("lost");
    }
  });

  it("line 3.5 never pushes for integer totals", () => {
    for (let total = 0; total <= 6; total++) {
      expect(overUnderRule("over", { line: 3.5 }, rd(total))).not.toBe("push");
      expect(overUnderRule("under", { line: 3.5 }, rd(total))).not.toBe("push");
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
