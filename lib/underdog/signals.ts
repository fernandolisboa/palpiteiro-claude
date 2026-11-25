import type { JudgmentAnswers, JudgmentQuestionId } from "@/lib/ai/judgments/types";
import { newsFactorOrigins } from "@/lib/match-news/apply";
import { isUnsafeNewsTitle, safeGeArticleUrl } from "@/lib/match-news/labels";
import type { MatchModelNews } from "@/lib/match-news/types";
import { claimEffect } from "@/lib/user-palpite/evidence";
import type {
  NormalizedFixture,
  NormalizedH2H,
} from "@/lib/providers/sports-data/types";

import {
  ABSENCES_MIN_FAVORITE,
  FORM_LAST,
  H2H_LAST,
  H2H_MIN_UNDERDOG_WINS,
  JEV_SIGNAL_MIN,
} from "./constants";
import type {
  FormResult,
  JevSignalFactor,
  UnderdogSide,
  UnderdogSignal,
} from "./types";

// Sinais a favor do azarão (#671, ADR 0073 §3), puros sobre dados já buscados. Cada
// fonte que faltou (null = provider falhou) só tira o próprio sinal. As contagens são
// funções pequenas daqui, sem tocar no cartucho palpites_v13.

const other = (s: UnderdogSide): UnderdogSide =>
  s === "home" ? "away" : "home";

// Do mais recente ao mais antigo, sem depender da ordem do provider.
const recentFirst = <T extends { kickoffAt: string }>(xs: T[]): T[] =>
  [...xs].sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt));

/** V/E/D de um time nos últimos `last` jogos com placar, do mais recente ao mais antigo. */
export function formResults(
  team: string,
  fixtures: NormalizedFixture[],
  last: number = FORM_LAST
): FormResult[] {
  const out: FormResult[] = [];
  for (const fx of recentFirst(fixtures)) {
    if (out.length >= last) break;
    const isHome = fx.homeTeam === team;
    const gf = isHome ? fx.score.home : fx.score.away;
    const ga = isHome ? fx.score.away : fx.score.home;
    if (gf === null || ga === null) continue;
    out.push(gf > ga ? "W" : gf < ga ? "L" : "D");
  }
  return out;
}

export const formPoints = (r: FormResult[]) =>
  r.reduce((acc, x) => acc + (x === "W" ? 3 : x === "D" ? 1 : 0), 0);

/** Vitórias de cada time nos últimos `last` confrontos com placar. */
export function h2hTally(
  team: string,
  opponent: string,
  h2h: NormalizedH2H[],
  last: number = H2H_LAST
): { games: number; wins: number; losses: number } {
  let games = 0;
  let wins = 0;
  let losses = 0;
  for (const m of recentFirst(h2h)) {
    if (games >= last) break;
    const { home, away } = m.score;
    if (home === null || away === null) continue;
    const teamIsHome = m.homeTeam === team;
    if (!teamIsHome && m.awayTeam !== team) continue;
    if (teamIsHome ? m.awayTeam !== opponent : m.homeTeam !== opponent)
      continue;
    games += 1;
    const gf = teamIsHome ? home : away;
    const ga = teamIsHome ? away : home;
    if (gf > ga) wins += 1;
    else if (gf < ga) losses += 1;
  }
  return { games, wins, losses };
}

export type SignalInputs = {
  side: UnderdogSide;
  // Nomes CANÔNICOS do jogo (os do provider), nunca os de exibição.
  teams: { home: string; away: string };
  form: { home: NormalizedFixture[]; away: NormalizedFixture[] } | null;
  h2h: NormalizedH2H[] | null;
  absences: { home: number; away: number } | null;
};

/** Sinais do JEV da base (sem chamada nova): o fator já está na chance. */
export function jevSignals(
  side: UnderdogSide,
  answers: JudgmentAnswers | null
): UnderdogSignal[] {
  if (answers === null) return [];
  const fav = other(side);
  const checks: [JevSignalFactor, UnderdogSide][] = [
    ["attack_weakened", fav],
    ["defense_weakened", fav],
    ["rotation_risk", fav],
    ["high_stakes", side],
  ];
  return checks.flatMap(([factor, who]) => {
    const v = answers[`${factor}_${who}`]?.value;
    return typeof v === "number" && Number.isFinite(v) && v >= JEV_SIGNAL_MIN
      ? [{ kind: "jev" as const, factor }]
      : [];
  });
}

/**
 * Sinais das notícias da base (#672, sem chamada nova): só os fatores que a NOTÍCIA moveu
 * acima do JEV a favor do azarão (ataque, defesa e rodízio do favorito; peso do jogo do
 * azarão). Já estão na chance. A matéria citada é a 1ª fonte de uma afirmação que moveu
 * o fator; o título só passa sem nome de casa de aposta e sem linguagem de valor.
 */
export function newsSignals(
  side: UnderdogSide,
  news: MatchModelNews | null | undefined,
  jev: JudgmentAnswers | null
): UnderdogSignal[] {
  if (!news) return [];
  const origins = newsFactorOrigins(news.claims, jev);
  const fav = other(side);
  const checks: [JevSignalFactor, UnderdogSide][] = [
    ["attack_weakened", fav],
    ["defense_weakened", fav],
    ["rotation_risk", fav],
    ["high_stakes", side],
  ];
  return checks.flatMap(([factor, who]) => {
    const id: JudgmentQuestionId = `${factor}_${who}`;
    const strength = origins[id];
    if (!strength) return [];
    const ref = news.claims
      .filter((c) => claimEffect(c, jev).moved.includes(id))
      .flatMap((c) => c.sources)[0];
    const source = news.sources.find((s) => s.ref === ref);
    const url = source ? safeGeArticleUrl(source.url) : null;
    const title =
      source && url && !isUnsafeNewsTitle(source.title)
        ? source.title.replace(/\s+/g, " ").trim().slice(0, 300) || null
        : null;
    return [
      {
        kind: "news" as const,
        factor,
        strength,
        ref: ref ?? "",
        url,
        title,
      },
    ];
  });
}

/** Sinais de dado (confronto, forma, desfalques); os do JEV saem de jevSignals. */
export function dataSignals(input: SignalInputs): UnderdogSignal[] {
  const { side } = input;
  const fav = other(side);
  const dogTeam = input.teams[side];
  const favTeam = input.teams[fav];
  const out: UnderdogSignal[] = [];

  if (input.h2h) {
    const t = h2hTally(dogTeam, favTeam, input.h2h);
    if (t.games > 0 && t.wins >= H2H_MIN_UNDERDOG_WINS && t.wins >= t.losses) {
      out.push({
        kind: "h2h",
        games: t.games,
        underdogWins: t.wins,
        favoriteWins: t.losses,
      });
    }
  }

  if (input.form) {
    const dog = formResults(dogTeam, input.form[side]);
    const favForm = formResults(favTeam, input.form[fav]);
    if (
      dog.length > 0 &&
      favForm.length > 0 &&
      formPoints(dog) >= formPoints(favForm)
    ) {
      out.push({ kind: "form", underdog: dog, favorite: favForm });
    }
  }

  if (input.absences) {
    const favCount = input.absences[fav];
    const dogCount = input.absences[side];
    if (favCount >= ABSENCES_MIN_FAVORITE && favCount > dogCount) {
      out.push({ kind: "absences", favorite: favCount, underdog: dogCount });
    }
  }

  return out;
}
