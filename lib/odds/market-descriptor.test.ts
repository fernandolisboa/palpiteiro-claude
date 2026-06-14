import { describe, expect, it } from "vitest";

import { DOUBLE_CHANCE, getDescriptor } from "@/lib/odds/market-descriptor";
import type { OddsApiOutcome } from "@/lib/providers/odds-api-schemas";

// ctx do payload REAL validado (1xBet eu, soccer_fifa_world_cup, 2026-06-14).
const ctx = { homeTeam: "Germany", awayTeam: "Curaçao" };
const out = (name: string): OddsApiOutcome => ({ name, price: 1.5 });
const resolve = (name: string) =>
  DOUBLE_CHANCE.resolveSelectionKey(out(name), ctx);

describe("DOUBLE_CHANCE.resolveSelectionKey", () => {
  it("mapeia os 3 nomes compostos REAIS do provider", () => {
    expect(resolve("Germany or Draw")).toBe("home_or_draw"); // 1X
    expect(resolve("Curaçao or Draw")).toBe("away_or_draw"); // X2
    expect(resolve("Curaçao or Germany")).toBe("home_or_away"); // 12 (ordem livre)
  });

  it("é robusto a ordem invertida e 'Draw' antes do time", () => {
    expect(resolve("Germany or Curaçao")).toBe("home_or_away");
    expect(resolve("Draw or Germany")).toBe("home_or_draw");
    expect(resolve("Draw or Curaçao")).toBe("away_or_draw");
  });

  it("case-insensitive no separador ' or ' e no 'Draw'", () => {
    expect(resolve("Germany OR Draw")).toBe("home_or_draw");
    expect(resolve("germany or draw")).toBe("home_or_draw");
  });

  // Defensivo: null em qualquer não-correspondência → pickBestBookmaker dropa o
  // book como incompleto (nunca mapeia errado). Espelha a defesa do MATCH_RESULT.
  it("retorna null quando uma parte não casa nenhum time", () => {
    expect(resolve("Brazil or Draw")).toBeNull();
    expect(resolve("Brazil or Argentina")).toBeNull();
    expect(resolve("Germany or Argentina")).toBeNull(); // só um casa
  });

  it("retorna null quando o split não dá exatamente 2 partes", () => {
    expect(resolve("Germany")).toBeNull(); // 1 parte
    expect(resolve("Germany or Draw or Curaçao")).toBeNull(); // 3 partes
  });

  it("retorna null quando ambas as partes são 'Draw'", () => {
    expect(resolve("Draw or Draw")).toBeNull();
  });

  it("descriptor: oddsSource additional, coveredLeagues world_cup, impliedSumTarget 2", () => {
    expect(DOUBLE_CHANCE.oddsSource).toBe("additional");
    expect(DOUBLE_CHANCE.coveredLeagues).toEqual(["world_cup"]);
    expect(DOUBLE_CHANCE.impliedSumTarget).toBe(2);
    expect(DOUBLE_CHANCE.providerMarketKey).toBe("double_chance");
    expect(DOUBLE_CHANCE.selectionKeys).toEqual([
      "home_or_draw",
      "away_or_draw",
      "home_or_away",
    ]);
    expect(getDescriptor("double_chance")).toBe(DOUBLE_CHANCE);
  });
});
