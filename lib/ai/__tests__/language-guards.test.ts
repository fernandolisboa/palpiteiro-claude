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

// Guardas de linguagem compartilhadas (ADR 0072): movidas sem mudar comportamento.
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
