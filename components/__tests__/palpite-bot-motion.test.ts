import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";

import { PalpiteBot } from "@/components/palpites/palpite-bot";

// ADR 0065/0068: com "reduzir movimento" ligado no sistema, a regra global de globals.css
// para as animações do app. O run do HERO não pode parecer travado (pedido do Fernando):
// os personagens (`mascot-motion`) ficam fora da regra e o spinner da etapa segue girando.
const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

function reducedMotionBlocks(): string[] {
  const blocks: string[] = [];
  const re = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) blocks.push(m[1]);
  return blocks;
}

describe("movimento do robozinho e do progresso (globals.css)", () => {
  it("a regra global de movimento reduzido não pega os personagens", () => {
    const global = reducedMotionBlocks().find((b) =>
      b.includes("animation-duration: 0.01ms")
    );
    expect(global).toContain("*:not(.mascot-motion, .mascot-motion *)");
    expect(global).not.toMatch(/^\s*\*,/m);
  });

  it("o robozinho leva mascot-motion na raiz do SVG", () => {
    const html = renderToStaticMarkup(createElement(PalpiteBot, { beat: 0 }));
    expect(html).toMatch(/<svg[^>]*class="mascot-motion /);
  });

  it("o spinner da etapa em andamento continua girando com movimento reduzido", () => {
    const block = reducedMotionBlocks().find((b) =>
      b.includes(".palpite-spin")
    );
    expect(block).toMatch(
      /\.palpite-spin \{\s*animation:\s*palpite-spin\s+[\d.]+s\s+linear\s+infinite\s*!important/
    );
    const kf = /@keyframes palpite-spin \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(kf).toContain("rotate(360deg)");
  });
});
