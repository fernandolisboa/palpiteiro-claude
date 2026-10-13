// Kelly simultâneo para apostas correlacionadas no MESMO jogo (proposta da Fase 2,
// "Kelly simultâneo"). O Kelly de uma perna isolada ignora que "vitória do mandante"
// e "mais de 2.5" ganham juntas com frequência: somar os stakes como se fossem
// independentes superexpõe a banca. Aqui as frações saem de UMA maximização sobre os
// resultados possíveis do jogo (as células da matriz de placar), agrupados pelo
// padrão de quais apostas ganham:
//
//   max_f  Σ_k p_k · log(1 + Σ_i f_i · (o_i · ganha_ik − 1))
//   s.a.   f_i ≥ 0,  Σ_i f_i ≤ MAX_TOTAL_FRACTION
//
// O objetivo é côncavo; subida de gradiente projetada com busca em linha converge pro
// ótimo global. Com uma aposta só, o resultado é o Kelly clássico (p·o − 1)/(o − 1).
// Módulo PURO (sem DB/IO), como o resto de lib/quant.

export type KellyOutcome = {
  // Probabilidade do resultado (Σ = 1 sobre todos os resultados).
  p: number;
  // wins[i] = a aposta i ganha neste resultado.
  wins: boolean[];
};

// Teto do total apostado: com Σf = 1 um resultado em que tudo perde zera a banca e o
// log diverge. 0.99 mantém o domínio aberto sem mudar nenhum caso realista (o ¼ de
// Kelly aplicado depois fica muito abaixo disso).
export const MAX_TOTAL_FRACTION = 0.99;

const MAX_ITERATIONS = 5000;
const TOLERANCE = 1e-10;

/** Projeção euclidiana em { f ≥ 0, Σf ≤ cap }. */
function project(f: number[], cap: number): number[] {
  const clipped = f.map((x) => Math.max(0, x));
  const sum = clipped.reduce((a, b) => a + b, 0);
  if (sum <= cap) return clipped;
  // Projeção no simplex { f ≥ 0, Σf = cap } (algoritmo por ordenação).
  const sorted = [...f].sort((a, b) => b - a);
  let cumulative = 0;
  let theta = 0;
  for (let i = 0; i < sorted.length; i++) {
    cumulative += sorted[i];
    const t = (cumulative - cap) / (i + 1);
    if (i === sorted.length - 1 || sorted[i + 1] <= t) {
      theta = t;
      break;
    }
  }
  return f.map((x) => Math.max(0, x - theta));
}

function growth(outcomes: KellyOutcome[], odds: number[], f: number[]): number {
  let g = 0;
  for (const o of outcomes) {
    if (o.p <= 0) continue;
    let wealth = 1;
    for (let i = 0; i < f.length; i++) {
      wealth += f[i] * (o.wins[i] ? odds[i] - 1 : -1);
    }
    if (wealth <= 0) return -Infinity;
    g += o.p * Math.log(wealth);
  }
  return g;
}

function gradient(outcomes: KellyOutcome[], odds: number[], f: number[]): number[] {
  const grad = new Array<number>(f.length).fill(0);
  for (const o of outcomes) {
    if (o.p <= 0) continue;
    let wealth = 1;
    for (let i = 0; i < f.length; i++) {
      wealth += f[i] * (o.wins[i] ? odds[i] - 1 : -1);
    }
    for (let i = 0; i < f.length; i++) {
      grad[i] += (o.p * (o.wins[i] ? odds[i] - 1 : -1)) / wealth;
    }
  }
  return grad;
}

/**
 * Frações de Kelly CHEIO (0–1 da banca) por aposta. Entrada inválida (odd ≤ 1, p fora
 * de [0,1], wins com tamanho errado) → null. Aposta sem valor sai com fração 0.
 */
export function simultaneousKellyFractions(
  outcomes: KellyOutcome[],
  odds: number[],
): number[] | null {
  const n = odds.length;
  if (n === 0) return [];
  if (odds.some((o) => !Number.isFinite(o) || o <= 1)) return null;
  if (
    outcomes.some(
      (o) => !Number.isFinite(o.p) || o.p < 0 || o.p > 1 || o.wins.length !== n,
    )
  ) {
    return null;
  }

  let f = new Array<number>(n).fill(0);
  let g = growth(outcomes, odds, f);
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const grad = gradient(outcomes, odds, f);
    // Busca em linha com recuo: passo inicial 1, divide por 2 até subir.
    let step = 1;
    let next = f;
    let nextG = g;
    while (step > 1e-12) {
      const candidate = project(
        f.map((x, i) => x + step * grad[i]),
        MAX_TOTAL_FRACTION,
      );
      const candidateG = growth(outcomes, odds, candidate);
      if (candidateG > g) {
        next = candidate;
        nextG = candidateG;
        break;
      }
      step /= 2;
    }
    const moved = next.reduce((acc, x, i) => acc + Math.abs(x - f[i]), 0);
    f = next;
    const gain = nextG - g;
    g = nextG;
    if (moved < TOLERANCE || gain < TOLERANCE * TOLERANCE) break;
  }
  return f;
}

/**
 * Agrupa as células da matriz de placar pelo padrão de vitórias das apostas (até 2^n
 * grupos), pra o otimizador iterar sobre poucos resultados em vez de ~121 células.
 */
export function outcomesFromScoreMatrix(
  cells: number[][],
  predicates: Array<(home: number, away: number) => boolean>,
): KellyOutcome[] {
  const byPattern = new Map<string, KellyOutcome>();
  for (let h = 0; h < cells.length; h++) {
    for (let a = 0; a < cells[h].length; a++) {
      const p = cells[h][a];
      if (p <= 0) continue;
      const wins = predicates.map((pred) => pred(h, a));
      const key = wins.map((w) => (w ? "1" : "0")).join("");
      const existing = byPattern.get(key);
      if (existing) existing.p += p;
      else byPattern.set(key, { p, wins });
    }
  }
  return [...byPattern.values()];
}
