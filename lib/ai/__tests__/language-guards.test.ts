import { describe, expect, it } from "vitest";

import { BOOKMAKER_NAME_RE as reexported } from "@/lib/ai/bet-slip-explain/fidelity";
import {
  BET_LANGUAGE_RE,
  BOOKMAKER_NAME_RE,
  HOUSE_RE,
  IMPERATIVE_RE,
  PROMISE_RE,
  promisesGuarantee,
  URL_RE,
} from "@/lib/ai/language-guards";

// Guardas de linguagem compartilhadas (ADR 0073). BOOKMAKER_NAME_RE ganhou a forma
// genérica "<marca>bet" e as casas licenciadas mais citadas (review do #677).
describe("language-guards", () => {
  it("o reexport do bet-slip-explain é o mesmo regex", () => {
    expect(reexported).toBe(BOOKMAKER_NAME_RE);
  });

  it.each([
    [IMPERATIVE_RE, "Aposte no azarão", true],
    [IMPERATIVE_RE, "não recomendo nada", false],
    [PROMISE_RE, "é com certeza", true],
    [HOUSE_RE, "a casa de apostas paga", true],
    [URL_RE, "veja em www.site.com", true],
    [BOOKMAKER_NAME_RE, "na Betano", true],
    [BOOKMAKER_NAME_RE, "a Pixbet paga", true],
    [BOOKMAKER_NAME_RE, "odds da 1xbet", true],
    [BOOKMAKER_NAME_RE, "na Estrela Bet", true],
    [BOOKMAKER_NAME_RE, "na Estrelabet", true],
    [BOOKMAKER_NAME_RE, "Esportes da Sorte", true],
    [BOOKMAKER_NAME_RE, "Betnacional", true],
    [BOOKMAKER_NAME_RE, "na KTO", true],
    [BOOKMAKER_NAME_RE, "Bet365", true],
    [BOOKMAKER_NAME_RE, "Superbet e Novibet", true],
    [BOOKMAKER_NAME_RE, "o goleiro de Betim", false],
    [BOOKMAKER_NAME_RE, "a beterraba do almoço", false],
    [BOOKMAKER_NAME_RE, "o alfabeto da tática", false],
    [BOOKMAKER_NAME_RE, "Elizabeth no estádio", false],
    [BOOKMAKER_NAME_RE, "uma bet só", false],
    [BET_LANGUAGE_RE, "uma aposta boa", true],
    [BET_LANGUAGE_RE, "o Flamengo vence", false],
  ] as const)("%s em %j → %s", (re, text, hit) => {
    expect(re.test(text)).toBe(hit);
  });

  it("garantido só fora de negação", () => {
    expect(promisesGuarantee("a vitória está garantida")).toBe(true);
    expect(promisesGuarantee("nada está garantido")).toBe(false);
  });
});
