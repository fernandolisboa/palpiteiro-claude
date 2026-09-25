import { computeMatchLambdas } from "@/lib/providers/sports-data/match-lambdas";
import {
  dixonColesLambdas,
  fitDixonColes,
  type DixonColesModel,
  type DixonColesOptions,
} from "@/lib/quant/dixon-coles";
import { p1X2, pOverUnder, scorelineMatrix } from "@/lib/quant/scoreline-model";

import { pointInTimeStanding } from "./features";
import type { HistoricalMatch } from "./matches";
import type { Strategy, StrategyOutput } from "./runner";

function fromLambdas(
  lambdaHome: number,
  lambdaAway: number,
  rho?: number,
): StrategyOutput {
  const matrix = scorelineMatrix(lambdaHome, lambdaAway, { rho });
  return { p1x2: p1X2(matrix), pOver25: pOverUnder(matrix, 2.5) };
}

/**
 * O λ de PRODUÇÃO hoje (ADR 0036/0037): standings da temporada até o dia anterior →
 * `computeMatchLambdas` (a escada de degradação real) → matriz com ρ fixo.
 */
export const heuristicStrategy: Strategy = {
  name: "heurístico (Maher + shrinkage)",
  predict(match, history) {
    const standing = pointInTimeStanding(history, match.season, match.date);
    const l = computeMatchLambdas({
      standing,
      homeTeam: match.home,
      awayTeam: match.away,
      neutral: false,
    });
    return l ? fromLambdas(l.lambdaHome, l.lambdaAway) : null;
  },
};

/**
 * Dixon-Coles MLE refitado a cada DIA de jogo com o histórico anterior (cache por
 * dia: todos os jogos do mesmo dia usam o mesmo ajuste, como um refit diário em
 * produção). Time sem histórico na janela → null (sai do par, não é imputado).
 */
export function dixonColesStrategy(
  options: DixonColesOptions = {},
  name = "Dixon-Coles MLE",
): Strategy {
  let cachedDay = -1;
  let cached: DixonColesModel | null = null;
  return {
    name,
    predict(match: HistoricalMatch, history: readonly HistoricalMatch[]) {
      const day = match.date.getTime();
      if (day !== cachedDay) {
        cached = fitDixonColes(history, match.date, options);
        cachedDay = day;
      }
      if (!cached) return null;
      const l = dixonColesLambdas(cached, match.home, match.away);
      return l ? fromLambdas(l.lambdaHome, l.lambdaAway, cached.rho) : null;
    },
  };
}

/**
 * Baseline climatológico: P(over 2.5) = fração de overs nos jogos dos últimos
 * `days` dias; 1X2 = frequências de casa/empate/fora na mesma janela. Um modelo
 * que não bate isto não está usando informação dos times.
 */
export function baseRateStrategy(days = 365): Strategy {
  return {
    name: "taxa-base (últimos 12 meses)",
    predict(match, history) {
      const since = match.date.getTime() - days * 86_400_000;
      let n = 0;
      let over = 0;
      let home = 0;
      let draw = 0;
      for (const m of history) {
        if (m.date.getTime() < since) continue;
        n += 1;
        if (m.homeGoals + m.awayGoals > 2.5) over += 1;
        if (m.homeGoals > m.awayGoals) home += 1;
        else if (m.homeGoals === m.awayGoals) draw += 1;
      }
      if (n === 0) return null;
      return {
        pOver25: over / n,
        p1x2: { home: home / n, draw: draw / n, away: (n - home - draw) / n },
      };
    },
  };
}
