// Arredondamento inteiro que fecha a conta (#683). PURO.

// Ruído de ponto flutuante abaixo disto não decide arredondamento (33.000000000004 → 33).
const EPS = 1e-9;

/**
 * Maior resto: inteiros que somam `total`, cada um a menos de 1 do valor. Os maiores
 * restos levam o +1; empate pelo índice (determinístico). Monotônico: nunca inverte a
 * ordem de dois valores (no máximo empata os que tinham o mesmo inteiro).
 */
export function largestRemainder(
  values: readonly number[],
  total: number
): number[] {
  const floors = values.map((v) => Math.floor(v + EPS));
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = values
    .map((v, i) => ({ i, rest: v - floors[i] }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  const out = [...floors];
  for (
    let k = 0;
    left > 0 && order.length > 0;
    k = (k + 1) % order.length, left--
  ) {
    out[order[k].i] += 1;
  }
  for (
    let k = order.length - 1;
    left < 0 && order.length > 0;
    k = (k - 1 + order.length) % order.length, left++
  ) {
    out[order[k].i] -= 1;
  }
  return out;
}

function roundAway(x: number): number {
  // `|| 0`: nada de −0 na saída.
  return Math.sign(x) * Math.round(Math.abs(x) + EPS) || 0;
}

/**
 * Reparte o inteiro `target` entre itens com valores crus `raws`: começa no arredondado
 * de cada um e acerta a soma de ±1 em ±1, sempre no item mais longe do cru na direção
 * que falta (empate pelo índice).
 *
 * Com sinal (`signSafe`, o default): o ±1 só vai pra item com cru ≠ 0 que não troca de
 * sinal (fica 0 ou no sinal do cru). Assim um fator que tirou chance de um resultado
 * nunca aparece dando chance a ele. Sem item que sirva → null (a conta não fecha sem
 * mentir o sinal).
 */
export function apportion(
  raws: readonly number[],
  target: number,
  opts: { signSafe?: boolean } = {}
): number[] | null {
  const signSafe = opts.signSafe ?? true;
  const out = raws.map(roundAway);
  let sum = out.reduce((a, b) => a + b, 0);
  while (sum !== target) {
    const step = sum < target ? 1 : -1;
    let best = -1;
    let bestErr = -Infinity;
    for (let i = 0; i < raws.length; i++) {
      if (signSafe) {
        if (Math.abs(raws[i]) < EPS) continue;
        const next = out[i] + step;
        if (next !== 0 && Math.sign(next) !== Math.sign(raws[i])) continue;
      }
      const err = step * (raws[i] - out[i]);
      if (err > bestErr + EPS) {
        best = i;
        bestErr = err;
      }
    }
    if (best === -1) return null;
    out[best] = out[best] + step || 0;
    sum += step;
  }
  return out;
}
