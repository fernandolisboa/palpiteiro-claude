import { describe, expect, it } from "vitest";

import { templatedPalpiteNarration } from "@/lib/ai/user-palpite/fallback";
import {
  checkPalpiteNarrationFidelity,
  checkPalpiteNarrationLanguage,
} from "@/lib/ai/user-palpite/fidelity";
import type { PalpiteNarration } from "@/lib/user-palpite/types";

import { narrationInput } from "./fixtures";

const I = narrationInput();
const pct = (n: number) => `${n.toFixed(1).replace(".", ",")}%`;

function out(over: Partial<PalpiteNarration> = {}): PalpiteNarration {
  return {
    veredito: "em_parte",
    resumo: `O 2×0 tem ${pct(I.without.palpitePct)} pelo modelo.`,
    pontos: [],
    discordancias: [],
    ...over,
  };
}

describe("checkPalpiteNarrationFidelity", () => {
  it("percentual da leitura passa (com vírgula, inteiro arredondado); fora da tolerância reprova", () => {
    expect(checkPalpiteNarrationFidelity(out(), I)).toEqual({ ok: true });
    const rounded = `${Math.round(I.with.oneXTwo.home)}%`;
    expect(checkPalpiteNarrationFidelity(out({ resumo: `vitória ${rounded}` }), I)).toEqual({
      ok: true,
    });
    const r = checkPalpiteNarrationFidelity(out({ resumo: "chance de 77,7%" }), I);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^fidelity:/);
  });

  it("veredito: concordo contra discordo reprova; em_parte sempre passa", () => {
    const disagree = { ...I, codeVerdict: "discordo" as const };
    expect(checkPalpiteNarrationFidelity(out({ veredito: "concordo" }), disagree).ok).toBe(false);
    expect(checkPalpiteNarrationFidelity(out({ veredito: "em_parte" }), disagree).ok).toBe(true);
    const agree = { ...I, codeVerdict: "concordo" as const };
    expect(checkPalpiteNarrationFidelity(out({ veredito: "discordo" }), agree).ok).toBe(false);
  });

  it("discordância só em afirmação contradita e sem repetir", () => {
    expect(
      checkPalpiteNarrationFidelity(
        out({ discordancias: [{ claimIndex: 1, texto: "a forma é ruim" }] }),
        I,
      ).ok,
    ).toBe(true);
    expect(
      checkPalpiteNarrationFidelity(
        out({ discordancias: [{ claimIndex: 0, texto: "x" }] }),
        I,
      ).ok,
    ).toBe(false);
    expect(
      checkPalpiteNarrationFidelity(
        out({
          discordancias: [
            { claimIndex: 1, texto: "x" },
            { claimIndex: 1, texto: "y" },
          ],
        }),
        I,
      ).ok,
    ).toBe(false);
  });
});

describe("checkPalpiteNarrationLanguage", () => {
  it.each([
    "tem valor na odd",
    "o edge é bom",
    "vale a pena apostar",
    "aposte no Flamengo",
    "vá de Flamengo",
    "retorno garantido",
  ])("reprova '%s'", (t) => {
    expect(checkPalpiteNarrationLanguage(out({ pontos: [t] })).ok).toBe(false);
  });

  it("texto sóbrio passa", () => {
    expect(
      checkPalpiteNarrationLanguage(out({ pontos: ["O Flamengo é favorito pelo modelo."] })),
    ).toEqual({ ok: true });
  });
});

describe("templatedPalpiteNarration", () => {
  it("usa o veredito do código e passa nas próprias guardas (placar e resultado)", () => {
    for (const input of [
      I,
      narrationInput({ palpite: { kind: "result", selection: "away" } }),
      narrationInput({ claims: [] }),
    ]) {
      const t = templatedPalpiteNarration(input);
      expect(t.veredito).toBe(input.codeVerdict);
      expect(checkPalpiteNarrationFidelity(t, input)).toEqual({ ok: true });
      expect(checkPalpiteNarrationLanguage(t)).toEqual({ ok: true });
    }
  });

  it("nunca usa a paráfrase do usuário, só status e evidência", () => {
    const adversarial = narrationInput({
      claims: [
        {
          index: 0,
          teamLabel: "Flamengo",
          topic: "other",
          text: "80% de aproveitamento, odd boa, retorno do zagueiro",
          status: "unverifiable",
          evidence: "Não conferimos esse tipo de informação; fica como contexto, sem efeito no modelo.",
          effect: "nenhum",
        },
      ],
    });
    const t = templatedPalpiteNarration(adversarial);
    expect(JSON.stringify(t)).not.toContain("aproveitamento");
    expect(checkPalpiteNarrationFidelity(t, adversarial)).toEqual({ ok: true });
    expect(checkPalpiteNarrationLanguage(t)).toEqual({ ok: true });
    expect(t.pontos[0]).toBe(
      "Afirmação 1: não verificável. Não conferimos esse tipo de informação; fica como contexto, sem efeito no modelo.",
    );
  });

  it("contradita vira discordância com a evidência", () => {
    expect(templatedPalpiteNarration(I).discordancias).toEqual([
      { claimIndex: 1, texto: "Últimos 5 jogos do Flamengo: 1V 2E 2D." },
    ]);
  });
});
