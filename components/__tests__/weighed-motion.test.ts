import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// "O que pesou" (#683): a regra global de movimento reduzido só encurta as animações e,
// com `both`, a bolinha da raia terminaria invisível. O bloco tem regra própria; este
// teste protege a regra mais fácil de perder num refactor, a sequência de 8 vagas e o
// fim do loop infinito (WCAG 2.2.2, R6 do PLAN-683).
const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
const start = css.indexOf('/* ─── "O que pesou" no palpite (#683');
const section = css.slice(start);

describe("CSS do o que pesou (globals.css)", () => {
  it("a seção existe", () => {
    expect(start).toBeGreaterThan(-1);
  });

  it("movimento reduzido: bolinhas paradas no destino, arcos escondidos, listras paradas", () => {
    const block =
      /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(
        section
      )?.[1] ?? "";
    expect(block).toMatch(
      /\.pesou \.pesou-lane \.trk i \{\s*animation: none !important;/
    );
    expect(block).toMatch(/\.pesou \.pesou-fly \{\s*display: none !important;/);
    expect(block).toMatch(
      /\.pesou \.pesou-bar > i \{\s*animation: none !important;/
    );
  });

  it("parado, a bolinha da raia já está no destino (o estado final é o estado base)", () => {
    expect(section).toMatch(
      /\.pesou-lane \.trk i \{[^}]*transform: translateX\(calc\(var\(--to\) \* 1px\)\);/
    );
    expect(section).toMatch(/\.pesou-fly \{[^}]*display: none;/);
  });

  it("8 keyframes de raia e 8 de arco, cada vaga ligada só com data-play", () => {
    for (let q = 0; q < 8; q++) {
      expect(section).toContain(`@keyframes pesou-lane-${q} {`);
      expect(section).toContain(`@keyframes pesou-arc-${q} {`);
      expect(section).toContain(
        `.pesou[data-play] .pesou-q${q} i {\n  animation: pesou-lane-${q} 5.4s linear 1.83 both;`
      );
      expect(section).toContain(
        `.pesou[data-play] .pesou-fly.pesou-q${q} {\n  animation: pesou-arc-${q} 5.4s linear 1.83 both;`
      );
    }
    expect(section).not.toContain("pesou-lane-8");
  });

  it("nenhuma animação infinita no bloco; as listras dão 8 voltas (= 2 ciclos)", () => {
    expect(section).not.toMatch(/infinite/);
    expect(section).toMatch(/animation: pesou-hatch 1\.35s linear 8;/);
  });

  it("tema escuro pela classe .dark, como o resto do app", () => {
    expect(section).toContain(".dark .pesou {");
    expect(section).not.toContain("prefers-color-scheme");
  });
});
