import { describe, expect, it } from "vitest";

import {
  CreatePoolSchema,
  MAX_ENTRY_AMOUNT_CENTS,
  parseBettorName,
  parseManualScore,
  parseMoneyToCents,
  parsePoolBet,
} from "@/lib/pools/pool-schema";

describe("parseMoneyToCents", () => {
  it.each([
    ["", null],
    ["   ", null],
    ["10", 1000],
    ["10,5", 1050],
    ["10,50", 1050],
    ["10.50", 1050],
    ["R$ 10,00", 1000],
    ["1.000", 100000],
    ["1.000,50", 100050],
  ])("%j → %j", (raw, cents) => {
    expect(parseMoneyToCents(raw)).toBe(cents);
  });

  it.each(["abc", "-5", "0", "0,00", "10,505", "1,000.50"])("%j é inválido", (raw) => {
    expect(parseMoneyToCents(raw)).toBeUndefined();
  });

  it("respeita o teto", () => {
    expect(parseMoneyToCents("10000")).toBe(MAX_ENTRY_AMOUNT_CENTS);
    expect(parseMoneyToCents("10000,01")).toBeUndefined();
  });
});

describe("CreatePoolSchema", () => {
  const matchId = "3f2b8a4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
  it("título e valor opcionais", () => {
    expect(CreatePoolSchema.parse({ matchId, title: "  ", entryAmountCents: "" })).toEqual({
      matchId,
      title: null,
      entryAmountCents: null,
    });
  });
  it("normaliza o título e lê o valor", () => {
    expect(
      CreatePoolSchema.parse({ matchId, title: " Bolão   de sábado ", entryAmountCents: "10" }),
    ).toEqual({ matchId, title: "Bolão de sábado", entryAmountCents: 1000 });
  });
  it("rejeita jogo inválido e valor inválido", () => {
    expect(CreatePoolSchema.safeParse({ matchId: "x", title: "", entryAmountCents: "" }).success).toBe(false);
    expect(CreatePoolSchema.safeParse({ matchId, title: "", entryAmountCents: "dez" }).success).toBe(false);
  });
});

describe("parsePoolBet", () => {
  it("placar exato", () => {
    expect(parsePoolBet({ kind: "exact_score", home: "2", away: " 0 " })).toEqual({
      kind: "exact_score",
      params: { home: 2, away: 0 },
    });
  });

  it("placar com campo vazio, negativo ou grande é inválido", () => {
    expect(parsePoolBet({ kind: "exact_score", home: "", away: "1" })).toBeNull();
    expect(parsePoolBet({ kind: "exact_score", home: "-1", away: "1" })).toBeNull();
    expect(parsePoolBet({ kind: "exact_score", home: "31", away: "1" })).toBeNull();
    expect(parsePoolBet({ kind: "exact_score", home: "1.5", away: "1" })).toBeNull();
  });

  it("seleções", () => {
    expect(parsePoolBet({ kind: "match_result", pick: "draw" })?.params).toEqual({ selection: "draw" });
    expect(parsePoolBet({ kind: "double_chance", pick: "home_away" })?.params).toEqual({
      selection: "home_away",
    });
    expect(parsePoolBet({ kind: "btts", pick: "no" })?.params).toEqual({ selection: "no" });
    expect(parsePoolBet({ kind: "over_under", pick: "under:3.5" })?.params).toEqual({
      selection: "under",
      line: 3.5,
    });
  });

  it("rejeita kind fora do bolão e seleção inválida", () => {
    expect(parsePoolBet({ kind: "corners", pick: "over:9.5" })).toBeNull();
    expect(parsePoolBet({ kind: "match_result", pick: "x" })).toBeNull();
    expect(parsePoolBet({ kind: "over_under", pick: "over:4.5" })).toBeNull();
    expect(parsePoolBet({ kind: "over_under", pick: "over" })).toBeNull();
  });
});

describe("parseBettorName / parseManualScore", () => {
  it("nome aparado, 1–40", () => {
    expect(parseBettorName("  Zé   da Silva ")).toBe("Zé da Silva");
    expect(parseBettorName("   ")).toBeNull();
    expect(parseBettorName("x".repeat(41))).toBeNull();
    expect(parseBettorName(undefined)).toBeNull();
  });

  it("placar manual exige os dois números", () => {
    expect(parseManualScore("1", "0")).toEqual({ home: 1, away: 0 });
    expect(parseManualScore("", "0")).toBeNull();
    expect(parseManualScore("1", "")).toBeNull();
  });
});
