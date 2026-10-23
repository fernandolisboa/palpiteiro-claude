import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// ADR 0065: com "reduzir movimento" ligado no sistema, a regra global de globals.css para
// todas as animações. O run do HERO não pode parecer travado: o que leva `palpite-calm`
// volta a respirar (só opacidade, lento), e mais nada se mexe.
const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

function reducedMotionBlocks(): string[] {
  const blocks: string[] = [];
  const re = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) blocks.push(m[1]);
  return blocks;
}

describe("movimento do robozinho e do progresso (globals.css)", () => {
  it("sob movimento reduzido, palpite-calm respira devagar e vence a regra global", () => {
    const calm = reducedMotionBlocks().find((b) => b.includes(".palpite-calm"));
    expect(calm).toBeDefined();
    expect(calm).toMatch(/animation:\s*palpite-breathe\s+2\.4s[^;]*infinite\s*!important/);
  });

  it("a respiração só mexe na opacidade (nada se desloca)", () => {
    const kf = /@keyframes palpite-breathe \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(kf).toContain("opacity");
    expect(kf).not.toMatch(/transform|scale|translate|rotate/);
  });
});
