import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { normalizeTeamName } from "@/lib/providers/sports-data/team-names";
import type {
  NormalizedInjury,
  NormalizedStanding,
  NormalizedStandingTeam,
  NormalizedTeamLineup,
} from "@/lib/providers/sports-data/types";

import type { JudgmentState, JudgmentTeamState } from "./types";

// Monta o `state` em inglês do JEV (ADR 0041 §2). Toda aritmética e comparação
// de datas acontece AQUI; o JEV só vê buckets nomeados e papéis. Nome de
// jogador NUNCA sai deste módulo (minimização LGPD, art. 6º III / art. 11).
// O vocabulário emitido é o que questions.ts cita nos criteria — mudou um, bump
// JUDGMENTS_VERSION.

export const UNKNOWN = "unknown";

// ─── Desfalques → papel ─────────────────────────────────────────────────────

export type AbsencePosition =
  | "goalkeeper"
  | "defender"
  | "midfielder"
  | "forward";

// Um desfalque do provider + o que o código conseguiu derivar dele. As dicas são
// opcionais: sem elas, o papel cai pra "<posição> (<status>)" ou "player (<status>)".
export type JudgmentAbsenceInput = {
  injury: NormalizedInjury;
  position?: AbsencePosition;
  // true = titular no último jogo; false = reserva; ausente = não se sabe.
  isRegularStarter?: boolean;
  isTopScorer?: boolean;
};

function normalizePersonName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Rótulos de posição das lineups normalizadas (api-football e football-data-org
// colapsam em GK/DEF/MID/FWD).
function positionFromLineupLabel(
  label: string | undefined
): AbsencePosition | undefined {
  switch (label) {
    case "GK":
      return "goalkeeper";
    case "DEF":
      return "defender";
    case "MID":
      return "midfielder";
    case "FWD":
      return "forward";
    default:
      return undefined;
  }
}

// Cruza os desfalques com a última escalação do time (posição + titularidade) e
// a lista de artilheiros, por nome normalizado. O nome serve só pro match aqui.
export function enrichAbsences(
  injuries: readonly NormalizedInjury[],
  context: {
    lastLineup?: NormalizedTeamLineup;
    topScorerNames?: readonly string[];
  } = {}
): JudgmentAbsenceInput[] {
  const lineupIndex = new Map<
    string,
    { position?: AbsencePosition; starter: boolean }
  >();
  for (const p of context.lastLineup?.bench ?? []) {
    lineupIndex.set(normalizePersonName(p.name), {
      position: positionFromLineupLabel(p.position),
      starter: false,
    });
  }
  // Titulares por último: vence se o nome aparecer nas duas listas.
  for (const p of context.lastLineup?.starters ?? []) {
    lineupIndex.set(normalizePersonName(p.name), {
      position: positionFromLineupLabel(p.position),
      starter: true,
    });
  }
  const topScorers = new Set(
    (context.topScorerNames ?? []).map(normalizePersonName)
  );

  return injuries.map((injury) => {
    const key = normalizePersonName(injury.player.name);
    const hit = lineupIndex.get(key);
    return {
      injury,
      position: hit?.position,
      isRegularStarter: hit ? hit.starter : undefined,
      isTopScorer: topScorers.has(key) ? true : undefined,
    };
  });
}

function roleFor(input: JudgmentAbsenceInput): string {
  const { position, isRegularStarter } = input;
  if (!position) return "player";
  if (isRegularStarter === undefined) return position;
  if (position === "goalkeeper") {
    return isRegularStarter ? "first-choice goalkeeper" : "backup goalkeeper";
  }
  return `${isRegularStarter ? "starting" : "rotation"} ${position}`;
}

export function describeAbsence(input: JudgmentAbsenceInput): string {
  const role = input.isTopScorer
    ? `${roleFor(input)}, team top scorer`
    : roleFor(input);
  return `${role} (${input.injury.status})`;
}

// ─── Calendário → buckets ──────────────────────────────────────────────────

const HOUR_MS = 3_600_000;
const SHORT_REST_HOURS = 72;
const LONG_REST_HOURS = 7 * 24;

function hoursBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return (to - from) / HOUR_MS;
}

export function restBucket(
  previousKickoffAt: string | undefined,
  kickoffAt: string
): string {
  if (!previousKickoffAt) return UNKNOWN;
  const hours = hoursBetween(previousKickoffAt, kickoffAt);
  if (hours === null || hours <= 0) return UNKNOWN;
  if (hours < SHORT_REST_HOURS) return "short rest (<72h)";
  if (hours <= LONG_REST_HOURS) return "normal rest";
  return "long rest (>7 days)";
}

export function nextMatchBucket(
  kickoffAt: string,
  next: { kickoffAt: string; competition?: string } | undefined
): string {
  if (!next) return UNKNOWN;
  const hours = hoursBetween(kickoffAt, next.kickoffAt);
  if (hours === null || hours <= 0) return UNKNOWN;
  const bucket =
    hours < SHORT_REST_HOURS
      ? "next match within 72h"
      : hours <= LONG_REST_HOURS
        ? "next match in 3 to 7 days"
        : "next match more than 7 days away";
  return next.competition ? `${bucket} (${next.competition})` : bucket;
}

// ─── Tabela → buckets ──────────────────────────────────────────────────────

export type LeagueTableInput = {
  rows: readonly NormalizedStandingTeam[];
  totalRounds: number;
  continentalSpots: number;
  relegationSpots: number;
};

// Só ligas de pontos corridos têm zonas estáveis. Libertadores = G6 (vagas extras
// via copa variam ano a ano; G6 é o piso).
const LEAGUE_TABLE_CONFIG: Partial<
  Record<SupportedLeague, Omit<LeagueTableInput, "rows">>
> = {
  brasileirao_a: { totalRounds: 38, continentalSpots: 6, relegationSpots: 4 },
};

// Tabela única da liga (sem grupos) + config de zonas; senão undefined → "unknown".
export function tableInputForLeague(
  league: SupportedLeague,
  standing: NormalizedStanding | undefined
): LeagueTableInput | undefined {
  const config = LEAGUE_TABLE_CONFIG[league];
  if (!config || !standing || standing.tables.length !== 1) return undefined;
  return { rows: standing.tables[0].teams, ...config };
}

// Antes de ~15% da temporada a tabela é ruído (todo mundo "na briga").
const EARLY_SEASON_SHARE = 0.15;
// Distância (pontos) que ainda conta como "na briga": duas vitórias.
const CONTEST_MARGIN_POINTS = 6;
const FINAL_ROUNDS = 5;

function findRow(
  rows: readonly NormalizedStandingTeam[],
  team: string
): NormalizedStandingTeam | undefined {
  const exact = rows.find((r) => r.team === team);
  if (exact) return exact;
  const norm = normalizeTeamName(team);
  return rows.find((r) => normalizeTeamName(r.team) === norm);
}

function isEarlySeason(played: number, totalRounds: number): boolean {
  return played < Math.ceil(totalRounds * EARLY_SEASON_SHARE);
}

export function tableSituation(
  table: LeagueTableInput | undefined,
  team: string
): string {
  if (!table) return UNKNOWN;
  const row = findRow(table.rows, team);
  if (!row) return UNKNOWN;
  if (isEarlySeason(row.played, table.totalRounds)) {
    return "early season (table not settled)";
  }
  const byPosition = [...table.rows].sort((a, b) => a.position - b.position);
  const teamsCount = byPosition.length;
  const remaining = Math.max(0, table.totalRounds - row.played);
  // Não dá pra fechar mais pontos do que os que restam em jogo.
  const margin = Math.min(CONTEST_MARGIN_POINTS, 3 * remaining);
  const firstRelegatedPos = teamsCount - table.relegationSpots + 1;

  if (table.relegationSpots > 0 && row.position >= firstRelegatedPos) {
    return "relegation zone";
  }
  const leaderPoints = Math.max(...byPosition.map((r) => r.points));
  if (leaderPoints - row.points <= margin) return "title race";

  const firstRelegated = byPosition[firstRelegatedPos - 1];
  if (
    table.relegationSpots > 0 &&
    firstRelegated &&
    row.points - firstRelegated.points <= margin
  ) {
    return "relegation battle";
  }
  const lastContinental = byPosition[table.continentalSpots - 1];
  if (
    table.continentalSpots > 0 &&
    lastContinental &&
    (row.position <= table.continentalSpots ||
      lastContinental.points - row.points <= margin)
  ) {
    return "continental qualification race";
  }
  return "safe mid-table";
}

export function seasonStage(
  table: LeagueTableInput | undefined,
  teams: readonly string[]
): string {
  if (!table) return UNKNOWN;
  const played = teams
    .map((t) => findRow(table.rows, t)?.played)
    .filter((p): p is number => p !== undefined);
  if (played.length === 0) return UNKNOWN;
  const roundsPlayed = Math.min(...played);
  const remaining = table.totalRounds - roundsPlayed;
  if (isEarlySeason(roundsPlayed, table.totalRounds)) return "early season";
  if (remaining <= FINAL_ROUNDS) return "final 5 rounds";
  return roundsPlayed < table.totalRounds / 2
    ? "first half of season"
    : "second half of season";
}

// ─── Montagem ──────────────────────────────────────────────────────────────

export type JudgmentTeamInput = {
  name: string;
  absences: readonly JudgmentAbsenceInput[];
  previousKickoffAt?: string;
  nextFixture?: { kickoffAt: string; competition?: string };
};

export type JudgmentStateInput = {
  // Rótulo da competição em inglês (ex.: "Brazilian Serie A").
  competition: string;
  kickoffAt: string;
  home: JudgmentTeamInput;
  away: JudgmentTeamInput;
  table?: LeagueTableInput;
};

function teamState(
  team: JudgmentTeamInput,
  input: JudgmentStateInput
): JudgmentTeamState {
  return {
    name: team.name,
    absences: team.absences.map(describeAbsence),
    rest_before_match: restBucket(team.previousKickoffAt, input.kickoffAt),
    next_match: nextMatchBucket(input.kickoffAt, team.nextFixture),
    league_situation: tableSituation(input.table, team.name),
  };
}

export function buildJudgmentState(input: JudgmentStateInput): JudgmentState {
  return {
    match: {
      competition: input.competition,
      season_stage: seasonStage(input.table, [
        input.home.name,
        input.away.name,
      ]),
    },
    home_team: teamState(input.home, input),
    away_team: teamState(input.away, input),
  };
}
