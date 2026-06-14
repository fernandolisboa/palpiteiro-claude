import { BttsInputSchema, type BttsInput } from "./schemas";
import type { GenericImpliedArgs, GenericOddsArgs } from "../types";
import type {
  NormalizedFixture,
  NormalizedH2H,
  NormalizedInjury,
  NormalizedLineup,
  NormalizedStanding,
  NormalizedTeamLineup,
} from "@/lib/providers/sports-data/types";

type PlayerRole = "GK" | "DEF" | "MID" | "FWD";
type AbsenceStatus = "injured" | "suspended" | "doubtful";
type SideOrientation = "home" | "away";

// NormalizedInjury.status preserva o enum de três estados. Pass-through direto.
function mapAbsenceStatus(injury: NormalizedInjury): AbsenceStatus {
  return injury.status;
}

function mapLineupRole(pos: string | null | undefined): PlayerRole {
  if (pos === "GK" || pos === "DEF" || pos === "MID" || pos === "FWD") return pos;
  return "MID";
}

function findStandingTeamByName(
  standings: NormalizedStanding | undefined,
  teamName: string,
) {
  if (!standings) return undefined;
  for (const table of standings.tables) {
    const row = table.teams.find((t) => t.team === teamName);
    if (row) return row;
  }
  return undefined;
}

function buildStanding(
  row: NonNullable<ReturnType<typeof findStandingTeamByName>>,
): BttsInput["home"]["standing"] {
  return {
    position: row.position,
    played: row.played,
    points: row.points,
    goals_for: row.goalsFor,
    goals_against: row.goalsAgainst,
    home_split: row.homeSplit
      ? {
          played: row.homeSplit.played,
          wins: row.homeSplit.wins,
          draws: row.homeSplit.draws,
          losses: row.homeSplit.losses,
          goals_for: row.homeSplit.goalsFor,
          goals_against: row.homeSplit.goalsAgainst,
        }
      : undefined,
    away_split: row.awaySplit
      ? {
          played: row.awaySplit.played,
          wins: row.awaySplit.wins,
          draws: row.awaySplit.draws,
          losses: row.awaySplit.losses,
          goals_for: row.awaySplit.goalsFor,
          goals_against: row.awaySplit.goalsAgainst,
        }
      : undefined,
  };
}

function buildFormMatches(
  fixtures: NormalizedFixture[],
  teamName: string,
  limit: number,
): BttsInput["home"]["form"]["matches"] {
  const matches: BttsInput["home"]["form"]["matches"] = [];
  const sorted = [...fixtures].sort(
    (a, b) => b.kickoffTimestampMs - a.kickoffTimestampMs,
  );
  for (const f of sorted) {
    if (f.score.home === null || f.score.away === null) continue;
    const isHome = f.homeTeam === teamName;
    const isAway = f.awayTeam === teamName;
    if (!isHome && !isAway) continue;
    const goalsFor = isHome ? f.score.home : f.score.away;
    const goalsAgainst = isHome ? f.score.away : f.score.home;
    const opponent = isHome ? f.awayTeam : f.homeTeam;
    const result: "W" | "D" | "L" =
      goalsFor > goalsAgainst ? "W" : goalsFor === goalsAgainst ? "D" : "L";
    matches.push({
      date: f.kickoffAt,
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
  injuries: NormalizedInjury[],
): BttsInput["home"]["absences"] {
  return injuries.map((inj) => ({
    player: inj.player.name,
    role: "MID" as const,
    status: mapAbsenceStatus(inj),
  }));
}

function buildLineupForSide(
  lineup: NormalizedTeamLineup | undefined,
): BttsInput["home"]["lineup"] | undefined {
  if (!lineup) return undefined;
  if (lineup.starters.length !== 11) return undefined;
  return {
    formation: lineup.formation ?? undefined,
    starters: lineup.starters.map((p) => ({
      player: p.name,
      role: mapLineupRole(p.position),
    })),
  };
}

function buildH2H(fixtures: NormalizedH2H[], limit: number): BttsInput["h2h"] {
  const matches: BttsInput["h2h"] = [];
  const sorted = [...fixtures].sort(
    (a, b) => b.kickoffTimestampMs - a.kickoffTimestampMs,
  );
  for (const f of sorted) {
    if (f.score.home === null || f.score.away === null) continue;
    matches.push({
      date: f.kickoffAt,
      home_team: f.homeTeam,
      away_team: f.awayTeam,
      score_home: f.score.home,
      score_away: f.score.away,
    });
    if (matches.length >= limit) break;
  }
  return matches;
}

export type BuildPredictionInputArgs = {
  match: {
    externalId: string;
    league: string;
    homeTeam: string;
    awayTeam: string;
    kickoffAt: Date;
    venue?: string;
  };
  standings: NormalizedStanding | undefined;
  home: {
    form: NormalizedFixture[];
    injuries: NormalizedInjury[];
    absencesAvailable: boolean;
  };
  away: {
    form: NormalizedFixture[];
    injuries: NormalizedInjury[];
    absencesAvailable: boolean;
  };
  lineups: NormalizedLineup | undefined;
  h2h: NormalizedH2H[];
  // odds/implied chegam no shape GENÉRICO que predict monta UMA vez pra qualquer
  // cartucho (selections[] keyed por selectionKey + pct map). buildPredictionInput
  // DOWN-MAPEIA pro shape binário do BttsInput (yes_decimal/no_decimal,
  // yes_pct/no_pct). O BttsInput (schema) fica INTACTO.
  odds: GenericOddsArgs;
  implied: GenericImpliedArgs;
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
): BttsInput {
  const homeRow = findStandingTeamByName(args.standings, args.match.homeTeam);
  const awayRow = findStandingTeamByName(args.standings, args.match.awayTeam);
  if (!homeRow || !awayRow) {
    throw new BuildInputError("standings row missing for one or both teams", {
      homeFound: Boolean(homeRow),
      awayFound: Boolean(awayRow),
      homeTeam: args.match.homeTeam,
      awayTeam: args.match.awayTeam,
    });
  }

  // Down-map do shape GENÉRICO (selections[]/pct) pro binário do BttsInput. As
  // chaves 'yes'/'no' vêm de descriptor.selectionKeys (predict monta os generic
  // args sobre essa ordem). Ausência = bug de seed/descriptor → BuildInputError.
  const yesSel = args.odds.selections.find((s) => s.key === "yes");
  const noSel = args.odds.selections.find((s) => s.key === "no");
  if (!yesSel || !noSel) {
    throw new BuildInputError(
      "btts odds missing 'yes'/'no' selection in generic args",
      {
        keys: args.odds.selections.map((s) => s.key),
      },
    );
  }
  const yesPct = args.implied.pct.yes;
  const noPct = args.implied.pct.no;
  if (yesPct === undefined || noPct === undefined) {
    throw new BuildInputError(
      "btts implied missing 'yes'/'no' pct in generic args",
      { keys: Object.keys(args.implied.pct) },
    );
  }

  const draft: BttsInput = {
    match: {
      id: args.match.externalId,
      home_team: {
        id: args.match.homeTeam,
        name: args.match.homeTeam,
      },
      away_team: {
        id: args.match.awayTeam,
        name: args.match.awayTeam,
      },
      league: args.match.league,
      kickoff_at: args.match.kickoffAt.toISOString(),
      venue: args.match.venue,
    },
    home: {
      form: {
        matches: buildFormMatches(
          args.home.form,
          args.match.homeTeam,
          FORM_LIMIT,
        ),
      },
      standing: buildStanding(homeRow),
      absences_available: args.home.absencesAvailable,
      absences: buildAbsences(args.home.injuries),
      lineup: buildLineupForSide(
        args.lineups?.home.team === args.match.homeTeam
          ? args.lineups.home
          : args.lineups?.away.team === args.match.homeTeam
            ? args.lineups.away
            : undefined,
      ),
    },
    away: {
      form: {
        matches: buildFormMatches(
          args.away.form,
          args.match.awayTeam,
          FORM_LIMIT,
        ),
      },
      standing: buildStanding(awayRow),
      absences_available: args.away.absencesAvailable,
      absences: buildAbsences(args.away.injuries),
      lineup: buildLineupForSide(
        args.lineups?.away.team === args.match.awayTeam
          ? args.lineups.away
          : args.lineups?.home.team === args.match.awayTeam
            ? args.lineups.home
            : undefined,
      ),
    },
    h2h: buildH2H(args.h2h, H2H_LIMIT),
    odds: {
      bookmaker: args.odds.bookmaker,
      yes_decimal: yesSel.odd,
      no_decimal: noSel.odd,
      captured_at: args.odds.captured_at,
    },
    implied: { yes_pct: yesPct, no_pct: noPct },
  } satisfies BttsInput;

  const parsed = BttsInputSchema.safeParse(draft);
  if (!parsed.success) {
    throw new BuildInputError("BttsInputSchema validation failed", {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export type { SideOrientation };
