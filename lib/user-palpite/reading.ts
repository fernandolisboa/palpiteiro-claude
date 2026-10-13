import {
  p1X2,
  pScoreline,
  scorelineMatrix,
  topScorelines,
  type ScorelineMatrix,
} from "@/lib/quant/scoreline-model";

import type {
  BridgeLeg,
  CheckedClaim,
  PalpiteReading,
  PalpiteResult,
  PalpiteVerdict,
  UserPalpite,
} from "./types";

// Leitura do palpite pelo modelo (#564). PURO e seguro no cliente (só lib/quant): o
// bloco "Seu palpite" refaz a matriz com o λ/ρ que o servidor serializou e lê na hora,
// sem round-trip; o servidor usa as MESMAS funções na análise gravada, então os números
// não divergem.

export type TeamNames = { home: string; away: string };

export type ReadingLambdas = {
  lambdaHome: number;
  lambdaAway: number;
  // null = DIXON_COLES_RHO pinado (mesma semântica de ModelScoreline.rho).
  rho: number | null;
};

export function readingMatrix(l: ReadingLambdas): ScorelineMatrix {
  return scorelineMatrix(
    l.lambdaHome,
    l.lambdaAway,
    l.rho === null ? undefined : { rho: l.rho },
  );
}

const TOP_SCORELINES = 5;
const TOP_WITHIN_RESULT = 3;

const pp = (p: number) => Math.round(p * 10000) / 100;

export function resultOf(p: UserPalpite): PalpiteResult {
  if (p.kind === "result") return p.selection;
  return p.home > p.away ? "home" : p.home === p.away ? "draw" : "away";
}

function resultOfScore(home: number, away: number): PalpiteResult {
  return home > away ? "home" : home === away ? "draw" : "away";
}

export function readPalpite(
  input: { matrix: ScorelineMatrix; lambdaHome: number; lambdaAway: number },
  p: UserPalpite,
): PalpiteReading {
  const { matrix } = input;
  const oneXTwoRaw = p1X2(matrix);
  const result = resultOf(p);
  const all = topScorelines(matrix, (matrix.maxGoals + 1) ** 2);
  const scoreRank =
    p.kind === "score" && p.home <= matrix.maxGoals && p.away <= matrix.maxGoals
      ? all.findIndex((c) => c.home === p.home && c.away === p.away) + 1
      : null;
  const palpiteRaw =
    p.kind === "score" ? pScoreline(matrix, p.home, p.away) : oneXTwoRaw[result];
  const cell = (c: { home: number; away: number; p: number }) => ({
    home: c.home,
    away: c.away,
    pct: pp(c.p),
  });
  return {
    palpitePct: pp(palpiteRaw),
    resultPct: pp(oneXTwoRaw[result]),
    scoreRank: scoreRank === 0 ? null : scoreRank,
    oneXTwo: {
      home: pp(oneXTwoRaw.home),
      draw: pp(oneXTwoRaw.draw),
      away: pp(oneXTwoRaw.away),
    },
    topScorelines: all.slice(0, TOP_SCORELINES).map(cell),
    topWithinResult: all
      .filter((c) => resultOfScore(c.home, c.away) === result)
      .slice(0, TOP_WITHIN_RESULT)
      .map(cell),
    lambdaHome: input.lambdaHome,
    lambdaAway: input.lambdaAway,
  };
}

/** "Flamengo 2 × 0 Palmeiras" | "Vitória do Flamengo" | "Empate". */
export function palpiteLabel(p: UserPalpite, teams: TeamNames): string {
  if (p.kind === "score") return `${teams.home} ${p.home} × ${p.away} ${teams.away}`;
  return resultLabel(p.selection, teams);
}

export function resultLabel(r: PalpiteResult, teams: TeamNames): string {
  if (r === "draw") return "Empate";
  return `Vitória do ${r === "home" ? teams.home : teams.away}`;
}

export function palpiteToLeg(p: UserPalpite): BridgeLeg {
  if (p.kind === "score") {
    return { kind: "exact_score", params: { home: p.home, away: p.away } };
  }
  return { kind: "match_result", params: { selection: p.selection } };
}

// ─── Veredito em código ─────────────────────────────────────────────────────

// Mudou faixa ou regra → bump (gravado em cada análise).
export const PALPITE_VERDICT_VERSION = "palpite_verdict_v1";
const AGREE_RESULT_PCT = 45;
const DISAGREE_RESULT_PCT = 25;
const AGREE_SCORE_RANK = 3;

function isFavorite(r: PalpiteReading, result: PalpiteResult): boolean {
  const { home, draw, away } = r.oneXTwo;
  const best = Math.max(home, draw, away);
  return r.oneXTwo[result] === best;
}

export function codeVerdict(
  r: PalpiteReading,
  p: UserPalpite,
  claims: readonly CheckedClaim[],
): PalpiteVerdict {
  const result = resultOf(p);
  let verdict: PalpiteVerdict;
  if (p.kind === "result") {
    verdict =
      r.palpitePct >= AGREE_RESULT_PCT || isFavorite(r, result)
        ? "concordo"
        : r.palpitePct < DISAGREE_RESULT_PCT
          ? "discordo"
          : "em_parte";
  } else {
    verdict =
      isFavorite(r, result) && r.scoreRank !== null && r.scoreRank <= AGREE_SCORE_RANK
        ? "concordo"
        : r.resultPct < DISAGREE_RESULT_PCT
          ? "discordo"
          : "em_parte";
  }
  if (verdict === "concordo" && claims.some((c) => c.status === "contradicted")) {
    return "em_parte";
  }
  return verdict;
}

// ─── Texto ──────────────────────────────────────────────────────────────────

/** "9,1%": percentual em PT-BR com 1 casa. */
export function ptPct(n: number): string {
  return `${n.toFixed(1).replace(".", ",")}%`;
}

/** "o 4º placar mais provável" (rank 1 → "o placar mais provável"). */
export function rankPhrase(rank: number): string {
  return rank === 1 ? "o placar mais provável" : `o ${rank}º placar mais provável`;
}

function resultChance(r: PalpiteResult, teams: TeamNames): string {
  if (r === "draw") return "o empate";
  return `a vitória do ${r === "home" ? teams.home : teams.away}`;
}

/** Uma frase em PT-BR com o que o modelo diz do palpite (só números da leitura). */
export function readingSentence(
  r: PalpiteReading,
  p: UserPalpite,
  teams: TeamNames,
): string {
  const result = resultOf(p);
  if (p.kind === "score") {
    const rank = r.scoreRank === null ? "" : `, ${rankPhrase(r.scoreRank)}`;
    return `Pelo modelo, ${p.home} × ${p.away} tem ${ptPct(r.palpitePct)}${rank}. ${capitalize(resultChance(result, teams))} tem ${ptPct(r.resultPct)}.`;
  }
  return `Pelo modelo, ${resultChance(result, teams)} tem ${ptPct(r.palpitePct)}.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
