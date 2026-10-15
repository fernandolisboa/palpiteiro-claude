export type Overround = number;

export type MarketImpliedProbabilities = {
  probs: number[];
  overround: Overround;
};

function assertValidOdd(label: string, odd: number): void {
  if (!Number.isFinite(odd) || odd <= 1) {
    throw new Error(`Invalid ${label} odd: ${odd} (must be finite and > 1)`);
  }
}

// Core canônico N-ário (ADR 0018, decisão 1): normaliza as probabilidades
// implícitas de um mercado de N seleções descontando o overround embutido.
// O over/under (N=2) é só um caso particular deste core (sem wrapper binário
// dedicado desde a Fase 5 — os callers passam [overOdd, underOdd]).
// Fórmulas:
//   raw_i = 1/odds[i]
//   sum = Σ_i raw_i
//   overround = sum - 1    (FRAÇÃO, não percentual; ver ADR 0018 / call sites)
//   probs_i = raw_i / sum  (normalizada — Σ_i probs_i = 1)
// overround só faz sentido pra N ≥ 2 (o menor mercado real); callers não
// devem lê-lo com N < 2.
export function computeMarketImpliedProbabilities(
  odds: number[],
): MarketImpliedProbabilities {
  if (odds.length === 0) {
    throw new Error("Invalid market: odds array must not be empty");
  }
  odds.forEach((odd, i) => assertValidOdd(String(i), odd));
  const raw = odds.map((odd) => 1 / odd);
  const sum = raw.reduce((a, b) => a + b, 0);
  return {
    probs: raw.map((r) => r / sum),
    overround: sum - 1,
  };
}

/**
 * Margem do mercado COMPLETO (fração): Σ(1/odd) ÷ alvo − 1 (#576, tabela de mercados).
 * Com alvo 1 (partição: 1X2, over/under, ambas marcam) é o `overround` do core. Na
 * dupla chance (alvo 2) cada resultado-base entra em duas seleções, então Σ − 2
 * mostraria a margem em dobro: dividir pelo alvo devolve a margem do 1X2 de origem.
 */
export function computeMarketMargin(odds: number[], impliedSumTarget = 1): number {
  const { overround } = computeMarketImpliedProbabilities(odds);
  return (overround + 1) / impliedSumTarget - 1;
}

// Métodos alternativos de de-vig (trilha de calibração, report 13). O proporcional
// acima divide a margem na proporção de cada 1/odd; as casas, porém, embutem mais
// margem nas zebras (viés favorito–zebra), então ele deixa a zebra alta demais.
// Shin e potência corrigem isso de jeitos diferentes. Mesmo `overround` do
// proporcional (é propriedade das odds, não do método).
export type DevigMethod = "proportional" | "shin" | "power";

// Bisseção de uma função monótona em [lo, hi] até `iterations` passos. 80 passos
// num intervalo de largura ≤ 100 dão erro < 1e-22: bem abaixo de qualquer odd.
function bisect(
  f: (x: number) => number,
  lo: number,
  hi: number,
  iterations = 80,
): number | null {
  let a = lo;
  let b = hi;
  const fa = f(a);
  // Sem troca de sinal não há raiz no intervalo: o caller cai no proporcional.
  if (Math.sign(fa) === Math.sign(f(b))) return null;
  for (let i = 0; i < iterations; i++) {
    const mid = (a + b) / 2;
    if (Math.sign(f(mid)) === Math.sign(fa)) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

// Shin (1993): a casa precifica como se uma fração z do volume viesse de quem sabe
// o resultado. p_i = (√(z² + 4(1−z)·π_i²/Π) − z) / (2(1−z)), com π_i = 1/odd_i,
// Π = Σπ_i e z ∈ [0, 1) tal que Σp_i = 1. Σp_i cai com z (vale √Π em z = 0), então
// há raiz única quando Π > 1. Sem margem (Π ≤ 1, ex.: melhor odd entre casas) não
// existe z ≥ 0: o caller cai no proporcional.
function shinProbs(raw: number[], sum: number): number[] | null {
  const probsAt = (z: number) =>
    raw.map(
      (r) =>
        (Math.sqrt(z * z + (4 * (1 - z) * r * r) / sum) - z) / (2 * (1 - z)),
    );
  const total = (z: number) => probsAt(z).reduce((a, b) => a + b, 0) - 1;
  const z = bisect(total, 0, 0.999);
  if (z === null) return null;
  const probs = probsAt(z);
  const s = probs.reduce((a, b) => a + b, 0);
  return probs.map((p) => p / s);
}

// Potência: p_i = π_i^k com k tal que Σp_i = 1. Σπ_i^k cai com k (π_i < 1), k > 1
// quando há margem e k < 1 quando a soma fica abaixo de 1. Zebra (π pequeno) perde
// proporcionalmente mais que o favorito.
function powerProbs(raw: number[]): number[] | null {
  const total = (k: number) => raw.reduce((a, r) => a + r ** k, 0) - 1;
  const k = bisect(total, 0.01, 100);
  if (k === null) return null;
  const probs = raw.map((r) => r ** k);
  const s = probs.reduce((a, b) => a + b, 0);
  return probs.map((p) => p / s);
}

/**
 * Igual a `computeMarketImpliedProbabilities`, com o método de de-vig escolhido.
 * `proportional` devolve exatamente o mesmo resultado do core.
 */
export function devigMarket(
  odds: number[],
  method: DevigMethod,
): MarketImpliedProbabilities {
  const base = computeMarketImpliedProbabilities(odds);
  if (method === "proportional" || odds.length < 2) return base;
  const raw = odds.map((odd) => 1 / odd);
  const sum = base.overround + 1;
  if (method === "shin" && sum <= 1) return base;
  const probs = method === "shin" ? shinProbs(raw, sum) : powerProbs(raw);
  return probs ? { probs, overround: base.overround } : base;
}
