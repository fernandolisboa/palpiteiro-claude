// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Página do jogo = uma árvore responsiva (#576). Trava a volta das duas árvores
// trocadas por CSS (uma pro celular, outra pro desktop): elas rodavam cada componente
// assíncrono duas vezes por request e dividiam o estado do BetSlip e do "Seu palpite".
// O único toggle de largura que sobra (painel ao lado × folha) mora dentro do BetSlip.

const DIR = join(__dirname, "..");
const read = (file: string) => readFileSync(join(DIR, file), "utf8");

describe.each(["page.tsx", "loading.tsx"])("app/(app)/match/[id]/%s", (file) => {
  const src = read(file);

  it("não esconde uma árvore inteira por largura", () => {
    expect(src).not.toMatch(/\blg:hidden\b/);
    expect(src).not.toMatch(/\bhidden lg:block\b/);
  });

  it("usa o PageContainer (um gutter só)", () => {
    expect(src).toMatch(/<PageContainer width="content">/);
  });
});

describe("app/(app)/match/[id]/page.tsx", () => {
  const src = read("page.tsx");

  it("renderiza cada bloco assíncrono uma vez", () => {
    for (const tag of [
      "<MatchOddsCards",
      "<MatchModelReading ",
      "<BetSlipSection",
      "<SeuPalpiteSection",
      "<MatchSections ",
      "<MatchAuxiliarySections",
      "<PalpiteArea",
      "<MatchHero",
    ]) {
      expect(src.split(tag).length - 1, tag).toBe(1);
    }
  });

  it("tem o h1 do jogo (sr-only) e uma ponte só envolvendo grade e Seu palpite", () => {
    expect(src).toMatch(/<h1 className="sr-only">/);
    expect(src.split("<BetSlipProvider").length - 1).toBe(1);
  });
});
