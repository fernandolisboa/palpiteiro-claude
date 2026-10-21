import { describe, expect, it } from "vitest";

import {
  checkExplanationFidelity,
  checkExplanationLanguage,
} from "@/lib/ai/bet-slip-explain/fidelity";
import type { BetExplanation } from "@/lib/ai/bet-slip-explain/schema";

import { comboInput, simplesInput } from "./fixtures";

const INPUT = simplesInput();
const GOOD: BetExplanation = {
  resumo:
    "A primeira tem valor pela sua odd e a segunda não. No backtest o modelo sozinho não bateu o fechamento: não é vantagem garantida.",
  pernas: [
    {
      indice: 0,
      texto:
        "O Dixon-Coles dá 56,2% para mais de 2,5 gols, acima dos 51,3% que a odd 1,95 precisa: retorno esperado de +9,6%. O mercado sem a margem dá 50,1%, +6,1 pontos pro modelo. Pelas bandas, 1u.",
    },
    {
      indice: 1,
      texto:
        "O modelo dá 48,0% ao Flamengo e a odd 1,8 pede 55,6%: retorno de -13,6%, sem valor. O mercado (odd 1,85) vê 52,3%, -4,3 pontos.",
    },
  ],
  combinada: null,
};

const withLeg = (i: number, texto: string): BetExplanation => ({
  ...GOOD,
  pernas: GOOD.pernas.map((p) => (p.indice === i ? { ...p, texto } : p)),
});

describe("checkExplanationFidelity (#562)", () => {
  it("texto fiel passa (odd '1,8' casa com 1,80; linha 2,5 e horário não são odds)", () => {
    expect(checkExplanationFidelity(GOOD, INPUT)).toEqual({ ok: true });
    expect(
      checkExplanationFidelity(
        withLeg(0, "Mais de 2,5 gols no jogo das 21:30: 56,2%."),
        INPUT
      )
    ).toEqual({ ok: true });
  });

  it.each([
    ["percentual inventado", withLeg(0, "chance de 61,0%")],
    ["odd inventada", withLeg(0, "a odd 2,10 pagaria mais")],
    ["pontos inventados", withLeg(0, "+9,9 pontos pro modelo")],
    ["stake inventado", withLeg(0, "o stake sugerido é 5u")],
    ["perna faltando", { ...GOOD, pernas: [GOOD.pernas[0]] }],
    [
      "perna repetida",
      { ...GOOD, pernas: [GOOD.pernas[0], { ...GOOD.pernas[1], indice: 0 }] },
    ],
    [
      "perna que não existe",
      { ...GOOD, pernas: [...GOOD.pernas, { indice: 2, texto: "x" }] },
    ],
    ["combinada a mais", { ...GOOD, combinada: "a combinada tem valor" }],
    [
      "veredito contradito (sem valor → tem valor)",
      withLeg(1, "Essa aposta tem valor."),
    ],
    [
      "veredito contradito (com valor → sem valor)",
      withLeg(0, "Está sem valor nessa odd."),
    ],
  ] as const)("%s → reprova", (_l, out) => {
    expect(checkExplanationFidelity(out as BetExplanation, INPUT).ok).toBe(
      false
    );
  });

  it("descrever o break-even numa perna sem valor não é contradição", () => {
    expect(
      checkExplanationFidelity(
        withLeg(1, "Sua odd só se paga se a chance passar de 55,6%."),
        INPUT
      )
    ).toEqual({ ok: true });
  });

  it("com coherenceWarning o texto pode falar dos dois lados", () => {
    const input = simplesInput();
    input.legs[0].coherenceWarning = true;
    expect(
      checkExplanationFidelity(
        withLeg(
          0,
          "Pela odd de mercado ficaria sem valor, mas a sua odd paga mais."
        ),
        input
      )
    ).toEqual({ ok: true });
  });

  it("'não tem valor' numa perna sem valor passa", () => {
    expect(
      checkExplanationFidelity(
        withLeg(1, "Pela sua odd, não tem valor."),
        INPUT
      )
    ).toEqual({ ok: true });
  });

  it("combinada: precisa do texto da combinada e checa os números dela", () => {
    const input = comboInput();
    const out: BetExplanation = {
      resumo: "Uma combinada de duas seleções.",
      pernas: [
        { indice: 0, texto: "56,2% sozinha." },
        { indice: 1, texto: "52,4% sozinha." },
      ],
      combinada: "Juntas, 31,5%; a odd 3,40 pede 29,4%: retorno de +7,1%.",
    };
    expect(checkExplanationFidelity(out, input)).toEqual({ ok: true });
    expect(
      checkExplanationFidelity({ ...out, combinada: null }, input).ok
    ).toBe(false);
    expect(
      checkExplanationFidelity(
        { ...out, combinada: "Juntas, 29,4% vira 40,0%." },
        input
      ).ok
    ).toBe(false);
  });
});

describe("checkExplanationLanguage (#562)", () => {
  it("texto sóbrio passa, inclusive 'não é vantagem garantida'", () => {
    expect(checkExplanationLanguage(GOOD)).toEqual({ ok: true });
  });

  it.each([
    "Isso não é uma vantagem garantida.",
    "No backtest, nada está garantido.",
    "Isto é uma leitura do modelo, não uma recomendação.",
    "O stake recomendado pelas bandas é 1u.",
    "Não recomendamos nada: só explicamos os números.",
  ])("%s → passa", (texto) => {
    expect(checkExplanationLanguage({ ...GOOD, resumo: texto })).toEqual({
      ok: true,
    });
  });

  it.each([
    "Aposte no over.",
    "Aproveite essa odd.",
    "Recomendamos o over.",
    "O over está garantido. Não perca.",
    "Vá de over sem medo.",
    "Recomendo dobrar o stake.",
    "Aumente o stake.",
    "É lucro certo.",
    "Resultado garantido.",
    "A odd da bet365 está melhor.",
    "Na casa de apostas a odd é outra.",
    "Veja em https://exemplo.com",
  ])("%s → reprova", (texto) => {
    expect(checkExplanationLanguage({ ...GOOD, resumo: texto }).ok).toBe(false);
  });

  it("futebol com 'casa' não é casa de apostas", () => {
    expect(
      checkExplanationLanguage({ ...GOOD, resumo: "O Flamengo joga em casa." })
    ).toEqual({ ok: true });
  });
});
