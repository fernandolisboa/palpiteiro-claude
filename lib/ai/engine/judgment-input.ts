import {
  enrichAbsences,
  summarizeLineup,
  tableInputForLeague,
  type JudgmentAbsenceInput,
  type JudgmentStateInput,
  type LineupSummary,
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
// buscas extras — escalação do jogo anterior, XI de referência, próximos jogos e
// artilheiros — são do predict). O que não veio fica ausente e vira "unknown" no state.

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

// XI de referência (#619): o "time habitual" contra o qual a escalação de hoje é
// comparada. Mesma competição (outra competição tem outra lógica de escalação) e no
// máximo 45 dias antes do kickoff (elenco de outra fase da temporada não serve).
export const LINEUP_BASELINE_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;
// Jogo a menos disto de outro jogo do time (ou deste) pode ter sido poupado.
const LINEUP_BASELINE_CONGESTION_MS = 72 * 60 * 60 * 1000;

// Jogo da forma que serve de XI de referência: o mais recente da mesma competição
// (`competition.league`; forma sem o campo, amistoso ou outra competição ficam fora),
// antes do kickoff e com no máximo 45 dias, e NÃO congestionado (sem outro jogo do
// time — forma, qualquer competição — nem este jogo a < 72 h dele). Todos
// congestionados → undefined ("changes unknown": o calendário decide). Com um XI só,
// um jogo de liga poupado antes da Champions viraria referência e o time completo de
// hoje sairia "5+ mudanças". Só datas da forma: zero request.
export function pickLineupBaseline(
  form: readonly NormalizedFixture[],
  args: { league: SupportedLeague; kickoffMs: number }
): NormalizedFixture | undefined {
  const { league, kickoffMs } = args;
  const candidates = form
    .filter(
      (f) =>
        f.competition?.league === league &&
        !f.competition.friendly &&
        f.kickoffTimestampMs < kickoffMs &&
        kickoffMs - f.kickoffTimestampMs <= LINEUP_BASELINE_MAX_AGE_MS
    )
    .sort((a, b) => b.kickoffTimestampMs - a.kickoffTimestampMs);
  const congested = (f: NormalizedFixture) =>
    kickoffMs - f.kickoffTimestampMs < LINEUP_BASELINE_CONGESTION_MS ||
    form.some(
      (g) =>
        g.id !== f.id &&
        Math.abs(g.kickoffTimestampMs - f.kickoffTimestampMs) <
          LINEUP_BASELINE_CONGESTION_MS
    );
  return candidates.find((f) => !congested(f));
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
  // Escalação DESTE jogo (o adapter só devolve com os dois lados publicados): a
  // contagem de mudanças (#619) e quem dos desfalcados vai começar jogando. Nunca é
  // fonte do papel do desfalcado (quem está fora não aparece nela).
  lineups: NormalizedLineup | undefined;
  // Escalação de cada time no jogo ANTERIOR (a fonte certa de posição/titular do
  // desfalcado); ausente quando não buscada ou indisponível.
  previousLineups?: {
    home?: NormalizedTeamLineup;
    away?: NormalizedTeamLineup;
  };
  // XI de referência de cada time (#619, pickLineupBaseline): só buscado com a
  // escalação deste jogo publicada; ausente → "announced, changes unknown".
  lineupBaseline?: {
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
  // A mesma lista ANTES de tirar quem está no XI de hoje (#619): é a que confere as
  // afirmações do usuário (check-claims), como em lib/user-palpite/facts.ts.
  providerAbsences: { home: JudgmentAbsenceInput[]; away: JudgmentAbsenceInput[] };
  // Resumo da escalação de cada time (#619), sem nomes: vai pro jsonb da predição.
  lineup: { home: LineupSummary; away: LineupSummary };
};

export function buildMatchJudgmentInput(
  data: MatchJudgmentData
): MatchJudgmentInput {
  const kickoffMs = data.kickoffAt.getTime();
  // Papel do desfalcado: XI do jogo anterior → XI de referência → sem papel (#619).
  const enrich = (side: "home" | "away", team: string, today?: boolean) =>
    enrichAbsences(data.injuries[side], {
      lastLineup: data.previousLineups?.[side] ?? data.lineupBaseline?.[side],
      topScorerNames: teamTopScorerNames(data.topScorers, team),
      ...(today ? { confirmedLineup: data.lineups?.[side] } : {}),
    });
  const providerAbsences = {
    home: enrich("home", data.homeTeam),
    away: enrich("away", data.awayTeam),
  };
  const absences = {
    home: enrich("home", data.homeTeam, true),
    away: enrich("away", data.awayTeam, true),
  };
  const lineup = {
    home: summarizeLineup({
      today: data.lineups?.home,
      reference: data.lineupBaseline?.home,
      absences: absences.home,
    }),
    away: summarizeLineup({
      today: data.lineups?.away,
      reference: data.lineupBaseline?.away,
      absences: absences.away,
    }),
  };
  const match = {
    kickoffMs,
    homeTeam: data.homeTeam,
    awayTeam: data.awayTeam,
  };
  return {
    absences,
    providerAbsences,
    lineup,
    stateInput: {
      competition: COMPETITION_LABEL[data.league],
      kickoffAt: data.kickoffAt.toISOString(),
      home: {
        name: data.homeTeam,
        absences: absences.home,
        lineup: lineup.home,
        ...teamSchedule({
          ...match,
          form: data.homeForm,
          upcoming: data.upcoming?.home,
        }),
      },
      away: {
        name: data.awayTeam,
        absences: absences.away,
        lineup: lineup.away,
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
