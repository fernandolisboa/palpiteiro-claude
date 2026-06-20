import { describe, expect, it } from "vitest";

import { SETTLEABLE_PALPITE_TYPES } from "@/lib/ai/palpites/settleable";
import {
  EVENT_BACKED_PALPITE_TYPES,
  PALPITE_SETTLEMENT_RULES,
  WEB_GROUNDED_PALPITE_TYPES,
} from "@/lib/settlement/rules/palpite-dispatch";

describe("palpite dispatch — registry e roteamento", () => {
  it("toda tupla settleable tem regra registrada (exaustividade)", () => {
    for (const type of SETTLEABLE_PALPITE_TYPES) {
      expect(typeof PALPITE_SETTLEMENT_RULES[type]).toBe("function");
    }
  });

  it("cards está em SETTLEABLE e em WEB_GROUNDED", () => {
    expect(SETTLEABLE_PALPITE_TYPES).toContain("cards");
    expect(WEB_GROUNDED_PALPITE_TYPES.has("cards")).toBe(true);
  });

  it("cards NÃO está em EVENT_BACKED (não tem caminho /fixtures/events)", () => {
    expect(EVENT_BACKED_PALPITE_TYPES.has("cards")).toBe(false);
  });

  it("EVENT_BACKED ∩ WEB_GROUNDED === ∅ (sem double-fetch api-football + web)", () => {
    const intersection = [...WEB_GROUNDED_PALPITE_TYPES].filter((t) =>
      EVENT_BACKED_PALPITE_TYPES.has(t),
    );
    expect(intersection).toEqual([]);
  });

  it("first_to_score é event-backed e NÃO web-grounded", () => {
    expect(EVENT_BACKED_PALPITE_TYPES.has("first_to_score")).toBe(true);
    expect(WEB_GROUNDED_PALPITE_TYPES.has("first_to_score")).toBe(false);
  });
});
