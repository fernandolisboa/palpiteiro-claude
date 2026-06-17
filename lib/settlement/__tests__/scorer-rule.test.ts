import { describe, expect, it } from "vitest";

import {
  anytimeScorerRule,
  assistRule,
} from "@/lib/settlement/rules/scorer";
import { SettlementError, type ResultData } from "@/lib/settlement/schemas";

function rd(over: Partial<ResultData> = {}): ResultData {
  return {
    homeScore: 2,
    awayScore: 1,
    totalGoals: 3,
    ...over,
  };
}

describe("anytimeScorerRule (#290 — 4 casos)", () => {
  it("WON quando há um scorer casando a seleção (por nome canônico slugado)", () => {
    const data = rd({
      eventsAvailable: true,
      scorers: [{ playerId: 10, canonicalName: "Pedro" }],
    });
    expect(anytimeScorerRule("scorer_pedro", null, data)).toBe("won");
  });

  it("LOST quando o jogador NÃO marcou (lista autoritativa, mas sem casar)", () => {
    const data = rd({
      eventsAvailable: true,
      scorers: [{ playerId: 99, canonicalName: "Arrascaeta" }],
    });
    expect(anytimeScorerRule("scorer_pedro", null, data)).toBe("lost");
  });

  it("LOST quando ninguém marcou (lista vazia mas eventsAvailable)", () => {
    const data = rd({ eventsAvailable: true, scorers: [] });
    expect(anytimeScorerRule("scorer_pedro", null, data)).toBe("lost");
  });

  it("PENDING (SettlementError) quando eventsAvailable !== true", () => {
    expect(() =>
      anytimeScorerRule("scorer_pedro", null, rd({ scorers: [] })),
    ).toThrow(SettlementError);
    expect(() =>
      anytimeScorerRule(
        "scorer_pedro",
        null,
        rd({ eventsAvailable: false, scorers: [] }),
      ),
    ).toThrow(SettlementError);
  });

  it("PENDING (SettlementError) quando a lista scorers é undefined", () => {
    expect(() =>
      anytimeScorerRule("scorer_pedro", null, rd({ eventsAvailable: true })),
    ).toThrow(SettlementError);
  });

  it("casa nomes com acento (slug consistente entre odds e events)", () => {
    const data = rd({
      eventsAvailable: true,
      scorers: [{ playerId: null, canonicalName: "José Aldánio" }],
    });
    expect(anytimeScorerRule("scorer_jose_aldanio", null, data)).toBe("won");
  });
});

describe("assistRule (#290)", () => {
  it("WON quando há um assistente casando; LOST senão", () => {
    const data = rd({
      eventsAvailable: true,
      assisters: [{ playerId: 7, canonicalName: "Gerson" }],
    });
    expect(assistRule("assist_gerson", null, data)).toBe("won");
    expect(assistRule("assist_pedro", null, data)).toBe("lost");
  });

  it("PENDING quando assisters undefined (mesma spine)", () => {
    expect(() =>
      assistRule("assist_gerson", null, rd({ eventsAvailable: true })),
    ).toThrow(SettlementError);
  });
});
