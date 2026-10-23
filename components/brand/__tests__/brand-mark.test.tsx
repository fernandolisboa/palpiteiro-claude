// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppIconMark } from "@/components/brand/app-icon-mark";
import {
  BrandSymbol,
  MARK_FILLED_ARC,
  MARK_FILLED_SHARE,
  MARK_REST_ARC,
  MARK_STEM,
} from "@/components/brand/brand-mark";
import { Wordmark } from "@/components/wordmark";

/**
 * Símbolo da marca (ADR 0066, #629). A geometria é a marca: mexer num traço muda o ícone
 * instalado nos celulares, o header e os cards OG de uma vez. Mudança aqui é decisão, não
 * ajuste de passagem.
 */

describe("geometria do símbolo", () => {
  it("anel-medidor 68% cheio, haste do p de #616", () => {
    expect(MARK_FILLED_SHARE).toBeCloseTo(0.68, 2);
    expect(MARK_FILLED_ARC).toBe("M38 41A15 15 0 1 1 59.34 54.59");
    expect(MARK_REST_ARC).toBe("M56.37 55.62A15 15 0 0 1 39.09 46.62");
    expect(MARK_STEM).toEqual({ x: 27, y: 20.5, width: 11, height: 59.5 });
  });
});

describe("AppIconMark (Satori) e BrandSymbol (DOM) desenham os mesmos traços", () => {
  const icon = renderToStaticMarkup(<AppIconMark size={32} rounded />);
  const symbol = renderToStaticMarkup(<BrandSymbol />);

  it.each([
    ["ícone", icon],
    ["símbolo", symbol],
  ])("%s tem o arco cheio, o atenuado e a haste", (_, html) => {
    expect(html).toContain(`d="${MARK_FILLED_ARC}"`);
    expect(html).toContain(`d="${MARK_REST_ARC}"`);
    expect(html).toContain('stroke-opacity="0.38"');
    expect(html).toContain('x="27" y="20.5" width="11" height="59.5"');
  });

  it("o símbolo do DOM é decorativo e usa o azul do tema", () => {
    expect(symbol).toContain('aria-hidden="true"');
    expect(symbol).toContain('class="fill-primary"');
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
