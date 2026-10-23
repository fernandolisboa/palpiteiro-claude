// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppIconMark, BRAND_BLUE } from "@/components/brand/app-icon-mark";
import {
  BrandSymbol,
  MARK_BALL,
  MARK_BALL_COLOR,
  MARK_BALL_PATCHES,
  MARK_DIM_OPACITY,
  MARK_FRAME,
  MARK_RIGHT_POST,
} from "@/components/brand/brand-mark";
import { Wordmark } from "@/components/wordmark";

/**
 * Símbolo da marca (ADR 0067, #637). A geometria é a marca: mexer num traço muda o ícone
 * instalado nos celulares, o header, os cards OG e o logo do Google de uma vez. Mudança aqui
 * é decisão, não ajuste de passagem.
 */

describe("geometria do símbolo", () => {
  it("trave arredondada, trave direita esmaecida e bola amarela no ângulo", () => {
    expect(MARK_FRAME).toBe("M18 84V44C18 29 27 22 42 22H58C73 22 82 29 82 44");
    expect(MARK_RIGHT_POST).toBe("M82 44V84");
    expect(MARK_DIM_OPACITY).toBe(0.32);
    expect(MARK_BALL).toEqual({ cx: 62.5, cy: 41.5, r: 12.5 });
    expect(MARK_BALL_COLOR).toBe("#ffb547");
  });

  it("os gomos da borda ficam dentro da bola (sem clipPath, não vazam pra trave)", () => {
    expect(MARK_BALL_PATCHES).toHaveLength(5);
    for (const d of MARK_BALL_PATCHES) {
      const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
      // M x1 y1 A r r 0 0 1 x2 y2 A pr pr 0 0 1 x1 y1: as duas pontas estão na borda.
      const ends = [
        [nums[0], nums[1]],
        [nums[7], nums[8]],
      ];
      for (const [x, y] of ends) {
        expect(Math.hypot(x - MARK_BALL.cx, y - MARK_BALL.cy)).toBeCloseTo(
          MARK_BALL.r,
          1
        );
      }
    }
  });
});

describe("AppIconMark (Satori) e BrandSymbol (DOM) desenham os mesmos traços", () => {
  const icon = renderToStaticMarkup(<AppIconMark size={32} rounded />);
  const symbol = renderToStaticMarkup(<BrandSymbol />);

  it.each([
    ["ícone", icon],
    ["símbolo", symbol],
  ])("%s tem a trave, a trave esmaecida, a bola e os gomos", (_, html) => {
    expect(html).toContain(`d="${MARK_FRAME}"`);
    expect(html).toContain(`d="${MARK_RIGHT_POST}"`);
    expect(html).toContain('stroke-opacity="0.32"');
    expect(html).toContain(`fill="${MARK_BALL_COLOR}"`);
    for (const d of MARK_BALL_PATCHES) expect(html).toContain(`d="${d}"`);
    expect(html).not.toContain("clip-path");
  });

  it("no ícone, os gomos são vazados no azul do fundo", () => {
    expect(icon).toContain(`fill="${BRAND_BLUE}"`);
  });

  it("o símbolo do DOM é decorativo e usa o azul do tema no fundo e nos gomos", () => {
    expect(symbol).toContain('aria-hidden="true"');
    expect(symbol).toContain("text-primary");
    expect(symbol).toContain(
      '<rect width="100" height="100" rx="22" fill="currentColor"'
    );
    expect(symbol).toContain('fill="currentColor"');
  });
});

describe("Wordmark", () => {
  it("leva o símbolo antes do nome, sem sufixo", () => {
    const html = renderToStaticMarkup(<Wordmark />);
    expect(html.indexOf("<svg")).toBeGreaterThan(-1);
    expect(html.indexOf("<svg")).toBeLessThan(html.indexOf("palpiteiro"));
    expect(html.replace(/<[^>]+>/g, "")).toBe("palpiteiro");
  });
});
