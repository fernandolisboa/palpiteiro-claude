import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RISK_DISCLAIMER } from "@/lib/view/share/disclaimer";

// Guards de fonte do bloco "Seu palpite" (#564, ADR 0055 Decisão 10 emendada pela ADR
// 0057): leitura de probabilidade, não dica. Sem aviso de risco próprio (o §3 fica no
// registro de apostas, na mesma tela), nada de "apostar"/"cupom" e nenhum termo de preço
// de casa ou vantagem no código da UI (fora de comentários).

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

const UI_FILES = [
  "components/seu-palpite.tsx",
  "components/seu-palpite-section.tsx",
  "lib/view/user-palpite.ts",
];

describe("components/seu-palpite.tsx — sem aviso de risco próprio (ADR 0057)", () => {
  it("nenhum RISK_DISCLAIMER_PT_BR nem trecho do §3 no bloco", () => {
    const src = read("components/seu-palpite.tsx");
    expect(src).not.toMatch(/RISK_DISCLAIMER/);
    for (const piece of [
      RISK_DISCLAIMER,
      "Aposta não é investimento",
      "nunca para recuperar perdas",
      "procure ajuda",
    ]) {
      expect(src).not.toContain(piece);
    }
  });
});

describe.each(UI_FILES)("%s — copy da UI", (file) => {
  const code = stripComments(read(file));

  it('nenhum "apostar" nem "cupom"', () => {
    expect(code).not.toMatch(/\bapostar\b/i);
    expect(code).not.toMatch(/cupom/i);
  });

  it("nenhum literal de odd, edge, stake ou unidade", () => {
    expect(code).not.toMatch(/\bodds?\b/i);
    expect(code).not.toMatch(/\bedge\b/i);
    expect(code).not.toMatch(/\bstake\b/i);
    expect(code).not.toMatch(/\bunidades?\b/i);
  });

  it("a remoção de comentários não esconde o código (sanidade)", () => {
    expect(code.length).toBeGreaterThan(200);
  });
});
