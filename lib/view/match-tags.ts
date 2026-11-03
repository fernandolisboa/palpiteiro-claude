import type { MatchModelProbabilities } from "@/lib/model-base/types";
import { MATCH_MODEL_MAX_AGE_MS } from "@/lib/model-base/version";

// Etiquetas de mesa de amigos (ADR 0070 §7, #656): cada uma é uma regra em código sobre
// um dado que o app já tem (placar, minuto ao vivo, base do modelo, confrontos), nunca
// texto do LLM. Puras e testadas em lib/view/__tests__/match-tags.test.ts.

/** Zebra e azarão: o modelo dava menos que isto (pp) pro resultado ou pro lado. */
export const LONGSHOT_MAX_PCT = 20;
/** Chocolate: vitória por pelo menos esta diferença de gols. */
export const CHOCOLATE_MIN_MARGIN = 3;
/** Reta final: do minuto 80 do 2º tempo em diante. */
export const RETA_FINAL_MINUTE = 80;
/** Freguesia: um lado venceu pelo menos 4 confrontos, de no mínimo 4 com placar. */
export const FREGUESIA_MIN_WINS = 4;

type Score = { home: number; away: number };
type Side = "home" | "away";
type MatchResultProbs = MatchModelProbabilities["match_result"];

export type MatchTagKey = "reta_final" | "zebra" | "chocolate" | "azarao";
export type MatchTagView = { key: MatchTagKey; label: string; title: string };

function resultOf(score: Score): "home" | "draw" | "away" {
  if (score.home > score.away) return "home";
  if (score.home < score.away) return "away";
  return "draw";
}

/**
 * A base serve pra julgar o resultado se foi conferida até 24h antes do apito (o mesmo
 * limite de idade da linha do /jogos). O cron só calcula jogo agendado e antes do apito,
 * então a última base de um jogo encerrado é a leitura de antes do jogo; uma base velha
 * (cron parado dias antes) não vira "zebra".
 */
export function modelFreshAtKickoff(checkedAt: Date, kickoffAt: Date): boolean {
  const gap = kickoffAt.getTime() - checkedAt.getTime();
  return gap >= 0 && gap <= MATCH_MODEL_MAX_AGE_MS;
}

/** Deu zebra: o resultado final tinha menos de 20% na base do modelo. */
export function isZebra(probs: MatchResultProbs, score: Score): boolean {
  return probs[resultOf(score)] < LONGSHOT_MAX_PCT;
}

/** Azarão antes do jogo: o lado com menos de 20% de vitória (o menor, se os dois). */
export function underdogSide(probs: MatchResultProbs): Side | null {
  const side: Side = probs.away < probs.home ? "away" : "home";
  return probs[side] < LONGSHOT_MAX_PCT ? side : null;
}

/** Chocolate: vitória por 3 gols ou mais. */
export function isChocolate(score: Score): boolean {
  return Math.abs(score.home - score.away) >= CHOCOLATE_MIN_MARGIN;
}

/**
 * Reta final: 2º tempo, minuto 80 em diante. Prorrogação, intervalo e minuto
 * desconhecido ficam de fora (o 90+ conta: `elapsed` da API-Football é 90 lá).
 */
export function isRetaFinal(state: { statusShort: string | null; elapsed: number | null }): boolean {
  return state.statusShort === "2H" && state.elapsed !== null && state.elapsed >= RETA_FINAL_MINUTE;
}

/**
 * As etiquetas de uma linha de jogo, na ordem da tela. Cada insumo só vem quando vale:
 * `live` com o estado ao vivo fresco, `finalScore` só em jogo encerrado, `resultModel`
 * só com a base fresca no apito, `pregameModel` só em jogo analisável com base fresca.
 */
export function matchRowTags(input: {
  teams: { home: string; away: string };
  live?: { statusShort: string | null; elapsed: number | null } | null;
  finalScore?: Score | null;
  resultModel?: MatchResultProbs | null;
  pregameModel?: MatchResultProbs | null;
}): MatchTagView[] {
  const tags: MatchTagView[] = [];
  if (input.live && isRetaFinal(input.live)) {
    tags.push({ key: "reta_final", label: "reta final", title: "Do minuto 80 em diante" });
  }
  const score = input.finalScore;
  if (score) {
    if (input.resultModel && isZebra(input.resultModel, score)) {
      tags.push({
        key: "zebra",
        label: "deu zebra",
        title: `O modelo dava menos de ${LONGSHOT_MAX_PCT}% pra esse resultado`,
      });
    }
    if (isChocolate(score)) {
      tags.push({
        key: "chocolate",
        label: "chocolate",
        title: `Vitória por ${CHOCOLATE_MIN_MARGIN} gols ou mais`,
      });
    }
  }
  if (input.pregameModel) {
    const side = underdogSide(input.pregameModel);
    if (side) {
      const team = input.teams[side];
      tags.push({
        key: "azarao",
        label: `azarão: ${team}`,
        title: `O modelo dá menos de ${LONGSHOT_MAX_PCT}% de chance de vitória pro ${team}`,
      });
    }
  }
  return tags;
}

/**
 * Placar exato depois do jogo: "cravou" quando acertou, "na trave" quando errou por um
 * gol só (2 × 1 num 2 × 2). Nunca antes do resultado, nunca junto de convite pra
 * apostar de novo (ADR 0070).
 */
export function exactScoreQuip(guess: Score, actual: Score): "cravou" | "na_trave" | null {
  const distance = Math.abs(guess.home - actual.home) + Math.abs(guess.away - actual.away);
  if (distance === 0) return "cravou";
  if (distance === 1) return "na_trave";
  return null;
}

export const EXACT_SCORE_QUIP_TEXT = {
  cravou: "Cravou o placar.",
  na_trave: "Ficou na trave.",
} as const;

/** Lê `{home, away}` inteiros de params/resultData jsonb; null se não tiver os dois. */
export function readScore(raw: unknown): Score | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const home = "home" in r ? r.home : r.homeScore;
  const away = "away" in r ? r.away : r.awayScore;
  return Number.isInteger(home) && Number.isInteger(away)
    ? { home: home as number, away: away as number }
    : null;
}

/**
 * Linha do placar exato decidido em Suas apostas: "Cravou o placar." no acerto e "Ficou
 * na trave." no erro por um gol (contra o placar da liquidação, `resultData`). O selo
 * continua sendo o dado; outro tipo de aposta, pendente ou sem placar: null.
 */
export function exactScoreLegQuip(leg: {
  kind: string;
  params: unknown;
  outcome: { result: string; resultData?: unknown } | null;
}): string | null {
  if (leg.kind !== "exact_score" || !leg.outcome) return null;
  if (leg.outcome.result === "won") return EXACT_SCORE_QUIP_TEXT.cravou;
  if (leg.outcome.result !== "lost") return null;
  const guess = readScore(leg.params);
  const actual = readScore(leg.outcome.resultData);
  return guess && actual && exactScoreQuip(guess, actual) === "na_trave"
    ? EXACT_SCORE_QUIP_TEXT.na_trave
    : null;
}

/** O mesmo pro chute de placar exato no bolão, contra o placar que decidiu o bolão. */
export function poolEntryQuip(kind: string, params: unknown, score: Score): string | null {
  if (kind !== "exact_score") return null;
  const guess = readScore(params);
  const quip = guess ? exactScoreQuip(guess, score) : null;
  return quip ? EXACT_SCORE_QUIP_TEXT[quip] : null;
}

export type FreguesiaStreak = { team: string; wins: number; played: number };

/**
 * Freguesia nos confrontos: um time venceu pelo menos 4 dos últimos confrontos com placar
 * (de no mínimo 4). `rows` já vem do mais recente pro mais antigo e cortado no limite.
 */
export function freguesiaStreak(
  rows: ReadonlyArray<{ homeTeam: string; awayTeam: string; home: number; away: number }>,
): FreguesiaStreak | null {
  if (rows.length < FREGUESIA_MIN_WINS) return null;
  const wins = new Map<string, number>();
  for (const r of rows) {
    if (r.home === r.away) continue;
    const winner = r.home > r.away ? r.homeTeam : r.awayTeam;
    wins.set(winner, (wins.get(winner) ?? 0) + 1);
  }
  for (const [team, n] of wins) {
    if (n >= FREGUESIA_MIN_WINS) return { team, wins: n, played: rows.length };
  }
  return null;
}

/** "Freguesia: Palmeiras venceu 4 dos últimos 5 confrontos." / "…venceu os últimos 5 confrontos." */
export function freguesiaLine(streak: FreguesiaStreak): string {
  return streak.wins === streak.played
    ? `Freguesia: ${streak.team} venceu os últimos ${streak.played} confrontos.`
    : `Freguesia: ${streak.team} venceu ${streak.wins} dos últimos ${streak.played} confrontos.`;
}

/** Bolão sem ganhador: "Deu zebra" só quando o resultado era improvável pro modelo. */
export function poolNoWinnerLine(zebra: boolean): string {
  return zebra ? "Deu zebra: ninguém acertou." : "Ninguém acertou dessa vez.";
}
