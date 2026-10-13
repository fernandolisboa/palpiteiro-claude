import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RISK_DISCLAIMER } from "@/lib/view/share/disclaimer";

// Guards de fonte do bloco "Seu palpite" (#564, ADR 0054 Decisão 8): leitura de
// probabilidade, não dica. Aviso de risco §3 verbatim, nada de "apostar"/"cupom" e
// nenhum termo de preço de casa ou vantagem no código da UI (fora de comentários).

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

function localConstant(src: string, name: string): string | null {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*\\n?\\s*"([^"]+)"`).exec(src);
  return m ? m[1] : null;
}

const UI_FILES = [
  "components/seu-palpite.tsx",
  "components/seu-palpite-section.tsx",
  "lib/view/user-palpite.ts",
];

describe("components/seu-palpite.tsx — aviso de risco §3", () => {
  it("renderiza {RISK_DISCLAIMER_PT_BR} e a cópia local é o §3 verbatim", () => {
    const src = read("components/seu-palpite.tsx");
    expect(stripComments(src)).toMatch(/\{\s*RISK_DISCLAIMER_PT_BR\s*\}/);
    expect(localConstant(src, "RISK_DISCLAIMER_PT_BR")).toBe(RISK_DISCLAIMER);
  });
});

describe.each(UI_FILES)("%s — copy da UI", (file) => {
  const code = stripComments(read(file)).replace(
    /const\s+RISK_DISCLAIMER_PT_BR\s*=\s*\n?\s*"[^"]+";/,
    "",
  );

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
