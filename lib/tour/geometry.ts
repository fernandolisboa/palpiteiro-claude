/**
 * Geometria pura do tour guiado: recorte do spotlight e posição do cartão. Sem DOM,
 * pra ser testável; o componente só mede e repassa.
 */

export type Box = { top: number; left: number; width: number; height: number };
export type Size = { width: number; height: number };

/** Folga entre o elemento destacado e a borda do recorte. */
export const SPOT_PADDING = 6;
/** Distância do cartão até o recorte. */
export const CARD_GAP = 12;
/** Margem mínima do cartão até a borda da tela. */
export const VIEWPORT_MARGIN = 12;

const SPOT_RADIUS = 10;

/**
 * Recorte do spotlight: o alvo com folga, preso dentro da tela. Passo interativo usa
 * folga 0 — o recorte é a área clicável, e a folga vazaria pro vizinho (outra linha
 * da lista abriria outro jogo).
 */
export function spotlightBox(
  target: Box,
  viewport: Size,
  padding: number = SPOT_PADDING,
): Box {
  const top = Math.max(target.top - padding, 0);
  const left = Math.max(target.left - padding, 0);
  const bottom = Math.min(target.top + target.height + padding, viewport.height);
  const right = Math.min(target.left + target.width + padding, viewport.width);
  return {
    top,
    left,
    width: Math.max(right - left, 0),
    height: Math.max(bottom - top, 0),
  };
}

/**
 * Path SVG da camada escura: a tela inteira menos o recorte (fill-rule evenodd). Sem
 * recorte = tela inteira escura (passo centralizado). O recorte não é pintado, então
 * não captura clique — é o que deixa o passo interativo clicável.
 */
export function overlayPath(viewport: Size, hole: Box | null): string {
  const outer = `M0 0H${viewport.width}V${viewport.height}H0Z`;
  if (!hole || hole.width === 0 || hole.height === 0) return outer;
  const r = Math.min(SPOT_RADIUS, hole.width / 2, hole.height / 2);
  const { left: x, top: y, width: w, height: h } = hole;
  const inner =
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}` +
    `V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` +
    `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  return `${outer}${inner}`;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Posição do cartão: abaixo do recorte se couber, senão acima, senão no lado com mais
 * espaço (sobrepondo o alvo se preciso — alvo maior que a tela). Horizontalmente,
 * centrado no alvo e preso às margens. Sem recorte = centro da tela.
 */
export function cardPosition(
  hole: Box | null,
  card: Size,
  viewport: Size,
): { top: number; left: number } {
  const maxTop = viewport.height - card.height - VIEWPORT_MARGIN;
  const maxLeft = viewport.width - card.width - VIEWPORT_MARGIN;
  if (!hole) {
    return {
      top: clamp((viewport.height - card.height) / 2, VIEWPORT_MARGIN, maxTop),
      left: clamp((viewport.width - card.width) / 2, VIEWPORT_MARGIN, maxLeft),
    };
  }
  const holeBottom = hole.top + hole.height;
  const spaceBelow = viewport.height - holeBottom - CARD_GAP - VIEWPORT_MARGIN;
  const spaceAbove = hole.top - CARD_GAP - VIEWPORT_MARGIN;
  let top: number;
  if (spaceBelow >= card.height) top = holeBottom + CARD_GAP;
  else if (spaceAbove >= card.height) top = hole.top - CARD_GAP - card.height;
  else top = spaceBelow >= spaceAbove ? maxTop : VIEWPORT_MARGIN;
  const left = hole.left + hole.width / 2 - card.width / 2;
  return {
    top: clamp(top, VIEWPORT_MARGIN, maxTop),
    left: clamp(left, VIEWPORT_MARGIN, maxLeft),
  };
}
