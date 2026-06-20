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
    "O retorno esperado é alto",
    "Bons retornos nesse mercado",
    "Nice profit on this one",
    "A odd está boa",
    "As odds favorecem o mandante",
    "A cotação subiu",
    "A cotação caiu de novo",
    "Lucro de R$ 100",
    // #376 / ADR 0031: o prompt value-aware deixa o overspill mais "quente" — o guard
    // PRECISA seguir pegando edge/EV/odd que escorreguem do raciocínio pra manchete.
    "O modelo vê edge no over, então cravo o Palmeiras",
    "As odds e o EV apontam o azarão",
    "O azarão tem mais valor esperado nesse jogo",
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
    // #376 / ADR 0031: enquadramento value-aware LIMPO (crava o azarão sem termo de
    // valor) PASSA — é exatamente o que o prompt value-aware quer permitir na manchete.
    "O azarão vem melhor e merece o crédito nesse jogo",
  ])("NÃO detecta texto de torcida limpo: %s", (text) => {
    expect(containsValueLanguage(text)).toBe(false);
  });

  it("#376: o guard bane edge/EV/stake/odd/etc. — NÃO a palavra 'valor' nua (escopo deliberado, ADR 0031)", () => {
    // O guard só veta TERMOS de aposta (edge/EV/valor esperado/stake/odd/…); "valor" nu
    // ou "tem valor" NÃO é banido. Documentar pra impedir um aperto acidental do guard
    // que quebraria o tom value-aware autorizado pelo prompt.
    expect(containsValueLanguage("O mandante tem valor nesse jogo")).toBe(false);
    expect(containsValueLanguage("Esse palpite tem valor de verdade")).toBe(false);
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
