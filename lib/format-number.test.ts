import { describe, expect, it } from "vitest";

import {
  EV_ZERO_LABEL,
  formatDecimal,
  formatEdge,
  formatEvPct,
  formatLine,
  formatOdd,
  formatPct,
  formatUnits,
  formatUnitsCompact,
  roundOdd,
} from "./format-number";

describe("format-number (pt-BR, #574)", () => {
  it("formatDecimal troca o ponto pela vírgula e mantém o sinal ASCII", () => {
    expect(formatDecimal(1.5, 2)).toBe("1,50");
    expect(formatDecimal(-2.14, 1)).toBe("-2,1");
    expect(formatDecimal(-2.14, 1).startsWith("-")).toBe(true);
    expect(formatDecimal(3, 0)).toBe("3");
  });

  it("formatOdd usa vírgula com 2 casas e '—' em null/NaN", () => {
    expect(formatOdd(2.666)).toBe("2,67");
    expect(formatOdd("1.92")).toBe("1,92");
    expect(formatOdd(null)).toBe("—");
    expect(formatOdd(Number.NaN)).toBe("—");
  });

  it("formatPct usa vírgula só quando há casa decimal", () => {
    expect(formatPct(42.5)).toBe("42,5%");
    expect(formatPct(58)).toBe("58%");
    expect(formatPct(58, { decimals: 1 })).toBe("58,0%");
    expect(formatPct(undefined)).toBe("—");
  });

  it("formatEdge tem sinal explícito e vírgula", () => {
    expect(formatEdge(7.34)).toBe("+7,3");
    expect(formatEdge(-2.1)).toBe("-2,1");
    expect(formatEdge(null)).toBeNull();
    expect(formatEdge(Number.NaN)).toBeNull();
  });

  it("formatEvPct normaliza o zero de exibição pra '0,0%'", () => {
    expect(formatEvPct(0.114)).toBe("+11,4%");
    expect(formatEvPct(-0.04)).toBe("-4,0%");
    expect(formatEvPct(0.0004)).toBe("0,0%");
    expect(formatEvPct(-0.0004)).toBe("0,0%");
    expect(EV_ZERO_LABEL).toBe("0,0%");
    expect(formatEvPct(null)).toBe("—");
  });

  it("formatLine: 1,5 / 2,5 / 3 e '—' em null/NaN", () => {
    expect(formatLine(1.5)).toBe("1,5");
    expect(formatLine("2.5")).toBe("2,5");
    expect(formatLine(3)).toBe("3");
    expect(formatLine(null)).toBe("—");
    expect(formatLine("x")).toBe("—");
  });

  it("formatUnits com e sem sinal", () => {
    expect(formatUnits(1.5, { signed: true })).toBe("+1,50 u");
    expect(formatUnits(-1, { signed: true })).toBe("-1,00 u");
    expect(formatUnits(0, { signed: true })).toBe("+0,00 u");
    expect(formatUnits(1)).toBe("1,00 u");
    expect(formatUnits(Number.NaN)).toBe("—");
  });

  it("formatUnitsCompact corta zeros à direita", () => {
    expect(formatUnitsCompact(0.5)).toBe("0,5u");
    expect(formatUnitsCompact(1)).toBe("1u");
    expect(formatUnitsCompact(1.25)).toBe("1,25u");
    expect(formatUnitsCompact(10)).toBe("10u");
    expect(formatUnitsCompact(1.25, 1)).toBe("1,3u");
    expect(formatUnitsCompact(Number.NaN)).toBe("—");
  });

  it("formatUnitsCompact sem casas decimais não corta zeros do inteiro", () => {
    expect(formatUnitsCompact(10, 0)).toBe("10u");
    expect(formatUnitsCompact(100, 0)).toBe("100u");
  });

  it("roundOdd arredonda como o formatOdd exibe", () => {
    expect(roundOdd(1.855)).toBe(Number((1.855).toFixed(2)));
    expect(roundOdd(1.855)).toBe(roundOdd(1.85));
    expect(roundOdd(1.923)).toBe(1.92);
  });
});
