import type { NormalizedStanding } from "@/lib/providers/sports-data/types";

import type { HistoricalMatch } from "./matches";

// Features POINT-IN-TIME (ADR 0039 D2): tudo derivado SÓ de jogos com data
// ESTRITAMENTE anterior ao jogo avaliado — nunca do próprio dia (jogos simultâneos
// não se veem) nem do futuro. É a garantia anti-leakage do backtest.

type Split = {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
};

const emptySplit = (): Split => ({
  played: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  goalsFor: 0,
  goalsAgainst: 0,
});

function addResult(s: Split, gf: number, ga: number): void {
  s.played += 1;
  s.goalsFor += gf;
  s.goalsAgainst += ga;
  if (gf > ga) s.wins += 1;
  else if (gf === ga) s.draws += 1;
  else s.losses += 1;
}

/**
 * Tabela da temporada `season` com os jogos anteriores a `before`, no MESMO shape
 * que o provider entrega (`NormalizedStanding`, com homeSplit/awaySplit). Assim a
 * estratégia heurística roda o adapter de PRODUÇÃO (`computeMatchLambdas`) sem
 * nenhuma cópia da escada de degradação.
 */
export function pointInTimeStanding(
  history: readonly HistoricalMatch[],
  season: number,
  before: Date,
): NormalizedStanding {
  const home = new Map<string, Split>();
  const away = new Map<string, Split>();
  const get = (m: Map<string, Split>, team: string) => {
    let s = m.get(team);
    if (!s) {
      s = emptySplit();
      m.set(team, s);
    }
    return s;
  };

  for (const m of history) {
    if (m.season !== season || m.date.getTime() >= before.getTime()) continue;
    addResult(get(home, m.home), m.homeGoals, m.awayGoals);
    addResult(get(away, m.away), m.awayGoals, m.homeGoals);
  }

  const teams = [...new Set([...home.keys(), ...away.keys()])].map((team) => {
    const h = home.get(team) ?? emptySplit();
    const a = away.get(team) ?? emptySplit();
    const won = h.wins + a.wins;
    const draw = h.draws + a.draws;
    return {
      team,
      played: h.played + a.played,
      won,
      draw,
      lost: h.losses + a.losses,
      goalsFor: h.goalsFor + a.goalsFor,
      goalsAgainst: h.goalsAgainst + a.goalsAgainst,
      points: won * 3 + draw,
      homeSplit: h,
      awaySplit: a,
    };
  });
  teams.sort(
    (x, y) =>
      y.points - x.points ||
      y.goalsFor - y.goalsAgainst - (x.goalsFor - x.goalsAgainst) ||
      x.team.localeCompare(y.team),
  );

  return {
    league: "brasileirao_a",
    season,
    tables: [{ teams: teams.map((t, i) => ({ position: i + 1, ...t })) }],
  };
}

/** Jogos da temporada que `team` já disputou antes de `before`. */
export function seasonGamesPlayed(
  history: readonly HistoricalMatch[],
  team: string,
  season: number,
  before: Date,
): number {
  let n = 0;
  for (const m of history) {
    if (m.season !== season || m.date.getTime() >= before.getTime()) continue;
    if (m.home === team || m.away === team) n += 1;
  }
  return n;
}
