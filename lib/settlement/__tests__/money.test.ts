import { describe, expect, it } from "vitest";

import {
  persistedResult,
  profitForOutcome,
  profitForResult,
} from "@/lib/settlement/money";

describe("profitForOutcome", () => {
  it("won → stake*(odd-1), rounded", () => {
    expect(profitForOutcome("won", 1.9, 1)).toBe(0.9);
    expect(profitForOutcome("won", 2.05, 1)).toBe(1.05);
  });

  it("lost → -stake", () => {
    expect(profitForOutcome("lost", 1.9, 1)).toBe(-1);
    expect(profitForOutcome("lost", 2.0, 2)).toBe(-2);
  });

  it("push → 0 (stake returned)", () => {
    expect(profitForOutcome("push", 1.9, 1)).toBe(0);
  });

  // #167 / ADR 0019: o profit escala LINEAR com o stake (1–3u). Pin do critério
  // "settlement multiplica o profit pelo stake correto, incl. push devolve o
  // stake independente do tamanho".
  it("won → escala linear com o stake (2u/3u)", () => {
    expect(profitForOutcome("won", 1.9, 2)).toBe(1.8); // 2*(1.9-1)
    expect(profitForOutcome("won", 2.0, 3)).toBe(3.0); // 3*(2.0-1)
  });

  it("lost → -stake escala (3u → -3)", () => {
    expect(profitForOutcome("lost", 1.9, 3)).toBe(-3);
  });

  it("push → 0 independente do stake (devolve o stake; 2u e 3u → 0)", () => {
    expect(profitForOutcome("push", 1.9, 2)).toBe(0);
    expect(profitForOutcome("push", 2.5, 3)).toBe(0);
  });

  it("half_win → 0.5*stake*(odd-1) (asian-handicap forward-proof, ADR 0016 D4)", () => {
    expect(profitForOutcome("half_win", 1.9, 2)).toBe(0.9);
  });

  it("half_loss → -0.5*stake (asian-handicap forward-proof, ADR 0016 D4)", () => {
    expect(profitForOutcome("half_loss", 1.9, 2)).toBe(-1);
  });

  it("uses the EPSILON round2 (pins I1, diverges from the kpis non-epsilon variant)", () => {
    // raw = 0.15*(1.9-1) = 0.135, which floats to 0.13499999999999998.
    // round2 WITH +Number.EPSILON → 0.14; the non-epsilon Math.round(n*100)/100
    // would give 0.13. Asserting 0.14 pins the settlement variant.
    expect(profitForOutcome("won", 1.9, 0.15)).toBe(0.14);
    expect(Math.round(0.15 * (1.9 - 1) * 100) / 100).toBe(0.13); // the WRONG variant
  });
});

describe("persistedResult", () => {
  it("collapses half_* into the persisted enum, identity otherwise", () => {
    expect(persistedResult("won")).toBe("won");
    expect(persistedResult("lost")).toBe("lost");
    expect(persistedResult("push")).toBe("push");
    expect(persistedResult("half_win")).toBe("won");
    expect(persistedResult("half_loss")).toBe("lost");
  });
});

describe("profitForResult (override-facing)", () => {
  it("won → stake*(odd-1)", () => {
    expect(profitForResult("won", 1.9, 1)).toBe(0.9);
  });

  it("lost → -stake", () => {
    expect(profitForResult("lost", 1.9, 1)).toBe(-1);
  });

  it("void → 0 regardless of odd", () => {
    expect(profitForResult("void", 1.9, 1)).toBe(0);
    expect(profitForResult("void", null, 1)).toBe(0);
  });

  it("push → 0 (unreachable in #166, gated until #168, covered anyway)", () => {
    expect(profitForResult("push", 1.9, 1)).toBe(0);
    expect(profitForResult("push", null, 1)).toBe(0);
  });

  // #167 / ADR 0019: o override é o caminho REAL de re-settle e TAMBÉM escala com
  // o stake. Espelha o pin de profitForOutcome no path manual.
  it("won/lost escalam com o stake (3u); push devolve o stake (2u/3u → 0)", () => {
    expect(profitForResult("won", 2.0, 3)).toBe(3.0); // 3*(2.0-1)
    expect(profitForResult("lost", 1.9, 3)).toBe(-3);
    expect(profitForResult("push", 1.9, 2)).toBe(0);
    expect(profitForResult("push", 2.5, 3)).toBe(0);
  });

  it("won/lost with null odd → null (can't price, caller must reject)", () => {
    expect(profitForResult("won", null, 1)).toBeNull();
    expect(profitForResult("lost", null, 1)).toBeNull();
  });
});
