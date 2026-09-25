import { bootstrapMeanCi } from "@/lib/calibration/metrics";
import { computeMarketImpliedProbabilities } from "@/lib/odds/implied-probability";

import { seasonGamesPlayed } from "./features";
import type { HistoricalMatch, Odds1x2 } from "./matches";

// Runner do backtest walk-forward (ADR 0039 D2, #502). Puro e síncrono: recebe os
// jogos já parseados e as estratégias, devolve métricas por estratégia e as
// diferenças pareadas. Compartilhado com a avaliação do JEV (estratégias Sonnet/JEV
// entram pela mesma interface; uma estratégia assíncrona pré-computa e devolve um
// lookup síncrono).

export type Probs1x2 = { home: number; draw: number; away: number };

export type StrategyOutput = {
  p1x2?: Probs1x2;
  pOver25?: number;
};

export type Strategy = {
  name: string;
  /**
   * `history` = SÓ jogos com data estritamente anterior ao jogo (point-in-time).
   * null = a estratégia não opina neste jogo (o jogo sai da comparação pareada
   * que a envolve, nunca é imputado).
   */
  predict(
    match: HistoricalMatch,
    history: readonly HistoricalMatch[],
  ): StrategyOutput | null;
};

export type BacktestOptions = {
  seasons: readonly number[]; // temporadas avaliadas (as anteriores só alimentam)
  minSeasonGames: number; // aquecimento: os DOIS times com ≥ N jogos na temporada
  ciLevel?: number;
};

type Outcome1x2 = "home" | "draw" | "away";

export type EvaluatedMatch = {
  match: HistoricalMatch;
  outcome: Outcome1x2;
  over25: 0 | 1;
  byStrategy: Record<string, StrategyOutput | null>;
};

export type MetricSummary = {
  n: number;
  logLoss: number;
  brier: number;
};

export type PairedDiff = {
  a: string;
  b: string;
  n: number;
  meanDiff: number; // média de (logLoss_a − logLoss_b) por jogo; < 0 ⇒ a melhor
  ci: { lo: number; hi: number } | null;
};

const EPS = 1e-15;
const clamp = (p: number) => Math.min(1 - EPS, Math.max(EPS, p));
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;

export function outcomeOf(m: HistoricalMatch): Outcome1x2 {
  if (m.homeGoals > m.awayGoals) return "home";
  if (m.homeGoals === m.awayGoals) return "draw";
  return "away";
}

export function logLoss1x2(p: Probs1x2, o: Outcome1x2): number {
  return -Math.log(clamp(p[o]));
}

export function brier1x2(p: Probs1x2, o: Outcome1x2): number {
  return (["home", "draw", "away"] as const).reduce(
    (s, k) => s + (p[k] - (k === o ? 1 : 0)) ** 2,
    0,
  );
}

export function logLossBinary(p: number, y: 0 | 1): number {
  const c = clamp(p);
  return -(y * Math.log(c) + (1 - y) * Math.log(1 - c));
}

/** Probabilidades de-vigadas (proporcional, ADR 0018) de uma trinca de odds. */
export function devig1x2(odds: Odds1x2): Probs1x2 {
  const [home, draw, away] = computeMarketImpliedProbabilities([
    odds.home,
    odds.draw,
    odds.away,
  ]).probs;
  return { home, draw, away };
}

/** Estratégia de benchmark: fechamento de-vigado (Pinnacle, senão média). */
export const closingMarketStrategy: Strategy = {
  name: "mercado (fechamento)",
  predict(match) {
    const odds = match.closingPinnacle ?? match.closingAvg;
    return odds ? { p1x2: devig1x2(odds) } : null;
  },
};

/**
 * Roda o walk-forward. Os jogos são avaliados em ordem de data; cada estratégia
 * vê só o histórico anterior ao dia do jogo. Só entram na avaliação os jogos de
 * `seasons` em que os dois times já passaram do aquecimento.
 */
export function runBacktest(
  matches: readonly HistoricalMatch[],
  strategies: readonly Strategy[],
  options: BacktestOptions,
): EvaluatedMatch[] {
  const seasons = new Set(options.seasons);
  const out: EvaluatedMatch[] = [];
  let cutoff = 0; // matches[0..cutoff) têm data < data do jogo corrente
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    while (
      cutoff < matches.length &&
      matches[cutoff].date.getTime() < m.date.getTime()
    ) {
      cutoff++;
    }
    if (!seasons.has(m.season)) continue;
    const history = matches.slice(0, cutoff);
    if (
      seasonGamesPlayed(history, m.home, m.season, m.date) <
        options.minSeasonGames ||
      seasonGamesPlayed(history, m.away, m.season, m.date) <
        options.minSeasonGames
    ) {
      continue;
    }
    const byStrategy: Record<string, StrategyOutput | null> = {};
    for (const s of strategies) byStrategy[s.name] = s.predict(m, history);
    out.push({
      match: m,
      outcome: outcomeOf(m),
      over25: m.homeGoals + m.awayGoals > 2.5 ? 1 : 0,
      byStrategy,
    });
  }
  return out;
}

export function summarize(
  evaluated: readonly EvaluatedMatch[],
  strategy: string,
  market: "1x2" | "over25",
): MetricSummary {
  const ll: number[] = [];
  const br: number[] = [];
  for (const e of evaluated) {
    const out = e.byStrategy[strategy];
    if (market === "1x2" && out?.p1x2) {
      ll.push(logLoss1x2(out.p1x2, e.outcome));
      br.push(brier1x2(out.p1x2, e.outcome));
    } else if (market === "over25" && out?.pOver25 !== undefined) {
      ll.push(logLossBinary(out.pOver25, e.over25));
      br.push((out.pOver25 - e.over25) ** 2);
    }
  }
  return { n: ll.length, logLoss: mean(ll), brier: mean(br) };
}

/** Diferença pareada de log-loss (a − b) nos jogos em que as DUAS opinam. */
export function pairedLogLossDiff(
  evaluated: readonly EvaluatedMatch[],
  a: string,
  b: string,
  market: "1x2" | "over25",
  ciLevel = 0.9,
): PairedDiff {
  const diffs: number[] = [];
  for (const e of evaluated) {
    const oa = e.byStrategy[a];
    const ob = e.byStrategy[b];
    if (market === "1x2" && oa?.p1x2 && ob?.p1x2) {
      diffs.push(
        logLoss1x2(oa.p1x2, e.outcome) - logLoss1x2(ob.p1x2, e.outcome),
      );
    } else if (
      market === "over25" &&
      oa?.pOver25 !== undefined &&
      ob?.pOver25 !== undefined
    ) {
      diffs.push(
        logLossBinary(oa.pOver25, e.over25) -
          logLossBinary(ob.pOver25, e.over25),
      );
    }
  }
  return {
    a,
    b,
    n: diffs.length,
    meanDiff: mean(diffs),
    ci: bootstrapMeanCi(diffs, ciLevel),
  };
}
