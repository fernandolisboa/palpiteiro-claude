import { describe, expect, it } from "vitest";

import { fanArcs, labelWidth } from "@/lib/view/palpite-weighed-arcs";
import { barGeometry } from "@/lib/view/palpite-weighed";

const W = 330;

describe("fanArcs", () => {
  it("um destino por lado: 22 px, etiqueta na linha", () => {
    const g = barGeometry(
      { home: 37, draw: 30, away: 33 },
      { home: 34, draw: 30, away: 36 },
      4
    );
    const a = fanArcs(g.flows, W, g.arcsHeight);
    expect(a.height).toBe(22);
    expect(a.paths).toHaveLength(1);
    expect(a.paths[0]).toMatchObject({ tint: "away", pts: 3, slot: 4 });
    expect(a.paths[0].label.onLine).toBe(true);
    expect(a.origins).toEqual([{ cx: 117.25, cy: 19.5, tint: "away" }]);
    expect(a.paths.map((p) => [p.d, p.tip])).toMatchInlineSnapshot(`
      [
        [
          "M117.25,19.5 A12,12.25 0 0 1 129.25,7.25 H204.25 A12,8.75 0 0 1 216.25,16",
          "M213,16 L219.5,16 L216.25,21 Z",
        ],
      ]
    `);
  });

  it("dois destinos do mesmo lado: 32 px, o de dentro antes e baixo, o de fora alto", () => {
    const g = barGeometry(
      { home: 52, draw: 27, away: 21 },
      { home: 50, draw: 28, away: 22 },
      4
    );
    const a = fanArcs(g.flows, W, g.arcsHeight);
    expect(a.height).toBe(32);
    const [inner, outer] = a.paths;
    expect(inner).toMatchObject({ tint: "draw", slot: 4 });
    expect(outer).toMatchObject({ tint: "away", slot: 5 });
    expect(inner.label.onLine).toBe(false);
    expect(outer.label.onLine).toBe(true);
    // O platô do de fora fica acima do salto do de dentro.
    expect(outer.label.y).toBeLessThan(inner.label.y);
    expect(a.origins).toEqual([{ cx: 168.25, cy: 29.5, tint: "away" }]);
    expect(a.paths.map((p) => p.d)).toMatchInlineSnapshot(`
      [
        "M168.25,29.5 A8,6.25 0 0 1 176.25,23.25 H206.25 A5,2.75 0 0 1 211.25,26",
        "M168.25,29.5 A6,22.75 0 0 1 174.25,6.75 H250.25 A9,19.25 0 0 1 259.25,26",
      ]
    `);
  });

  it("etiquetas sempre dentro de [0, W], mesmo coladas na borda", () => {
    const g = barGeometry(
      { home: 2, draw: 3, away: 95 },
      { home: 1, draw: 3, away: 96 },
      0
    );
    for (const width of [120, 200, 330, 640]) {
      const a = fanArcs(g.flows, width, g.arcsHeight);
      for (const p of a.paths) {
        const half = labelWidth(p.pts) / 2;
        expect(p.label.x - half).toBeGreaterThanOrEqual(0);
        expect(p.label.x + half).toBeLessThanOrEqual(width);
      }
    }
  });

  it("sem fluxo: nada", () => {
    expect(fanArcs([], W, 0)).toEqual({ height: 0, paths: [], origins: [] });
  });
});
