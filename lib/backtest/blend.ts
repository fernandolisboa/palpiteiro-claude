import type { EvaluatedMatch, Probs1x2, StrategyOutput } from "./runner";

// Mistura modelo + mercado (trilha de calibração, report 13). Pool log-linear:
//   p_i ∝ modelo_i^w · mercado_i^(1−w)
// No binário (over 2.5) isso é exatamente logit(p) = w·logit(modelo) + (1−w)·logit(mercado);
// no 1X2 é a generalização multinomial (softmax da média ponderada dos logs). Um
// parâmetro só, w ∈ [0, 1]: w = 1 é o modelo puro, w = 0 o mercado puro. O log-loss
// do pool é convexo em w (log-sum-exp de funções lineares em w), então a busca em
// grade acha o ótimo global.

const EPS = 1e-12;
const lg = (p: number) => Math.log(Math.min(1 - EPS, Math.max(EPS, p)));

export function pool1x2(
  model: Probs1x2,
  market: Probs1x2,
  w: number,
): Probs1x2 {
  const keys = ["home", "draw", "away"] as const;
  const logits = keys.map((k) => w * lg(model[k]) + (1 - w) * lg(market[k]));
  const max = Math.max(...logits);
  const e = logits.map((l) => Math.exp(l - max));
  const s = e.reduce((a, b) => a + b, 0);
  return { home: e[0] / s, draw: e[1] / s, away: e[2] / s };
}

export function poolBinary(model: number, market: number, w: number): number {
  const logit = (p: number) => lg(p) - lg(1 - p);
  const z = w * logit(model) + (1 - w) * logit(market);
  return 1 / (1 + Math.exp(-z));
}

export type BlendMarket = "1x2" | "over25";

type Pair = {
  model: StrategyOutput;
  market: StrategyOutput;
  row: EvaluatedMatch;
};

function pairsOf(
  rows: readonly EvaluatedMatch[],
  modelName: string,
  marketName: string,
  market: BlendMarket,
): Pair[] {
  const out: Pair[] = [];
  for (const row of rows) {
    const model = row.byStrategy[modelName];
    const mkt = row.byStrategy[marketName];
    if (!model || !mkt) continue;
    if (
      market === "1x2"
        ? model.p1x2 && mkt.p1x2
        : model.pOver25 !== undefined && mkt.pOver25 !== undefined
    ) {
      out.push({ model, market: mkt, row });
    }
  }
  return out;
}

function pairLogLoss(pair: Pair, market: BlendMarket, w: number): number {
  if (market === "1x2") {
    const p = pool1x2(pair.model.p1x2!, pair.market.p1x2!, w);
    return -lg(p[pair.row.outcome]);
  }
  const p = poolBinary(pair.model.pOver25!, pair.market.pOver25!, w);
  return pair.row.over25 ? -lg(p) : -lg(1 - p);
}

/** Log-loss médio do pool com peso `w` nas linhas com par modelo+mercado. */
export function blendLogLoss(
  rows: readonly EvaluatedMatch[],
  modelName: string,
  marketName: string,
  market: BlendMarket,
  w: number,
): number {
  const pairs = pairsOf(rows, modelName, marketName, market);
  let loss = 0;
  for (const pair of pairs) loss += pairLogLoss(pair, market, w);
  return pairs.length ? loss / pairs.length : NaN;
}

/**
 * Peso w que minimiza o log-loss médio do pool em `rows` (grade de `step` em
 * `range`, por padrão [0, 1]). null quando não há par modelo+mercado.
 */
export function fitBlendWeight(
  rows: readonly EvaluatedMatch[],
  modelName: string,
  marketName: string,
  market: BlendMarket,
  step = 0.005,
  range: readonly [number, number] = [0, 1],
): number | null {
  const pairs = pairsOf(rows, modelName, marketName, market);
  if (pairs.length === 0) return null;
  const [lo, hi] = range;
  let best = lo;
  let bestLoss = Infinity;
  for (let i = 0; i <= Math.round((hi - lo) / step); i++) {
    const w = lo + i * step;
    let loss = 0;
    for (const pair of pairs) loss += pairLogLoss(pair, market, w);
    if (loss < bestLoss - 1e-12) {
      bestLoss = loss;
      best = w;
    }
  }
  return best;
}

export type WalkForwardBlend = {
  rows: EvaluatedMatch[]; // as mesmas linhas, com a estratégia `name` adicionada
  // temporada → w usado em cada mercado (ajustado SÓ em temporadas anteriores)
  weights: Record<number, Record<BlendMarket, number | null>>;
};

/**
 * Walk-forward por temporada: o peso da temporada s é ajustado só nas linhas de
 * temporadas < s jogadas antes do primeiro jogo de s (janela expansível) e
 * aplicado às linhas de s. Temporada sem
 * histórico de ajuste fica sem a estratégia (null), nunca com peso imputado.
 * `fitRows` permite ajustar em outro conjunto (ex.: as três ligas juntas, pra um
 * peso global) e aplicar nas linhas desta liga.
 */
export function walkForwardBlend(
  rows: readonly EvaluatedMatch[],
  opts: {
    name: string;
    model: string;
    market: string;
    fitRows?: readonly EvaluatedMatch[];
  },
): WalkForwardBlend {
  const fitRows = opts.fitRows ?? rows;
  const seasons = [...new Set(rows.map((r) => r.match.season))].sort();
  const weights: Record<number, Record<BlendMarket, number | null>> = {};
  for (const s of seasons) {
    // Corte por DATA, não por número de temporada: no ajuste global as ligas têm
    // calendários diferentes (a temporada 2023 europeia vai até maio de 2024).
    const start = Math.min(
      ...rows
        .filter((r) => r.match.season === s)
        .map((r) => r.match.date.getTime()),
    );
    const prior = fitRows.filter(
      (r) => r.match.season < s && r.match.date.getTime() < start,
    );
    weights[s] = {
      "1x2": fitBlendWeight(prior, opts.model, opts.market, "1x2"),
      over25: fitBlendWeight(prior, opts.model, opts.market, "over25"),
    };
  }
  const out = rows.map((row) => {
    const w = weights[row.match.season];
    const model = row.byStrategy[opts.model];
    const mkt = row.byStrategy[opts.market];
    let blended: StrategyOutput | null = null;
    if (model && mkt) {
      const o: StrategyOutput = {};
      if (w["1x2"] !== null && model.p1x2 && mkt.p1x2) {
        o.p1x2 = pool1x2(model.p1x2, mkt.p1x2, w["1x2"]);
      }
      if (
        w.over25 !== null &&
        model.pOver25 !== undefined &&
        mkt.pOver25 !== undefined
      ) {
        o.pOver25 = poolBinary(model.pOver25, mkt.pOver25, w.over25);
      }
      blended = o.p1x2 || o.pOver25 !== undefined ? o : null;
    }
    return { ...row, byStrategy: { ...row.byStrategy, [opts.name]: blended } };
  });
  return { rows: out, weights };
}
