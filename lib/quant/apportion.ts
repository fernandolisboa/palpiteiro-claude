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

// O inteiro `v` não contradiz o cru: é 0 ou tem o sinal dele (cru ≈ 0 só aceita 0).
function keepsSign(v: number, raw: number): boolean {
  if (v === 0) return true;
  return Math.abs(raw) >= EPS && Math.sign(v) === Math.sign(raw);
}

// Quanto Σ|cru − inteiro| cresce ao somar `step` no inteiro.
function addedError(raw: number, v: number, step: number): number {
  return Math.abs(raw - (v + step)) - Math.abs(raw - v);
}

/**
 * Rateio inteiro de uma tabela com sinal (#683). Cada linha é um item (um fator) com os
 * valores crus de cada coluna (os resultados), somando 0; `targets` são os totais inteiros
 * de cada coluna (somam 0). Sai a tabela inteira em que:
 *
 * - cada linha soma 0;
 * - cada coluna soma o seu alvo;
 * - nenhum inteiro contradiz o cru: é 0 ou tem o sinal dele, em TODAS as colunas. Um fator
 *   que tirou chance de um resultado nunca aparece dando chance a ele.
 *
 * Determinístico: (1) cada célula arredonda pra longe do zero e cada linha fecha em 0 com
 * ±1 na célula onde o erro cresce menos (empate pela coluna); (2) enquanto alguma coluna
 * estiver fora do alvo, move 1 ponto de uma coluna com sobra pra uma com falta, dentro de
 * uma linha (a linha segue somando 0), escolhendo o movimento que menos aumenta Σ|cru −
 * inteiro| (empate por linha, depois coluna de origem, depois de destino). Sem movimento
 * que respeite o sinal → null (a conta não fecha sem mentir o sinal).
 */
export function apportionTable(
  raws: readonly (readonly number[])[],
  targets: readonly number[]
): number[][] | null {
  const cols = targets.length;
  const out: number[][] = [];
  for (const row of raws) {
    const r = row.map(roundAway);
    let sum = r.reduce((a, b) => a + b, 0);
    while (sum !== 0) {
      const step = sum > 0 ? -1 : 1;
      let best = -1;
      let bestCost = Infinity;
      for (let k = 0; k < cols; k++) {
        if (!keepsSign(r[k] + step, row[k])) continue;
        const cost = addedError(row[k], r[k], step);
        if (cost < bestCost - EPS) {
          best = k;
          bestCost = cost;
        }
      }
      if (best === -1) return null;
      r[best] = r[best] + step || 0;
      sum += step;
    }
    out.push(r);
  }

  const colSum = (k: number) => out.reduce((a, r) => a + r[k], 0);
  const totals = targets.map((_, k) => colSum(k));
  for (;;) {
    const off = totals.map((t, k) => t - targets[k]);
    if (off.every((d) => d === 0)) return out;
    let best: { i: number; a: number; b: number } | null = null;
    let bestCost = Infinity;
    for (let i = 0; i < out.length; i++) {
      for (let a = 0; a < cols; a++) {
        if (off[a] <= 0) continue;
        const from = out[i][a] - 1;
        if (!keepsSign(from, raws[i][a])) continue;
        for (let b = 0; b < cols; b++) {
          if (off[b] >= 0) continue;
          const to = out[i][b] + 1;
          if (!keepsSign(to, raws[i][b])) continue;
          const cost =
            addedError(raws[i][a], out[i][a], -1) +
            addedError(raws[i][b], out[i][b], 1);
          if (cost < bestCost - EPS) {
            best = { i, a, b };
            bestCost = cost;
          }
        }
      }
    }
    if (!best) return null;
    const { i, a, b } = best;
    out[i][a] = out[i][a] - 1 || 0;
    out[i][b] = out[i][b] + 1 || 0;
    totals[a] -= 1;
    totals[b] += 1;
  }
}
