import { describe, expect, it } from "vitest";

import {
  computePoolOutcome,
  entryHit,
  formatBrl,
  resolvePoolScore,
  type PoolEntryInput,
} from "@/lib/pools/winners";

const noManual = { manualHomeScore: null, manualAwayScore: null };
const finished = { status: "finished", homeScore: 2, awayScore: 1 };

describe("resolvePoolScore", () => {
  it("placar manual vence o do jogo", () => {
    expect(
      resolvePoolScore({ manualHomeScore: 0, manualAwayScore: 0 }, finished),
    ).toEqual({ home: 0, away: 0, source: "manual" });
  });

  it("usa o do jogo encerrado", () => {
    expect(resolvePoolScore(noManual, finished)).toEqual({ home: 2, away: 1, source: "jogo" });
  });

  it("jogo não encerrado ou sem placar → null", () => {
    expect(resolvePoolScore(noManual, { ...finished, status: "live" })).toBeNull();
    expect(resolvePoolScore(noManual, { status: "finished", homeScore: null, awayScore: null })).toBeNull();
  });

  it("meio placar manual não conta", () => {
    expect(resolvePoolScore({ manualHomeScore: 1, manualAwayScore: null }, finished)?.source).toBe("jogo");
  });
});

describe("entryHit", () => {
  const score = { home: 2, away: 1 };
  it.each([
    ["exact_score", { home: 2, away: 1 }, true],
    ["exact_score", { home: 1, away: 1 }, false],
    ["match_result", { selection: "home" }, true],
    ["match_result", { selection: "draw" }, false],
    ["double_chance", { selection: "draw_away" }, false],
    ["double_chance", { selection: "home_away" }, true],
    ["btts", { selection: "yes" }, true],
    ["over_under", { selection: "over", line: 2.5 }, true],
    ["over_under", { selection: "under", line: 2.5 }, false],
  ] as const)("%s %j", (kind, params, hit) => {
    expect(entryHit({ kind, params }, score)).toBe(hit);
  });

  it("kind fora do bolão ou params inválidos não derrubam: contam como erro", () => {
    expect(entryHit({ kind: "corners", params: { selection: "over", line: 9.5 } }, score)).toBe(false);
    expect(entryHit({ kind: "exact_score", params: { selection: "home" } }, score)).toBe(false);
  });
});

describe("computePoolOutcome", () => {
  const entries: PoolEntryInput[] = [
    { id: "a", kind: "exact_score", params: { home: 2, away: 1 } },
    { id: "b", kind: "match_result", params: { selection: "home" } },
    { id: "c", kind: "exact_score", params: { home: 0, away: 0 } },
  ];

  it("sem placar: pendente, com o pote", () => {
    expect(computePoolOutcome({ entries, entryAmountCents: 1000, score: null })).toEqual({
      settled: false,
      potCents: 3000,
    });
  });

  it("divide o pote entre quem acertou", () => {
    const out = computePoolOutcome({
      entries,
      entryAmountCents: 1000,
      score: { home: 2, away: 1, source: "jogo" },
    });
    expect(out.settled).toBe(true);
    if (!out.settled) return;
    expect([...out.hitIds].sort()).toEqual(["a", "b"]);
    expect(out.potCents).toBe(3000);
    expect(out.shareCents).toBe(1500);
    expect(out.remainderCents).toBe(0);
  });

  it("sobra de centavos aparece", () => {
    const out = computePoolOutcome({
      entries: [...entries, { id: "d", kind: "btts", params: { selection: "yes" } }],
      entryAmountCents: 1000,
      score: { home: 2, away: 1, source: "manual" },
    });
    if (!out.settled) throw new Error("devia estar fechado");
    expect(out.winnerCount).toBe(3);
    expect(out.shareCents).toBe(1333);
    expect(out.remainderCents).toBe(1);
  });

  it("ninguém acertou ou sem valor: sem divisão", () => {
    const none = computePoolOutcome({
      entries,
      entryAmountCents: 1000,
      score: { home: 5, away: 5, source: "jogo" },
    });
    if (!none.settled) throw new Error("devia estar fechado");
    expect(none.winnerCount).toBe(0);
    expect(none.shareCents).toBeNull();

    const free = computePoolOutcome({
      entries,
      entryAmountCents: null,
      score: { home: 2, away: 1, source: "jogo" },
    });
    if (!free.settled) throw new Error("devia estar fechado");
    expect(free.potCents).toBeNull();
    expect(free.shareCents).toBeNull();
    expect(free.winnerCount).toBe(2);
  });
});

describe("formatBrl", () => {
  it.each([
    [0, "R$ 0,00"],
    [5, "R$ 0,05"],
    [1050, "R$ 10,50"],
    [123456789, "R$ 1.234.567,89"],
  ])("%i → %s", (cents, out) => {
    expect(formatBrl(cents)).toBe(out);
  });
});
