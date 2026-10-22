import {
  enrichAbsences,
  tableInputForLeague,
  type JudgmentAbsenceInput,
  type JudgmentStateInput,
} from "@/lib/ai/judgments/state";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type {
  NormalizedFixture,
  NormalizedInjury,
  NormalizedLineup,
  NormalizedStanding,
  NormalizedTeamLineup,
  NormalizedTopScorer,
  UpcomingTeamFixture,
} from "@/lib/providers/sports-data/types";

// Monta o input do state JEV (ADR 0041 §2) SÓ com o que o predict já buscou (as
// buscas extras — escalação do jogo anterior, próximos jogos e artilheiros — são do
// predict). O que não veio fica ausente e vira "unknown" no state.

// Rótulo em inglês da competição (o state do JEV é em inglês).
const COMPETITION_LABEL: Record<SupportedLeague, string> = {
  brasileirao_a: "Brazilian Serie A",
  champions_league: "UEFA Champions League",
  world_cup: "FIFA World Cup",
  serie_a: "Italian Serie A",
  bundesliga: "German Bundesliga",
  ligue_1: "French Ligue 1",
  copa_libertadores: "Copa Libertadores",
  copa_sudamericana: "Copa Sudamericana",
  premier_league: "English Premier League",
  la_liga: "Spanish La Liga",
};

// Último jogo do time ANTES deste (a forma recente vem do provider, já ordenada ou
// não — ordenamos aqui). Comparação de datas no código, nunca no JEV.
export function previousFixture(
  form: readonly NormalizedFixture[],
  kickoffMs: number
): NormalizedFixture | undefined {
  let best: NormalizedFixture | undefined;
  for (const f of form) {
    if (f.kickoffTimestampMs >= kickoffMs) continue;
    if (!best || f.kickoffTimestampMs > best.kickoffTimestampMs) best = f;
  }
  return best;
}

// Um jogo de OUTRA data contra o mesmo adversário não é este: a API e o banco podem
// divergir em minutos/horas no kickoff (adapter.getFixtureByMatch tolera o mesmo).
const SAME_MATCH_WINDOW_MS = 36 * 60 * 60 * 1000;

function isThisMatch(
  f: UpcomingTeamFixture,
  match: { kickoffMs: number; homeTeam: string; awayTeam: string }
): boolean {
  const sameTeams =
    (f.homeTeam === match.homeTeam && f.awayTeam === match.awayTeam) ||
    (f.homeTeam === match.awayTeam && f.awayTeam === match.homeTeam);
  return (
    sameTeams &&
    Math.abs(f.kickoffTimestampMs - match.kickoffMs) <= SAME_MATCH_WINDOW_MS
  );
}

// Calendário de um time em volta deste jogo (#617): o anterior é o mais recente antes
// do kickoff entre a forma (encerrados) e os próximos jogos (um jogo de meio de semana
// ainda não disputado conta pro descanso); o próximo é o 1º depois do kickoff. Este
// jogo nunca conta como nenhum dos dois.
export function teamSchedule(args: {
  kickoffMs: number;
  homeTeam: string;
  awayTeam: string;
  form: readonly NormalizedFixture[];
  upcoming: readonly UpcomingTeamFixture[] | undefined;
}): {
  previousKickoffAt?: string;
  nextFixture?: { kickoffAt: string; competition: string; round?: string };
} {
  const others = (args.upcoming ?? []).filter((f) => !isThisMatch(f, args));
  const fromForm = previousFixture(args.form, args.kickoffMs);
  let previousMs = fromForm?.kickoffTimestampMs;
  let previousKickoffAt = fromForm?.kickoffAt;
  let next: UpcomingTeamFixture | undefined;
  for (const f of others) {
    if (f.kickoffTimestampMs < args.kickoffMs) {
      if (previousMs === undefined || f.kickoffTimestampMs > previousMs) {
        previousMs = f.kickoffTimestampMs;
        previousKickoffAt = f.kickoffAt;
      }
    } else if (
      f.kickoffTimestampMs > args.kickoffMs &&
      (!next || f.kickoffTimestampMs < next.kickoffTimestampMs)
    ) {
      next = f;
    }
  }
  return {
    ...(previousKickoffAt ? { previousKickoffAt } : {}),
    ...(next
      ? {
          nextFixture: {
            kickoffAt: next.kickoffAt,
            competition: next.competition,
            ...(next.round ? { round: next.round } : {}),
          },
        }
      : {}),
  };
}

// Gols mínimos pra alguém ser "o artilheiro do time": abaixo disso (começo de
// temporada) o rótulo é ruído.
export const TOP_SCORER_MIN_GOALS = 3;

// Artilheiro(s) do time na lista da competição: quem tem mais gols pelo time (empate
// = todos), com o piso acima. Times fora da lista (top 20) ficam sem rótulo.
export function teamTopScorerNames(
  topScorers: readonly NormalizedTopScorer[] | undefined,
  team: string
): string[] {
  const rows = (topScorers ?? []).filter(
    (r) => r.team === team && r.goals >= TOP_SCORER_MIN_GOALS
  );
  const max = Math.max(0, ...rows.map((r) => r.goals));
  return rows.filter((r) => r.goals === max).map((r) => r.player.name);
}

export type MatchJudgmentData = {
  league: SupportedLeague;
  kickoffAt: Date;
  homeTeam: string;
  awayTeam: string;
  injuries: { home: NormalizedInjury[]; away: NormalizedInjury[] };
  // Escalação DESTE jogo: nunca traz quem está fora, então é só o fallback.
  lineups: NormalizedLineup | undefined;
  // Escalação de cada time no jogo ANTERIOR (a fonte certa de posição/titular do
  // desfalcado); ausente quando não buscada ou indisponível.
  previousLineups?: {
    home?: NormalizedTeamLineup;
    away?: NormalizedTeamLineup;
  };
  homeForm: readonly NormalizedFixture[];
  awayForm: readonly NormalizedFixture[];
  standings: NormalizedStanding | undefined;
  // Próximos jogos de cada time em qualquer competição (#617); ausente = não buscado
  // ou indisponível → calendário só pela forma, próximo jogo "unknown".
  upcoming?: {
    home?: readonly UpcomingTeamFixture[];
    away?: readonly UpcomingTeamFixture[];
  };
  // Artilheiros da competição (#617); ausente → ninguém é "team top scorer".
  topScorers?: readonly NormalizedTopScorer[];
};

export type MatchJudgmentInput = {
  stateInput: JudgmentStateInput;
  // Desfalques enriquecidos com papel — reusados pelo narrador (papel, não nome).
  absences: { home: JudgmentAbsenceInput[]; away: JudgmentAbsenceInput[] };
};

export function buildMatchJudgmentInput(
  data: MatchJudgmentData
): MatchJudgmentInput {
  const kickoffMs = data.kickoffAt.getTime();
  const absences = {
    home: enrichAbsences(data.injuries.home, {
      lastLineup: data.previousLineups?.home ?? data.lineups?.home,
      topScorerNames: teamTopScorerNames(data.topScorers, data.homeTeam),
    }),
    away: enrichAbsences(data.injuries.away, {
      lastLineup: data.previousLineups?.away ?? data.lineups?.away,
      topScorerNames: teamTopScorerNames(data.topScorers, data.awayTeam),
    }),
  };
  const match = {
    kickoffMs,
    homeTeam: data.homeTeam,
    awayTeam: data.awayTeam,
  };
  return {
    absences,
    stateInput: {
      competition: COMPETITION_LABEL[data.league],
      kickoffAt: data.kickoffAt.toISOString(),
      home: {
        name: data.homeTeam,
        absences: absences.home,
        ...teamSchedule({
          ...match,
          form: data.homeForm,
          upcoming: data.upcoming?.home,
        }),
      },
      away: {
        name: data.awayTeam,
        absences: absences.away,
        ...teamSchedule({
          ...match,
          form: data.awayForm,
          upcoming: data.upcoming?.away,
        }),
      },
      table: tableInputForLeague(data.league, data.standings),
    },
  };
}
