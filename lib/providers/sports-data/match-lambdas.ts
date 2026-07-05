import {
  estimateLambdas,
  poolSplitRates,
  type SplitGoalRates,
} from "@/lib/quant/scoreline-model";

import type { NormalizedStanding, NormalizedStandingTeam } from "./types";

// Adapter de FRONTEIRA `NormalizedStanding → λ` (ADR 0037, promovido de
// lib/bets/grade-scoreline.ts). É a estatística DERIVADA da tabela do provider que
// alimenta o modelo puro `lib/quant` — vive aqui (provider-adjacent, ao lado de
// NormalizedStanding) pra ser compartilhado pelos DOIS consumidores (aposta livre +
// análise de mercado no predict.ts step-6) sem duplicar a escada de degradação, e
// SEM furar a pureza de `lib/quant` (que nunca importa tipos de provider — 0036
// Decisão 9 / Alternativa 10). Determinístico e testável (recebe a standing pronta).

function findTeamRow(
  standing: NormalizedStanding,
  team: string,
): NormalizedStandingTeam | undefined {
  for (const table of standing.tables) {
    const row = table.teams.find((t) => t.team === team);
    if (row) return row;
  }
  return undefined;
}

function toSplitRates(
  split: { played: number; goalsFor: number; goalsAgainst: number } | undefined,
): SplitGoalRates | null {
  if (!split) return null;
  return {
    played: split.played,
    goalsFor: split.goalsFor,
    goalsAgainst: split.goalsAgainst,
  };
}

// Média de gols por time-jogo da liga: Σ goalsFor / Σ played das colunas OVERALL de
// TODAS as linhas de TODOS os grupos. NaN/0 → tabela degenerada → caller guarda (B1).
function leagueAvgGoalsPerTeam(standing: NormalizedStanding): number {
  let goals = 0;
  let played = 0;
  for (const table of standing.tables) {
    for (const t of table.teams) {
      goals += t.goalsFor;
      played += t.played;
    }
  }
  return goals / played;
}

export type MatchLambdas = {
  lambdaHome: number;
  lambdaAway: number;
  degradedData: boolean;
};

// Estima os λ do jogo da tabela (com a escada de degradação + guard B1). null =
// standings indisponível/degenerado → "não avalio" (prefer-skip, NUNCA λ fabricado).
export function computeMatchLambdas(args: {
  standing: NormalizedStanding | undefined;
  homeTeam: string;
  awayTeam: string;
  neutral: boolean;
}): MatchLambdas | null {
  const { standing, homeTeam, awayTeam, neutral } = args;
  if (!standing) return null;

  const leagueAvg = leagueAvgGoalsPerTeam(standing);
  if (!Number.isFinite(leagueAvg) || leagueAvg <= 0) return null;

  const homeRow = findTeamRow(standing, homeTeam);
  const awayRow = findTeamRow(standing, awayTeam);

  // Jogo normal → fatia CASA do mandante × fatia FORA do visitante; mando neutro →
  // pool casa+fora de CADA time (poolSplitRates POR TIME, nunca cruzando os times).
  const homeRates = neutral
    ? poolSplitRates(
        toSplitRates(homeRow?.homeSplit),
        toSplitRates(homeRow?.awaySplit),
      )
    : toSplitRates(homeRow?.homeSplit);
  const awayRates = neutral
    ? poolSplitRates(
        toSplitRates(awayRow?.homeSplit),
        toSplitRates(awayRow?.awaySplit),
      )
    : toSplitRates(awayRow?.awaySplit);

  const { lambdaHome, lambdaAway, meta } = estimateLambdas({
    home: homeRates,
    away: awayRates,
    leagueAvgGoalsPerTeam: leagueAvg,
  });
  return {
    lambdaHome,
    lambdaAway,
    degradedData: meta.source === "prior",
  };
}
