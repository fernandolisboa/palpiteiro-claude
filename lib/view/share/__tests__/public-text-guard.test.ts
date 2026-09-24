import { describe, expect, it } from "vitest";

import { unsafeForPublic } from "@/lib/view/share/public-text-guard";

// Guard de texto livre da superfície pública /p (ADR 0035 §2d / #438): valor + "%" + decimal.
describe("unsafeForPublic", () => {
  it("texto qualitativo limpo passa", () => {
    expect(unsafeForPublic("Pra mim vai dar Palmeiras")).toBe(false);
    expect(
      unsafeForPublic("O Verdão vem melhor em casa, 3 vitórias seguidas.")
    ).toBe(false);
    expect(unsafeForPublic("")).toBe(false);
  });

  it("linguagem de valor (containsValueLanguage) é insegura", () => {
    expect(unsafeForPublic("Tem edge no over")).toBe(true);
    expect(unsafeForPublic("A odd está boa")).toBe(true);
  });

  it("'%' é inseguro (probabilidade)", () => {
    expect(unsafeForPublic("62% de chance de vitória")).toBe(true);
  });

  it("decimal solto (odd/probabilidade) é inseguro — ponto, vírgula e 3+ casas", () => {
    expect(unsafeForPublic("Palmeiras a 2.10")).toBe(true);
    expect(unsafeForPublic("paga 1,95")).toBe(true);
    expect(unsafeForPublic("cotado em 1.955")).toBe(true);
  });

  it("outras formas de preço/probabilidade (review #499)", () => {
    for (const t of [
      "60 por cento de chance",
      "cotado a .95",
      "paga 5/2",
      "odd fracionária 7 / 4",
      "paga 3 pra 1",
      "entrada @3",
      "Palmeiras @ 2.10",
    ]) {
      expect(unsafeForPublic(t), t).toBe(true);
    }
  });
});
