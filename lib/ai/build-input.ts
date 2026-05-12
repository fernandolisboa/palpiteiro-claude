import {
  OverUnderInputSchema,
  type OverUnderInput,
} from "@/lib/ai/schemas/input";
import type {
  ApiFootballFixture,
  ApiFootballInjury,
  ApiFootballLineup,
  ApiFootballStandings,
} from "@/lib/providers/api-football-schemas";

type PlayerRole = "GK" | "DEF" | "MID" | "FWD";
type AbsenceStatus = "injured" | "suspended" | "doubtful";
type SideOrientation = "home" | "away";

// API-Football devolve "Missing Fixture" / "Questionable" como `player.type`.
// O motivo (reason) é texto livre; usamos heurística simples para detectar
// suspensões por cartão. Pra outros casos, default seguro = "injured".
function mapAbsenceStatus(injury: ApiFootballInjury): AbsenceStatus {
  const type = (injury.player.type ?? "").toLowerCase();
  const reason = (injury.player.reason ?? "").toLowerCase();
  if (type.includes("questionable") || reason.includes("doubt")) return "doubtful";
  if (reason.includes("card") || reason.includes("suspension")) return "suspended";
  return "injured";
}

// API-Football lineup position char: "G" | "D" | "M" | "F".
function mapLineupRole(pos: string | null | undefined): PlayerRole {
  switch (pos) {
    case "G":
      return "GK";
    case "D":
      return "DEF";
    case "M":
      return "MID";
    case "F":
      return "FWD";
    default:
      return "MID";
  }
}

function toIsoZ(input: string | number): string {
  const date = typeof input === "number" ? new Date(input * 1000) : new Date(input);
  return date.toISOString();
}

function findStandingRow(
  standings: ApiFootballStandings | undefined,
  teamId: number,
) {
  if (!standings) return undefined;
  for (const group of standings.league.standings) {
    for (const row of group) {
      if (row.team.id === teamId) return row;
    }
  }
  return undefined;
}

function buildStanding(
  row: NonNullable<ReturnType<typeof findStandingRow>>,
): OverUnderInput["home"]["standing"] {
  return {
    position: row.rank,
    played: row.all.played,
    points: row.points,
    goals_for: row.all.goals.for,
    goals_against: row.all.goals.against,
    home_split: {
      played: row.home.played,
      wins: row.home.win,
      draws: row.home.draw,
      losses: row.home.lose,
      goals_for: row.home.goals.for,
      goals_against: row.home.goals.against,
    },
    away_split: {
      played: row.away.played,
      wins: row.away.win,
      draws: row.away.draw,
      losses: row.away.lose,
      goals_for: row.away.goals.for,
      goals_against: row.away.goals.against,
    },
  };
}

function buildFormMatches(
  fixtures: ApiFootballFixture[],
  teamId: number,
  limit: number,
): OverUnderInput["home"]["form"]["matches"] {
  const matches: OverUnderInput["home"]["form"]["matches"] = [];
  // Sort by kickoff descending (mais recente primeiro).
  const sorted = [...fixtures].sort(
    (a, b) => b.fixture.timestamp - a.fixture.timestamp,
  );
  for (const f of sorted) {
    if (f.goals.home === null || f.goals.away === null) continue;
    const isHome = f.teams.home.id === teamId;
    const isAway = f.teams.away.id === teamId;
    if (!isHome && !isAway) continue;
    const goalsFor = isHome ? f.goals.home : f.goals.away;
    const goalsAgainst = isHome ? f.goals.away : f.goals.home;
    const opponent = isHome ? f.teams.away.name : f.teams.home.name;
    const result: "W" | "D" | "L" =
      goalsFor > goalsAgainst ? "W" : goalsFor === goalsAgainst ? "D" : "L";
    matches.push({
      date: toIsoZ(f.fixture.date),
      opponent,
      home_or_away: isHome ? "home" : "away",
      goals_for: goalsFor,
      goals_against: goalsAgainst,
      result,
    });
    if (matches.length >= limit) break;
  }
  return matches;
}

function buildAbsences(
  injuries: ApiFootballInjury[],
): OverUnderInput["home"]["absences"] {
  return injuries.map((inj) => ({
    player: inj.player.name,
    role: "MID" as const,
    status: mapAbsenceStatus(inj),
  }));
}

function buildLineup(
  lineups: ApiFootballLineup[],
  teamId: number,
): OverUnderInput["home"]["lineup"] | undefined {
  const lineup = lineups.find((l) => l.team.id === teamId);
  if (!lineup) return undefined;
  if (lineup.startXI.length !== 11) return undefined;
  return {
    formation: lineup.formation ?? undefined,
    starters: lineup.startXI.map((entry) => ({
      player: entry.player.name,
      role: mapLineupRole(entry.player.pos),
    })),
  };
}

function buildH2H(
  fixtures: ApiFootballFixture[],
  limit: number,
): OverUnderInput["h2h"] {
  const matches: OverUnderInput["h2h"] = [];
  const sorted = [...fixtures].sort(
    (a, b) => b.fixture.timestamp - a.fixture.timestamp,
  );
  for (const f of sorted) {
    if (f.goals.home === null || f.goals.away === null) continue;
    matches.push({
      date: toIsoZ(f.fixture.date),
      home_team: f.teams.home.name,
      away_team: f.teams.away.name,
      score_home: f.goals.home,
      score_away: f.goals.away,
    });
    if (matches.length >= limit) break;
  }
  return matches;
}

export type BuildPredictionInputArgs = {
  match: {
    externalId: string;
    league: string;
    homeTeam: { id: number; name: string };
    awayTeam: { id: number; name: string };
    kickoffAt: Date;
    venue?: string;
  };
  standings: ApiFootballStandings | undefined;
  home: {
    form: ApiFootballFixture[];
    injuries: ApiFootballInjury[];
  };
  away: {
    form: ApiFootballFixture[];
    injuries: ApiFootballInjury[];
  };
  lineups: ApiFootballLineup[];
  h2h: ApiFootballFixture[];
  odds: {
    bookmaker: string;
    over_2_5_decimal: number;
    under_2_5_decimal: number;
    captured_at: string;
  };
  implied: { over_pct: number; under_pct: number };
};

export class BuildInputError extends Error {
  readonly context: Record<string, unknown>;
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = "BuildInputError";
    this.context = context;
  }
}

const FORM_LIMIT = 5;
const H2H_LIMIT = 5;

export function buildPredictionInput(
  args: BuildPredictionInputArgs,
): OverUnderInput {
  const homeRow = findStandingRow(args.standings, args.match.homeTeam.id);
  const awayRow = findStandingRow(args.standings, args.match.awayTeam.id);
  if (!homeRow || !awayRow) {
    throw new BuildInputError("standings row missing for one or both teams", {
      homeFound: Boolean(homeRow),
      awayFound: Boolean(awayRow),
      homeTeamId: args.match.homeTeam.id,
      awayTeamId: args.match.awayTeam.id,
    });
  }

  const draft: OverUnderInput = {
    match: {
      id: args.match.externalId,
      home_team: {
        id: String(args.match.homeTeam.id),
        name: args.match.homeTeam.name,
      },
      away_team: {
        id: String(args.match.awayTeam.id),
        name: args.match.awayTeam.name,
      },
      league: args.match.league,
      kickoff_at: args.match.kickoffAt.toISOString(),
      venue: args.match.venue,
    },
    home: {
      form: {
        matches: buildFormMatches(
          args.home.form,
          args.match.homeTeam.id,
          FORM_LIMIT,
        ),
      },
      standing: buildStanding(homeRow),
      absences: buildAbsences(args.home.injuries),
      lineup: buildLineup(args.lineups, args.match.homeTeam.id),
    },
    away: {
      form: {
        matches: buildFormMatches(
          args.away.form,
          args.match.awayTeam.id,
          FORM_LIMIT,
        ),
      },
      standing: buildStanding(awayRow),
      absences: buildAbsences(args.away.injuries),
      lineup: buildLineup(args.lineups, args.match.awayTeam.id),
    },
    h2h: buildH2H(args.h2h, H2H_LIMIT),
    odds: args.odds,
    implied: args.implied,
  } satisfies OverUnderInput;

  const parsed = OverUnderInputSchema.safeParse(draft);
  if (!parsed.success) {
    throw new BuildInputError("OverUnderInputSchema validation failed", {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export type { SideOrientation };
