import type {
  NormalizedStanding,
  NormalizedStandingTeam,
} from "@/lib/providers/sports-data/types";
import {
  estimateLambdas,
  poolSplitRates,
  pScoreline,
  scorelineMatrix,
  type SplitGoalRates,
} from "@/lib/quant/scoreline-model";

// Adapter do CAMINHO B pra placar exato (ADR 0036, Decisão 3). Vive na fronteira do
// CONSUMIDOR (não em lib/quant, que é puro/consumer-agnóstico): mapeia a tabela do
// provider pros tipos estruturais do modelo, computa a média da liga das colunas
// OVERALL e chama o double-Poisson. Determinístico e testável (recebe a standing
// pronta) — a action injeta o resultado de getStandings.

export type ExactScoreGrade =
  | { status: "graded"; modelProbPct: number; degradedData: boolean }
  // Standings indisponível OU degenerado (Σ played = 0) → "não avalio" (prefer-skip,
  // NUNCA λ fabricado — guarda B1). O motivo é setado pela action.
  | { status: "no_data" };

// Acha a linha do time varrendo TODOS os grupos/tabelas (CL fase de grupos tem N
// tabelas). Match exato por nome (mesma origem de provider — espelha findStanding).
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
// TODAS as linhas de TODOS os grupos (Decisão 3 — dos overall, não dos splits, pra
// continuar computável quando os splits faltam na tabela inteira). NaN/0 sinaliza
// tabela degenerada (rodada 1, pré-Copa) → o caller guarda (B1).
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

export function gradeExactScoreFromStandings(args: {
  standing: NormalizedStanding | undefined;
  homeTeam: string;
  awayTeam: string;
  home: number;
  away: number;
  neutral: boolean;
}): ExactScoreGrade {
  const { standing, homeTeam, awayTeam, home, away, neutral } = args;

  // (iii) standings indisponível → não avalio.
  if (!standing) return { status: "no_data" };

  const leagueAvg = leagueAvgGoalsPerTeam(standing);
  // Guarda B1: tabela degenerada (Σ played = 0 → NaN/Infinity) → não avalio, NUNCA λ
  // fabricado. `estimateLambdas` divide por leagueAvg — deixar passar envenenaria tudo.
  if (!Number.isFinite(leagueAvg) || leagueAvg <= 0) {
    return { status: "no_data" };
  }

  const homeRow = findTeamRow(standing, homeTeam);
  const awayRow = findTeamRow(standing, awayTeam);

  // Resolve as taxas por time NA FRONTEIRA (Decisão 3): jogo normal → fatia CASA do
  // mandante × fatia FORA do visitante (vantagem de mando); mando neutro (Copa) → o
  // pool casa+fora de CADA time (poolSplitRates POR TIME — nunca cruzando os times).
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

  const matrix = scorelineMatrix(lambdaHome, lambdaAway);
  const prob = pScoreline(matrix, home, away);

  return {
    status: "graded",
    modelProbPct: prob * 100,
    degradedData: meta.source === "prior",
  };
}
