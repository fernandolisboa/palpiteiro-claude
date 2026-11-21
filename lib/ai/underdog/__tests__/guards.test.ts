import { describe, expect, it } from "vitest";

import {
  checkAdvocateSentence,
  checkCounterpoint,
  checkUnderdogLanguage,
  checkUnderdogNumbers,
} from "@/lib/ai/underdog/guards";
import { buildFactsBlock } from "@/lib/underdog/facts";
import type { UnderdogFacts } from "@/lib/underdog/types";

import { block, CTX, facts, goodDraft } from "./fixtures";

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
    ["nome de casa (marca genérica)", s("Na Pixbet a zebra paga bem.")],
    ["nome de casa (dígito + bet)", s("A 1xbet acredita na zebra.")],
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

describe("promessa e certeza (afirmação, não negação)", () => {
  // Bahia mandante x Palmeiras: só a linguagem importa aqui.
  it.each([
    "Sem dúvida o Bahia vai vencer.",
    "Nada impede: o Bahia vai vencer.",
    "Sem dúvida é certeza de zebra.",
    "Nunca se viu nada igual: o Bahia vai ganhar",
    "É quase certo que o Bahia vence.",
    "Dá pra cravar Bahia.",
    "Pode escrever: dá Bahia.",
    "Não há dúvida de que o Bahia surpreende.",
    "O Bahia vai vencer hoje.",
    "Nada a temer — o Bahia vai ganhar.",
    "A zebra é certa.",
    "Garantido: o Bahia leva.",
    "Sem medo, a vitória está garantida.",
  ])("%s → promessa", (text) => {
    expect(checkUnderdogLanguage(text)).toEqual({
      ok: false,
      reason: "promessa",
    });
  });

  it.each([
    "Não há certeza de nada, e nada está garantido.",
    "Não é garantido, mas a zebra tem chance.",
    "Nada garantido para o Palmeiras.",
    "Isso não é uma vantagem garantida.",
    "Não dá pra cravar nada neste jogo.",
    "Ninguém tem certeza no futebol.",
    "Nada é certo antes do apito.",
    "O Bahia pode vencer se marcar cedo.",
    "Se o Bahia vai vencer, só o jogo vai dizer.",
    "Ninguém sabe se o Bahia vai vencer.",
    "Se o Bahia vencer, vai ser a zebra da rodada.",
    "O Palmeiras não vai vencer todas.",
  ])("%s → passa", (text) => {
    expect(checkUnderdogLanguage(text)).toEqual({ ok: true });
  });
});

describe("linguagem de valor própria do painel", () => {
  it.each([
    "Tem valor no Bahia hoje.",
    "O azarão tem valor neste jogo.",
    "Há valor na zebra.",
  ])("%s → corta", (text) => {
    expect(checkUnderdogLanguage(text)).toEqual({
      ok: false,
      reason: "linguagem de valor",
    });
  });

  it("'valorizar' e 'valoriza' não são linguagem de valor", () => {
    expect(
      checkUnderdogLanguage("O Flamengo valoriza a posse e o contra-ataque.")
    ).toEqual({ ok: true });
  });
});

describe("números só do bloco", () => {
  // Palmeiras (mandante, favorito) x Flamengo (visitante, azarão); confronto 3-1-1.
  const b = () => block();
  const f = () => facts();
  const ok = (text: string) => checkUnderdogNumbers(text, b().allowed);

  it.each([
    "O Flamengo venceu 4 dos últimos 5 confrontos.",
    "O Palmeiras venceu 3 dos últimos 5 confrontos.",
    "O Flamengo venceu quatro dos últimos cinco confrontos.",
    "Flamengo vence 3-1.",
    "O Flamengo pode vencer por 3 a 0.",
    "Uma vitória de 2 a 3 jogos seguidos.",
    "Gol no minuto 75.",
    "A zebra tem 0,25 de chance.",
    "O Flamengo tem 8 pontos a mais na tabela.",
    "A chance sobe 7 pontos percentuais.",
    "Palmeiras vence por 1 x 0.",
    "Um 4 x 3 seria a cara do jogo.",
    "Placar de 2 x 0 pro Palmeiras.",
  ])("%s → corta", (text) => {
    expect(ok(text).ok).toBe(false);
  });

  it("percentual sem tolerância: inteiro do bloco ± 1 não passa", () => {
    const pct = Math.round(f().chances.underdog);
    expect(ok(`O Flamengo vence em ${pct}% das simulações.`)).toEqual({
      ok: true,
    });
    expect(ok(`O Flamengo vence em ${pct + 1}% das simulações.`).ok).toBe(
      false
    );
  });

  it("placares do bloco em qualquer escrita orientada passam", () => {
    const top = f().scorelines[0]; // mandante × visitante, vitória do Flamengo
    const hi = Math.max(top.home, top.away);
    const lo = Math.min(top.home, top.away);
    for (const text of [
      `O placar mais provável é ${top.home} x ${top.away}.`,
      `Palmeiras ${top.home} x ${top.away} Flamengo é o placar de zebra.`,
      `Flamengo vence por ${hi} x ${lo}.`,
      `Um ${hi} x ${lo} pro Flamengo.`,
      `Flamengo ${hi} x ${lo}.`,
      `Palmeiras perde por ${hi} a ${lo}.`,
      `Flamengo vence por ${hi}-${lo}.`,
      "Flamengo 1 x 0 Palmeiras.",
      "Se o Flamengo estiver vencendo por 1 x 0 aos 30', a chance sobe.",
    ]) {
      expect(ok(text), text).toEqual({ ok: true });
    }
  });

  it("pares e contagens do bloco passam (lado certo)", () => {
    for (const text of [
      "O Flamengo venceu 3 dos últimos 5 confrontos.",
      "O Flamengo venceu três dos últimos cinco confrontos.",
      "O Palmeiras venceu 1 dos últimos 5 confrontos.",
      "Foram 5 confrontos recentes.",
    ]) {
      expect(ok(text), text).toEqual({ ok: true });
    }
  });

  it("forma e desfalques entram nas contagens", () => {
    const base = facts();
    const withSignals: UnderdogFacts = {
      ...base,
      signals: [
        {
          kind: "form",
          underdog: ["W", "W", "D", "L", "W"],
          favorite: ["L", "D", "L", "W", "L"],
        },
        { kind: "absences", favorite: 6, underdog: 1 },
      ],
    };
    const allowed = buildFactsBlock(withSignals, CTX).allowed;
    const check = (t: string) => checkUnderdogNumbers(t, allowed);
    expect(check("O Flamengo venceu 3 dos últimos 5 jogos.")).toEqual({
      ok: true,
    });
    expect(check("O Palmeiras perdeu 3 dos últimos 5 jogos.")).toEqual({
      ok: true,
    });
    expect(check("O Palmeiras tem 6 desfalques.")).toEqual({ ok: true });
    expect(check("O Palmeiras venceu 3 dos últimos 5 jogos.").ok).toBe(false);
    expect(check("O Palmeiras tem 7 desfalques.").ok).toBe(false);
  });

  it("o N de '1 jogo em cada N' e minutos do bloco passam", () => {
    const n = Math.round(100 / f().chances.underdog);
    expect(ok(`Mais ou menos 1 jogo em cada ${n}.`)).toEqual({ ok: true });
    expect(ok("Com um a menos desde os 60', muda.")).toEqual({ ok: true });
    expect(ok("Um gol no minuto 30 muda tudo.")).toEqual({ ok: true });
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
