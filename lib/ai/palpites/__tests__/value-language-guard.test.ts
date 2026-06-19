import { describe, expect, it } from "vitest";

import { containsValueLanguage } from "@/lib/ai/palpites/value-language-guard";

describe("containsValueLanguage — barra linguagem de valor (ADR 0030 §3)", () => {
  it.each([
    "Tem edge no over",
    "O EV é positivo aqui",
    "Vale o valor esperado",
    "Good expected value on the home side",
    "Aposte 2 de stake",
    "Boas 3 unidades nesse",
    "Yield alto nesse mercado",
    "Lucro garantido no Fla",
    "Nice profit on this one",
    "A odd está boa",
    "As odds favorecem o mandante",
    "A cotação subiu",
    "A cotação caiu de novo",
    "Lucro de R$ 100",
  ])("detecta value-language: %s", (text) => {
    expect(containsValueLanguage(text)).toBe(true);
  });

  it.each([
    "Vai dar Flamengo, 2 a 1 tranquilo",
    "O mandante vem voando e marca fácil em casa",
    "Clássico pegado, aposto num empate",
    "Confiança alta nesse palpite",
    "O time está com 70% de aproveitamento na temporada", // % sozinho NÃO é value-language
    "O Palmeiras leva, mas sofrendo",
  ])("NÃO detecta texto de torcida limpo: %s", (text) => {
    expect(containsValueLanguage(text)).toBe(false);
  });

  it("é case-insensitive e respeita word-boundary (não pega 'edge' dentro de palavra)", () => {
    expect(containsValueLanguage("EDGE claro")).toBe(true);
    expect(containsValueLanguage("ODD boa")).toBe(true);
    // word-boundary: 'odd' está colado em 'oddziak' → não casa.
    expect(containsValueLanguage("o jogador oddziak marca")).toBe(false);
    // 'ev' como palavra inteira casa; dentro de 'levar' não.
    expect(containsValueLanguage("vai levar o jogo")).toBe(false);
    expect(containsValueLanguage("o EV manda")).toBe(true);
  });
});
