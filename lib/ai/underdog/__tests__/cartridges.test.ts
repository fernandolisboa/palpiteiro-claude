import { describe, expect, it } from "vitest";

import {
  ADVOCATE_SYSTEM_PROMPT,
  advocateTool,
  buildAdvocateUserMessage,
  UNDERDOG_ADVOCATE_VERSION,
} from "@/lib/ai/underdog/advocate-cartridge";
import {
  buildReviewUserMessage,
  REVIEW_SYSTEM_PROMPT,
  reviewTool,
  UNDERDOG_REVIEW_VERSION,
} from "@/lib/ai/underdog/review-cartridge";

import { block } from "./fixtures";

// ADR 0071: system e ferramenta constantes (nada de time, data ou id); o que varia vai
// na mensagem do usuário.
const STATIC = [
  ADVOCATE_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  JSON.stringify(advocateTool),
  JSON.stringify(reviewTool),
];

describe("cartuchos do azarão", () => {
  it("versões", () => {
    expect(UNDERDOG_ADVOCATE_VERSION).toBe("underdog_advocate_v1");
    expect(UNDERDOG_REVIEW_VERSION).toBe("underdog_review_v1");
  });

  it("system e ferramentas sem nome de time, data, id ou número de jogo", () => {
    for (const s of STATIC) {
      expect(s).not.toMatch(/Palmeiras|Flamengo/);
      expect(s).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(s).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
      expect(s).not.toMatch(/\d+%/);
    }
  });

  it("sem casa de apostas no prompt (regra de produto)", () => {
    for (const s of [ADVOCATE_SYSTEM_PROMPT, REVIEW_SYSTEM_PROMPT]) {
      expect(s).not.toMatch(/betano|bet365|pinnacle|betfair/i);
    }
  });

  it("a mensagem do advogado traz o bloco com os ids", () => {
    const b = block();
    const msg = buildAdvocateUserMessage(b.text);
    for (const id of b.ids) expect(msg).toContain(`[${id}]`);
    expect(msg).toContain("Flamengo");
  });

  it("o revisor recebe só o bloco e o rascunho numerado", () => {
    const b = block();
    const msg = buildReviewUserMessage(b.text, [
      { text: "Frase um.", facts: ["P1", "C1"] },
      { text: "Frase dois.", facts: ["F1"] },
    ]);
    expect(msg).toContain("[0] Frase um. (fatos: P1, C1)");
    expect(msg).toContain("[1] Frase dois. (fatos: F1)");
    expect(msg).not.toContain(ADVOCATE_SYSTEM_PROMPT.slice(0, 40));
  });
});
