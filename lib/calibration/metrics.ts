// Métricas de calibração PURAS (Report 03 rec. 3, ADR 0037). Operam sobre pares
// (forecast p ∈ [0,1], resultado y ∈ {0,1}) — sem DB, sem provider. O harness computa
// as MESMAS métricas pro modelo (P(over) do LLM ancorado no Poisson) e pro mercado
// no-vig (benchmark): skill = o modelo bater o log-loss do mercado. Determinístico e
// testável com valores conhecidos.

export type CalibrationPair = {
  p: number; // forecast do evento (ex.: P(over)), 0-1
  y: 0 | 1; // o evento aconteceu?
};

// Clamp p pra fora de {0,1} — log(0)/log(1-1) explodem o log-loss. ε minúsculo:
// não move Brier perceptivelmente e mantém o log-loss finito (convenção padrão).
const EPS = 1e-15;
const clampProb = (p: number): number => Math.min(1 - EPS, Math.max(EPS, p));

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// Brier = média de (p − y)². Menor = melhor (0 = perfeito). NaN se vazio.
export function brierScore(pairs: CalibrationPair[]): number {
  if (pairs.length === 0) return NaN;
  return mean(pairs.map(({ p, y }) => (clampProb(p) - y) ** 2));
}

// Log-loss = −média de [y·ln(p) + (1−y)·ln(1−p)]. Menor = melhor. NaN se vazio.
export function logLoss(pairs: CalibrationPair[]): number {
  if (pairs.length === 0) return NaN;
  return -mean(
    pairs.map(({ p, y }) => {
      const c = clampProb(p);
      return y * Math.log(c) + (1 - y) * Math.log(1 - c);
    }),
  );
}

export type ReliabilityBin = {
  lo: number; // limite inferior do bin [lo, hi)
  hi: number;
  n: number;
  meanForecast: number | null; // média de p no bin (null se vazio)
  meanOutcome: number | null; // fração observada de y=1 no bin (null se vazio)
};

// Tabela de confiabilidade: nBins bins uniformes em [0,1]. Bem-calibrado ⇒
// meanForecast ≈ meanOutcome em cada bin. O bin do topo é [.., 1] INCLUSIVE (p=1 cai
// no último, não fora). Bins vazios ficam com n=0 e médias null (o render decide).
export function reliabilityBins(
  pairs: CalibrationPair[],
  nBins = 10,
): ReliabilityBin[] {
  const buckets: CalibrationPair[][] = Array.from({ length: nBins }, () => []);
  for (const pair of pairs) {
    const c = clampProb(pair.p);
    // floor(p·nBins) com o topo (p=1) dobrado no último bin.
    const idx = Math.min(nBins - 1, Math.floor(c * nBins));
    buckets[idx].push(pair);
  }
  return buckets.map((bucket, i) => ({
    lo: i / nBins,
    hi: (i + 1) / nBins,
    n: bucket.length,
    meanForecast: bucket.length ? mean(bucket.map((b) => b.p)) : null,
    meanOutcome: bucket.length ? mean(bucket.map((b) => b.y)) : null,
  }));
}

// Calibration slope (logistic recalibration, Cox 1958): ajusta
// logit(P(y=1)) = a + b·logit(p) por máxima verossimilhança e devolve b. É o
// "reliability slope" do gate da Fase C (ADR 0019 / Report 03 rec. 7): b ≈ 1 ⇒
// bem calibrado; b < 1 ⇒ forecasts extremos demais (overconfident — o caso que faz
// Kelly super-apostar); b > 1 ⇒ tímidos demais. NaN quando não identificável: < 2
// pares, y constante (separação — o MLE diverge), p constante (logit sem variância)
// ou Newton sem convergir.
export function calibrationSlope(pairs: CalibrationPair[]): number {
  if (pairs.length < 2) return NaN;
  const xs = pairs.map(({ p }) => {
    const c = clampProb(p);
    return Math.log(c / (1 - c));
  });
  const ys = pairs.map(({ y }) => y);
  const ySum = ys.reduce<number>((a, b) => a + b, 0);
  if (ySum === 0 || ySum === ys.length) return NaN;
  const xMean = mean(xs);
  if (xs.every((x) => Math.abs(x - xMean) < 1e-12)) return NaN;

  // Newton-Raphson em (a, b) com Hessiana 2×2 fechada. Parte da identidade
  // (a=0, b=1): o forecast tomado como está, que é onde um modelo razoável já cai.
  let a = 0;
  let b = 1;
  for (let iter = 0; iter < 100; iter++) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    for (let i = 0; i < xs.length; i++) {
      const mu = 1 / (1 + Math.exp(-(a + b * xs[i])));
      const w = mu * (1 - mu);
      const r = ys[i] - mu;
      g0 += r;
      g1 += r * xs[i];
      h00 += w;
      h01 += w * xs[i];
      h11 += w * xs[i] * xs[i];
    }
    const det = h00 * h11 - h01 * h01;
    if (!(det > 1e-12)) return NaN;
    const da = (h11 * g0 - h01 * g1) / det;
    const db = (h00 * g1 - h01 * g0) / det;
    a += da;
    b += db;
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b) > 1e3) {
      return NaN; // separação quase-completa: o MLE foge pro infinito
    }
    if (Math.abs(da) < 1e-10 && Math.abs(db) < 1e-10) return b;
  }
  return NaN;
}

// IC percentil por bootstrap da MÉDIA de `values` (reamostragem com reposição).
// Determinístico: PRNG mulberry32 semeado, então o mesmo dado dá o mesmo IC em todo
// render. null com < 2 valores (sem variância pra reamostrar).
export function bootstrapMeanCi(
  values: number[],
  level = 0.9,
  iterations = 2000,
  seed = 0x5eed,
): { lo: number; hi: number } | null {
  if (values.length < 2) return null;
  let state = seed >>> 0;
  const rand = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = values.length;
  const means = new Array<number>(iterations);
  for (let b = 0; b < iterations; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[Math.floor(rand() * n)];
    means[b] = sum / n;
  }
  means.sort((a, b) => a - b);
  const tail = (1 - level) / 2;
  const at = (q: number) =>
    means[Math.min(iterations - 1, Math.max(0, Math.floor(q * iterations)))];
  return { lo: at(tail), hi: at(1 - tail) };
}

export type CalibrationSummary = {
  n: number;
  brier: number;
  logLoss: number;
  slope: number; // calibrationSlope; NaN quando não identificável
  bins: ReliabilityBin[];
};

// Resumo completo de um forecaster sobre um conjunto de pares.
export function computeCalibration(
  pairs: CalibrationPair[],
  nBins = 10,
): CalibrationSummary {
  return {
    n: pairs.length,
    brier: brierScore(pairs),
    logLoss: logLoss(pairs),
    slope: calibrationSlope(pairs),
    bins: reliabilityBins(pairs, nBins),
  };
}
