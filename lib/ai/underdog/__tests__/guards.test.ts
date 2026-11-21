import { describe, expect, it } from "vitest";

import {
  checkAdvocateSentence,
  checkCounterpoint,
  checkUnderdogLanguage,
} from "@/lib/ai/underdog/guards";

import { block, facts, goodDraft } from "./fixtures";

const s = (texto: string, fatos = ["P1"]) => ({ texto, fatos });

describe("guardas por frase", () => {
  it("as frases do rascunho bom passam", () => {
    const b = block();
    for (const f of goodDraft().frases)
      expect(checkAdvocateSentence(f, b)).toEqual({ ok: true });
  });

  it.each([
    ["id inexistente", s("Frase boa.", ["F9"])],
    ["percentual de fora", s("A chance é de 77%.")],
    ["placar de fora", s("Um 4 x 3 seria a cara do jogo.")],
    ["minuto de fora", s("Um gol aos 15' muda tudo.")],
    [
      "minuto de fora (aos N)",
      s("Se marcar aos 15 do primeiro tempo, muda tudo."),
    ],
    ["1 jogo em cada N de fora", s("É 1 jogo em cada 9.")],
    ["odd", s("A odd do azarão é alta.")],
    ["retorno", s("Com o retorno do zagueiro, melhora.")],
    ["aposte", s("Aposte na zebra.")],
    ["nome de casa", s("A Betano paga bem.")],
    ["casa de apostas", s("As casas de apostas não acreditam.")],
    ["URL", s("Veja em www.exemplo.com.br.")],
    ["garantido", s("A vitória está garantida.")],
    ["certeza", s("É certeza que vem zebra.")],
    ["barbada", s("Zebra barbada hoje.")],
    ["vai ganhar", s("O Flamengo vai ganhar.")],
    ["bet", s("A bet do dia é a zebra.")],
  ])("%s → corta", (_l, frase) => {
    expect(checkAdvocateSentence(frase, block()).ok).toBe(false);
  });

  it("negação não é promessa", () => {
    expect(
      checkUnderdogLanguage("Não há certeza de nada, e nada está garantido.")
    ).toEqual({
      ok: true,
    });
  });

  it("placar no espelho do azarão (1 x 0 do Flamengo = 0 x 1 do mandante) passa", () => {
    const f = facts();
    const top = f.scorelines[0];
    expect(
      checkAdvocateSentence(
        s(`Um ${top.away} x ${top.home} pro Flamengo.`, ["S1"]),
        block()
      ).ok
    ).toBe(true);
  });
});

describe("contraponto", () => {
  it("bom passa", () => {
    expect(
      checkCounterpoint("O mais provável segue sendo o Palmeiras.", block(), [])
    ).toEqual({ ok: true });
  });

  it("repetir 6+ palavras seguidas de frase cortada reprova", () => {
    const cut = "O Flamengo gosta de jogar no contra-ataque com espaço";
    expect(
      checkCounterpoint(
        "Mesmo que o Flamengo gosta de jogar no contra-ataque, o favorito segue.",
        block(),
        [cut]
      ).ok
    ).toBe(false);
  });

  it("número de fora reprova", () => {
    expect(checkCounterpoint("O Palmeiras vence em 90%.", block(), []).ok).toBe(
      false
    );
  });
});
