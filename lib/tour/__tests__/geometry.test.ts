import { describe, expect, it } from "vitest";

import {
  CARD_GAP,
  cardPosition,
  overlayPath,
  SPOT_PADDING,
  spotlightBox,
  VIEWPORT_MARGIN,
} from "@/lib/tour/geometry";

const viewport = { width: 390, height: 800 };
const card = { width: 360, height: 200 };

describe("spotlightBox", () => {
  it("adiciona folga e prende na tela", () => {
    expect(spotlightBox({ top: 100, left: 20, width: 100, height: 40 }, viewport)).toEqual({
      top: 100 - SPOT_PADDING,
      left: 20 - SPOT_PADDING,
      width: 100 + 2 * SPOT_PADDING,
      height: 40 + 2 * SPOT_PADDING,
    });
    const clipped = spotlightBox({ top: -50, left: 0, width: 390, height: 100 }, viewport);
    expect(clipped.top).toBe(0);
    expect(clipped.left).toBe(0);
    expect(clipped.width).toBe(390);
    expect(clipped.height).toBe(50 + SPOT_PADDING);
  });
});

describe("overlayPath", () => {
  it("sem recorte cobre a tela inteira", () => {
    expect(overlayPath(viewport, null)).toBe("M0 0H390V800H0Z");
  });

  it("com recorte adiciona um segundo subpath", () => {
    const d = overlayPath(viewport, { top: 10, left: 10, width: 100, height: 50 });
    expect(d.startsWith("M0 0H390V800H0Z")).toBe(true);
    expect(d.match(/M/g)).toHaveLength(2);
  });
});

describe("cardPosition", () => {
  it("sem recorte, centraliza", () => {
    expect(cardPosition(null, card, viewport)).toEqual({ top: 300, left: 15 });
  });

  it("cabe embaixo → embaixo do recorte", () => {
    const hole = { top: 100, left: 20, width: 100, height: 40 };
    expect(cardPosition(hole, card, viewport).top).toBe(140 + CARD_GAP);
  });

  it("não cabe embaixo → em cima do recorte", () => {
    const hole = { top: 600, left: 20, width: 100, height: 100 };
    expect(cardPosition(hole, card, viewport).top).toBe(600 - CARD_GAP - card.height);
  });

  it("alvo maior que a tela → fica dentro da tela, no lado com mais espaço", () => {
    const hole = { top: 50, left: 0, width: 390, height: 700 };
    const { top } = cardPosition(hole, card, viewport);
    expect(top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
    expect(top + card.height).toBeLessThanOrEqual(viewport.height - VIEWPORT_MARGIN);
  });

  it("prende na margem horizontal", () => {
    const hole = { top: 100, left: 350, width: 40, height: 40 };
    expect(cardPosition(hole, card, viewport).left).toBe(390 - 360 - VIEWPORT_MARGIN);
  });
});
