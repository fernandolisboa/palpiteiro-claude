import type { BetLegParams } from "@/db/schema";
import type {
  NormalizedStanding,
  NormalizedStandingTeam,
} from "@/lib/providers/sports-data/types";
import {
  estimateLambdas,
  firstHalfScorelineMatrix,
  firstToScoreProbs,
  p1X2,
  pBtts,
  pCleanSheet,
  pMarginAtLeast,
  pOverUnder,
  poolSplitRates,
  pScoreline,
  scorelineMatrix,
  type ScorelineMatrix,
  type SplitGoalRates,
} from "@/lib/quant/scoreline-model";

// Engine do CAMINHO B (ADR 0036, Decisão 3): precifica QUALQUER predicado de placar
// pelo modelo double-Poisson. Vive na fronteira do CONSUMIDOR (lib/quant é puro):
// mapeia a tabela do provider pros tipos do modelo, guarda o caso degenerado (B1), e
// roteia o kind pro reader certo. Determinístico e testável (recebe a standing pronta).

// Kinds que o CAMINHO B precifica (props sempre + kinds de mercado quando falham o
// gate). cards/corners NÃO entram (Decisão 3: none).
export type ScorelineKind =
  | "exact_score"
  | "margin"
  | "clean_sheet"
  | "first_half_score"
  | "first_half_over_under"
  | "first_to_score"
  | "over_under"
  | "match_result"
  | "btts"
  | "double_chance";

export type ScorelineGrade =
  | { status: "graded"; modelProbPct: number; degradedData: boolean }
  | { status: "no_data" };

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

type MatchLambdas = {
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

// Preço (0-1) de um kind sobre os λ do jogo. Full matrix + (lazy) matriz de 1º tempo
// via time-share κ. Params já validado pelo boundary (defense-in-depth: switch fechado).
function priceLeg(
  lambdas: MatchLambdas,
  kind: ScorelineKind,
  params: BetLegParams,
  fullMatrix: ScorelineMatrix,
): number {
  const p = params as Record<string, unknown>;
  switch (kind) {
    case "exact_score":
      return pScoreline(fullMatrix, Number(p.home), Number(p.away));
    case "margin":
      return pMarginAtLeast(
        fullMatrix,
        p.side as "home" | "away",
        Number(p.minMargin),
      );
    case "clean_sheet":
      return pCleanSheet(fullMatrix, p.side as "home" | "away");
    case "over_under": {
      const over = pOverUnder(fullMatrix, Number(p.line));
      return p.selection === "over" ? over : 1 - over;
    }
    case "match_result": {
      const r = p1X2(fullMatrix);
      return r[p.selection as "home" | "draw" | "away"];
    }
    case "btts": {
      const yes = pBtts(fullMatrix);
      return p.selection === "yes" ? yes : 1 - yes;
    }
    case "double_chance": {
      const r = p1X2(fullMatrix);
      const sel = p.selection as "home_draw" | "home_away" | "draw_away";
      if (sel === "home_draw") return r.home + r.draw;
      if (sel === "home_away") return r.home + r.away;
      return r.draw + r.away;
    }
    case "first_half_score": {
      const fh = firstHalfScorelineMatrix(lambdas.lambdaHome, lambdas.lambdaAway);
      return pScoreline(fh, Number(p.home), Number(p.away));
    }
    case "first_half_over_under": {
      const fh = firstHalfScorelineMatrix(lambdas.lambdaHome, lambdas.lambdaAway);
      const over = pOverUnder(fh, Number(p.line));
      return p.selection === "over" ? over : 1 - over;
    }
    case "first_to_score": {
      const fts = firstToScoreProbs(lambdas.lambdaHome, lambdas.lambdaAway);
      return fts[p.firstToScore as "home" | "away" | "none"];
    }
  }
}

export function gradeScorelineLeg(args: {
  standing: NormalizedStanding | undefined;
  homeTeam: string;
  awayTeam: string;
  neutral: boolean;
  kind: ScorelineKind;
  params: BetLegParams;
}): ScorelineGrade {
  const lambdas = computeMatchLambdas(args);
  if (lambdas === null) return { status: "no_data" };

  const fullMatrix = scorelineMatrix(lambdas.lambdaHome, lambdas.lambdaAway);
  const prob = priceLeg(lambdas, args.kind, args.params, fullMatrix);
  return {
    status: "graded",
    modelProbPct: prob * 100,
    degradedData: lambdas.degradedData,
  };
}
