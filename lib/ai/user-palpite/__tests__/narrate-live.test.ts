import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { templatedPalpiteNarration } from "@/lib/ai/user-palpite/fallback";
import {
  buildNarrateUserMessage,
  NARRATE_LIVE_SYSTEM_PROMPT,
  NARRATE_SYSTEM_PROMPT,
  narrateSpecFor,
  USER_PALPITE_NARRATE_LIVE_VERSION,
  USER_PALPITE_NARRATE_VERSION,
} from "@/lib/ai/user-palpite/narrate-cartridge";

import { narrationInput } from "./fixtures";

// user_palpite_narrate_live_v1 (#594, PLAN-580 §12): o mesmo cartucho com o momento e o
// placar no contexto. O de pré-jogo fica byte-idêntico.

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const BOOKMAKER_NAME =
  /\b(betano|bet365|pinnacle|betfair|sportingbet|superbet|novibet|kto)\b/i;

const LIVE = {
  moment: "aos 63'",
  score: { home: 1, away: 0 },
  red: { home: 0, away: 1 },
};

describe("user_palpite_narrate_live_v1", () => {
  it("versões: a de pré-jogo não muda; ao vivo tem a sua", () => {
    expect(USER_PALPITE_NARRATE_VERSION).toBe("user_palpite_narrate_v1");
    expect(USER_PALPITE_NARRATE_LIVE_VERSION).toBe("user_palpite_narrate_live_v1");
    expect(narrateSpecFor({})).toEqual({
      version: USER_PALPITE_NARRATE_VERSION,
      system: NARRATE_SYSTEM_PROMPT,
    });
    expect(narrateSpecFor({ live: LIVE })).toEqual({
      version: USER_PALPITE_NARRATE_LIVE_VERSION,
      system: NARRATE_LIVE_SYSTEM_PROMPT,
    });
  });

  it("prompts fixados (mudou? bump + commit prompt:)", () => {
    expect(sha(NARRATE_SYSTEM_PROMPT)).toMatchInlineSnapshot(`"f0188385956d3446"`);
    expect(sha(NARRATE_LIVE_SYSTEM_PROMPT)).toMatchInlineSnapshot(`"49a47fdd9482d8e2"`);
    expect(NARRATE_LIVE_SYSTEM_PROMPT).toContain("EM ANDAMENTO");
    expect(NARRATE_LIVE_SYSTEM_PROMPT).toContain("10. O jogo está EM ANDAMENTO.");
  });

  it("mensagem de pré-jogo: sem a situação do jogo (byte-idêntica à de antes)", () => {
    const msg = buildNarrateUserMessage(narrationInput());
    expect(msg).not.toContain("Situação do jogo");
    expect(msg).toContain("Leitura (modelo Dixon-Coles · JEV aplicado):");
    expect(sha(msg)).toMatchInlineSnapshot(`"6afc691e0d008ddb"`);
  });

  it("mensagem ao vivo: momento, placar e expulsões; a leitura é do placar final", () => {
    const msg = buildNarrateUserMessage(narrationInput({ live: LIVE }));
    expect(msg).toContain(
      "Situação do jogo: aos 63', placar Flamengo 1 × 0 Palmeiras, expulsões: Palmeiras 1.",
    );
    expect(msg).toContain(
      "Leitura (modelo Dixon-Coles · JEV aplicado; resultado final a partir do placar atual):",
    );
    const noReds = buildNarrateUserMessage(
      narrationInput({ live: { ...LIVE, red: { home: 0, away: 0 } } }),
    );
    expect(noReds).toContain("Palmeiras, sem expulsões.");
  });

  it("sem nome de casa no prompt nem na mensagem", () => {
    expect(BOOKMAKER_NAME.test(NARRATE_LIVE_SYSTEM_PROMPT)).toBe(false);
    expect(BOOKMAKER_NAME.test(buildNarrateUserMessage(narrationInput({ live: LIVE })))).toBe(
      false,
    );
  });

  it("template ao vivo abre com o momento e o placar; o de pré-jogo segue igual", () => {
    const pre = templatedPalpiteNarration(narrationInput());
    expect(pre.resumo.startsWith("Pelo modelo (Dixon-Coles · JEV aplicado), ")).toBe(true);
    const live = templatedPalpiteNarration(narrationInput({ live: LIVE }));
    expect(live.resumo.startsWith("Aos 63', com 1 × 0, pelo modelo (")).toBe(true);
  });
});
