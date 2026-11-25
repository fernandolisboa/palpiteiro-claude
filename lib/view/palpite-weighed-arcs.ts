// Arcos em leque da barra do "o que pesou" (#683, desenho v6). PURO, sem DOM: o
// componente cliente mede a largura da barra e chama isto. Porta do FLOW_SCRIPT_V6 do
// mock (destaque-fatores/v6), com a altura vinda do view model (o SSR já reserva a caixa).
//
// Todos os arcos de quem perdeu saem do MESMO ponto (o meio da tira de saída). Por lado
// dessa origem, o destino mais perto fica por dentro (salto baixo) e o mais longe por
// fora (sobe curto, corre reto e desce), sem se cruzar.

import type { OutcomeKey, WeighedFlowGroup } from "./palpite-weighed";

export type WeighedArcPath = {
  d: string;
  // Ponta triangular da seta.
  tip: string;
  tint: OutcomeKey;
  pts: number;
  slot: number;
  // Etiqueta "N pts": a de dentro acima do salto; a de fora na própria linha (on-line,
  // com fundo pra cortar o traço).
  label: { x: number; y: number; onLine: boolean };
};

export type WeighedArcs = {
  height: number;
  paths: WeighedArcPath[];
  origins: { cx: number; cy: number; tint: OutcomeKey }[];
};

const HOP = 8;
const LOW = 14;
const HIGH = 24.5;

const fmt = (n: number) => String(Number(n.toFixed(2)));

// Meio pixel: traço de 1,5 px nítido.
const snap = (x: number) => Math.round(x) + 0.25;

/** Largura estimada da etiqueta (dígitos mono ~7 px, " pt"/" pts", padding de 8 px). */
export function labelWidth(pts: number): number {
  return String(pts).length * 7 + (pts === 1 ? 14 : 19) + 8;
}

// Sobe num quarto de elipse, corre reto, desce num quarto de elipse.
function arch(
  x0: number,
  x1: number,
  yStart: number,
  yTop: number,
  yEnd: number,
  rx: number,
  rx0: number
): string {
  const dir = x1 > x0 ? 1 : -1;
  const half = Math.abs(x1 - x0) / 2;
  const r = Math.min(rx, half);
  const r0 = Math.min(rx0, half);
  const sw = dir > 0 ? 1 : 0;
  return (
    `M${fmt(x0)},${fmt(yStart)} A${fmt(r0)},${fmt(yStart - yTop)} 0 0 ${sw} ` +
    `${fmt(x0 + dir * r0)},${fmt(yTop)} H${fmt(x1 - dir * r)} ` +
    `A${fmt(r)},${fmt(yEnd - yTop)} 0 0 ${sw} ${fmt(x1)},${fmt(yEnd)}`
  );
}

/**
 * Os arcos em px pra uma barra de `width` px. `flows` em pontos (0–100) e `height` (22
 * ou 32) vêm do view model. Etiquetas presas dentro de [0, width].
 */
export function fanArcs(
  flows: readonly WeighedFlowGroup[],
  width: number,
  height: number
): WeighedArcs {
  const tip = height - 1;
  const base = tip - 5;
  const y0 = height - 2.5;
  const paths: WeighedArcPath[] = [];
  const origins: WeighedArcs["origins"] = [];
  for (const g of flows) {
    const x0 = snap((width * g.x0) / 100);
    const dests = g.dests.map((t) => ({ ...t, px: snap((width * t.x) / 100) }));
    for (const dir of [-1, 1]) {
      const ds = dests
        .filter((t) => (t.px > x0 ? 1 : -1) === dir)
        .sort((a, b) => Math.abs(a.px - x0) - Math.abs(b.px - x0));
      if (ds.length === 0) continue;
      const last = ds.length - 1;
      ds.forEach((t, k) => {
        const inner = k < last;
        const h = inner ? HOP : last > 0 ? HIGH : LOW;
        const yTop = tip - h + 0.25;
        const rx = inner ? 5 : last > 0 ? 9 : 12;
        const rx0 = inner ? 8 : last > 0 ? 6 : rx;
        let lx: number;
        let ly: number;
        let onLine: boolean;
        if (inner) {
          lx = (x0 + t.px) / 2 + dir * 1.5;
          ly = yTop - 7.75;
          onLine = false;
        } else if (last > 0) {
          const a = ds[last - 1].px + dir * 5;
          const b = t.px - dir * 8;
          lx = (a + b) / 2;
          ly = yTop;
          onLine = true;
        } else {
          lx = (x0 + t.px) / 2;
          ly = yTop;
          onLine = true;
        }
        const half = labelWidth(t.pts) / 2;
        lx = Math.min(Math.max(lx, half), Math.max(half, width - half));
        paths.push({
          d: arch(x0, t.px, y0, yTop, base, rx, rx0),
          tip: `M${fmt(t.px - 3.25)},${fmt(base)} L${fmt(t.px + 3.25)},${fmt(base)} L${fmt(t.px)},${fmt(tip)} Z`,
          tint: t.key,
          pts: t.pts,
          slot: t.slot,
          label: { x: Number(lx.toFixed(2)), y: Number(ly.toFixed(2)), onLine },
        });
      });
      origins.push({ cx: x0, cy: y0, tint: ds[last].key });
    }
  }
  return { height, paths, origins };
}
