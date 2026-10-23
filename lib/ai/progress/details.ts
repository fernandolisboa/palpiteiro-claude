// O que cada etapa encontrou, em frases curtas pro "Ver raciocínio" (ADR 0065). Puro:
// recebe o que o pipeline já tem em mãos e devolve linhas prontas. Mesmas regras da copy
// das etapas (steps.ts): português conversacional, sem termo de valor (nem "odds"), sem
// %, sem nome de casa de aposta e sem nome de jogador (a lista de desfalques vai em
// contagem). Números de jogo (gols esperados, posição na tabela, placar) podem.

import { applyJudgments } from "@/lib/ai/judgments/apply";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";
import { judgmentFactorPhrases } from "@/lib/ai/markets/_narrator/labels";
import type {
  NormalizedFixture,
  NormalizedLineup,
  NormalizedStanding,
} from "@/lib/providers/sports-data/types";
import type { ModelScoreline } from "@/lib/quant/match-model";

type Teams = { home: string; away: string };

const FORM_SHOWN = 5;

// Resultado de um jogo da forma, do ponto de vista do dono da forma.
function formLetter(fixture: NormalizedFixture, team: string): "V" | "E" | "D" | null {
  const { home, away } = fixture.score;
  if (fixture.status !== "finished" || home === null || away === null) return null;
  const own = fixture.homeTeam === team ? home : fixture.awayTeam === team ? away : null;
  const other = fixture.homeTeam === team ? away : home;
  if (own === null) return null;
  return own > other ? "V" : own < other ? "D" : "E";
}

function formLine(team: string, form: readonly NormalizedFixture[]): string | null {
  const letters = [...form]
    .sort((a, b) => b.kickoffTimestampMs - a.kickoffTimestampMs)
    .map((m) => formLetter(m, team))
    .filter((l): l is "V" | "E" | "D" => l !== null)
    .slice(0, FORM_SHOWN);
  if (letters.length === 0) return null;
  return `Forma recente do ${team} (mais novo primeiro): ${letters.join(" ")}`;
}

function positionOf(standings: NormalizedStanding | undefined, team: string): number | null {
  if (!standings) return null;
  for (const table of standings.tables) {
    const row = table.teams.find((t) => t.team === team);
    if (row) return row.position;
  }
  return null;
}

function h2hLine(h2h: readonly NormalizedFixture[], teams: Teams): string | null {
  let home = 0;
  let draws = 0;
  let away = 0;
  for (const m of h2h) {
    const letter = formLetter(m, teams.home);
    if (letter === "V") home += 1;
    else if (letter === "E") draws += 1;
    else if (letter === "D") away += 1;
  }
  const total = home + draws + away;
  if (total === 0) return null;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return `Últimos ${plural(total, "confronto", "confrontos")}: ${plural(home, "vitória", "vitórias")} do ${teams.home}, ${plural(draws, "empate", "empates")}, ${plural(away, "vitória", "vitórias")} do ${teams.away}`;
}

export function sportsDataDetail(args: {
  teams: Teams;
  homeForm: readonly NormalizedFixture[];
  awayForm: readonly NormalizedFixture[];
  h2h: readonly NormalizedFixture[];
  standings?: NormalizedStanding;
  absences: { home: number; away: number } | null;
  lineups: NormalizedLineup | null | undefined;
}): string[] {
  const { teams } = args;
  const lines: (string | null)[] = [
    formLine(teams.home, args.homeForm),
    formLine(teams.away, args.awayForm),
    h2hLine(args.h2h, teams),
  ];
  const homePos = positionOf(args.standings, teams.home);
  const awayPos = positionOf(args.standings, teams.away);
  if (homePos !== null && awayPos !== null) {
    lines.push(`Tabela: ${teams.home} em ${homePos}º, ${teams.away} em ${awayPos}º`);
  }
  if (args.absences === null) {
    lines.push("Lista de desfalques indisponível agora");
  } else if (args.absences.home + args.absences.away === 0) {
    lines.push("Nenhum desfalque informado para os dois times");
  } else {
    lines.push(
      `Desfalques: ${args.absences.home} no ${teams.home}, ${args.absences.away} no ${teams.away}`,
    );
  }
  lines.push(
    args.lineups && args.lineups.home.starters.length + args.lineups.away.starters.length > 0
      ? "Escalações confirmadas"
      : "Escalações ainda não divulgadas",
  );
  return lines.filter((l): l is string => l !== null);
}

const ONE_DECIMAL = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

// Placar de maior chance na matriz do modelo.
function likeliestScore(model: ModelScoreline): { home: number; away: number } | null {
  let best: { home: number; away: number; p: number } | null = null;
  model.matrix.cells.forEach((row, h) =>
    row.forEach((p, a) => {
      if (!best || p > best.p) best = { home: h, away: a, p };
    }),
  );
  return best;
}

export function modelDetail(model: ModelScoreline, teams: Teams): string[] {
  const lines = [
    `Gols esperados: ${teams.home} ${ONE_DECIMAL.format(model.lambdaHome)}, ${teams.away} ${ONE_DECIMAL.format(model.lambdaAway)}`,
  ];
  const score = likeliestScore(model);
  if (score) lines.push(`Placar mais provável pelo modelo: ${score.home}–${score.away}`);
  lines.push(
    model.source === "dixon_coles"
      ? "Força de ataque e defesa dos times recalculada todo dia com os jogos da liga"
      : "Estimativa pela campanha na tabela (o modelo principal não tinha dados suficientes)",
  );
  return lines;
}

// Os fatores de contexto que o JEV marcou e que mexem nas chances, em frases sem número.
export function jevDetail(answers: JudgmentAnswers | null, teams: Teams): string[] {
  if (!answers) return [];
  const { multipliers } = applyJudgments({ lambdaHome: 1, lambdaAway: 1 }, answers);
  const phrases = judgmentFactorPhrases(answers, multipliers, teams);
  return phrases.length > 0
    ? phrases
    : ["Nenhum fator de contexto (desfalques, rodízio, peso do jogo) mexeu nas chances"];
}

export function userContextDetail(user: { moved: boolean; notes: readonly string[] }): string[] {
  return [
    user.moved
      ? "O que você contou mexeu nas chances do modelo"
      : "O que você contou foi lido, sem mexer nas chances do modelo",
    ...user.notes,
  ];
}

export function newsDetail(count: number): string[] {
  return count > 0
    ? [`${count} ${count === 1 ? "notícia usada" : "notícias usadas"} no palpite`]
    : [];
}

// Uma linha por análise que alimentou o palpite: o mercado e o que ela escolheu.
export function analysesDetail(
  analyses: readonly { marketLabel: string; recommendedLabel: string | null; isPass: boolean }[],
): string[] {
  return analyses.map((a) =>
    a.isPass || !a.recommendedLabel
      ? `${a.marketLabel}: sem escolha neste mercado`
      : `${a.marketLabel}: ${a.recommendedLabel}`,
  );
}

const CONFIDENCE_WORD = { baixa: "baixa", media: "média", alta: "alta" } as const;

export function synthesisDetail(headline: {
  confidence: keyof typeof CONFIDENCE_WORD;
}): string[] {
  return [`Confiança do palpite: ${CONFIDENCE_WORD[headline.confidence]}`];
}
