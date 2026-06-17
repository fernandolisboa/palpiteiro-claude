import { describe, expect, it } from "vitest";

import {
  CORRECT_SCORE,
  DOUBLE_CHANCE,
  getDescriptor,
} from "@/lib/odds/market-descriptor";
import type { NormalizedOddsOutcome } from "@/lib/providers/odds/types";

// ctx do payload REAL validado (1xBet eu, soccer_fifa_world_cup, 2026-06-14).
const ctx = { homeTeam: "Germany", awayTeam: "Curaçao" };
const out = (name: string): NormalizedOddsOutcome => ({ name, price: 1.5 });
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

  it("é defensivo a nomes com colisão de substring (Korea / South Korea)", () => {
    const ko = { homeTeam: "South Korea", awayTeam: "Korea" };
    const r = (name: string) =>
      DOUBLE_CHANCE.resolveSelectionKey(out(name), ko);
    // "Korea" casa AMBOS os times via o includes() bidirecional → ambíguo na
    // dupla com empate → null (dropa o book em vez de mapear o par errado).
    expect(r("Korea or Draw")).toBeNull();
    // O par de 2 times resolve (ambos presentes → 12, independente da ordem).
    expect(r("South Korea or Korea")).toBe("home_or_away");
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

describe("CORRECT_SCORE.resolveSelectionKey (grid 16 células, sem OTHER)", () => {
  const out = (name: string): NormalizedOddsOutcome => ({ name, price: 8.5 });
  const resolve = (name: string) =>
    CORRECT_SCORE.resolveSelectionKey(out(name), {
      homeTeam: "Flamengo",
      awayTeam: "Palmeiras",
    });

  it("mapeia placares dentro do grid 0..3 (formato 'H:A')", () => {
    expect(resolve("0:0")).toBe("cs_0_0");
    expect(resolve("2:1")).toBe("cs_2_1");
    expect(resolve("3:3")).toBe("cs_3_3");
  });

  it("aceita o separador '-' além de ':'", () => {
    expect(resolve("1-0")).toBe("cs_1_0");
    expect(resolve("0 - 2")).toBe("cs_0_2");
  });

  it("dropa (null) placares FORA do grid 0..3 — sem bucket OTHER sintético", () => {
    expect(resolve("4:0")).toBeNull();
    expect(resolve("0:4")).toBeNull();
    expect(resolve("5:2")).toBeNull();
  });

  it("dropa (null) rótulos não-placar e lixo (defensivo)", () => {
    expect(resolve("Any Other Score")).toBeNull();
    expect(resolve("Other")).toBeNull();
    expect(resolve("garbage")).toBeNull();
    expect(resolve("")).toBeNull();
  });

  it("descriptor: featured, só Brasileirão, partição (16 células), EM ALL_DESCRIPTORS", () => {
    expect(CORRECT_SCORE.dbMarketKey).toBe("correct_score");
    expect(CORRECT_SCORE.providerMarketKey).toBe("bet_10");
    expect(CORRECT_SCORE.oddsSource).toBe("featured");
    expect(CORRECT_SCORE.coveredLeagues).toEqual(["brasileirao_a"]);
    expect(CORRECT_SCORE.impliedSumTarget).toBeUndefined(); // partição Σ=1
    expect(CORRECT_SCORE.selectionKeys).toHaveLength(16);
    expect(CORRECT_SCORE.selectionKeys).toContain("cs_0_0");
    expect(CORRECT_SCORE.selectionKeys).toContain("cs_3_3");
    // EM ALL_DESCRIPTORS desde a #290 (PR1): seedado + cartucho + settlement ligados.
    expect(getDescriptor("correct_score")).toBe(CORRECT_SCORE);
  });
});
