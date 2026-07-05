import {
  OverUnderInputSchema,
  OverUnderInputV3Schema,
  type OverUnderInput,
  type OverUnderInputV3,
  type ScorelineModelFacts,
} from "./schemas";
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

// NormalizedInjury.type collapses to "injury" or "suspension"; NormalizedInjury.status
// preserves the full three-state enum. Pass through directly.
function mapAbsenceStatus(injury: NormalizedInjury): AbsenceStatus {
  return injury.status;
}

// Normalized lineup players carry an optional position label already collapsed
// to GK/DEF/MID/FWD by the adapter. Default to MID when the provider omits it
// (mirrors the pre-issue-24 fallback in build-input.ts).
function mapLineupRole(pos: string | null | undefined): PlayerRole {
  if (pos === "GK" || pos === "DEF" || pos === "MID" || pos === "FWD") return pos;
  return "MID";
}

// Os helpers de mapeamento sports-data abaixo são EXPORTADOS (aditivo) pra o
// build-input do v3 (#175) reaproveitá-los — o shape de match/home/away/h2h é
// idêntico ao v2 (mesmas sub-schemas). Mantidos como `function` nomeadas pra
// preservar o uso interno do v2 sem indireção.
export function findStandingTeamByName(
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

export function buildStanding(
  row: NonNullable<ReturnType<typeof findStandingTeamByName>>,
): OverUnderInput["home"]["standing"] {
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

export function buildFormMatches(
  fixtures: NormalizedFixture[],
  teamName: string,
  limit: number,
): OverUnderInput["home"]["form"]["matches"] {
  const matches: OverUnderInput["home"]["form"]["matches"] = [];
  // Already cronological-desc from the adapters; defensively sort again.
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

export function buildAbsences(
  injuries: NormalizedInjury[],
): OverUnderInput["home"]["absences"] {
  return injuries.map((inj) => ({
    player: inj.player.name,
    // NormalizedInjury doesn't carry position (not reliably available from
    // the /injuries endpoints); default to MID. The prompt rule about
    // absences_available makes this less critical — the AI knows when data
    // is partial.
    role: "MID" as const,
    status: mapAbsenceStatus(inj),
    // Proveniência (ADR 0026, #226): propaga `source` quando presente. Spread
    // condicional pra NÃO poluir o payload com `source: undefined` (a fonte é
    // opcional). confidence/capturedAt seguem o mesmo padrão quando o #227 popular.
    ...(inj.source ? { source: inj.source } : {}),
  }));
}

export function buildLineupForSide(
  lineup: NormalizedTeamLineup | undefined,
): OverUnderInput["home"]["lineup"] | undefined {
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

export function buildH2H(
  fixtures: NormalizedH2H[],
  limit: number,
): OverUnderInput["h2h"] {
  const matches: OverUnderInput["h2h"] = [];
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
  // DOWN-MAPEIA pro shape binário do OverUnderInput (over_2_5_decimal/under_2_5_decimal,
  // over_pct/under_pct) — ver abaixo. O OverUnderInput (schema) fica INTACTO.
  odds: GenericOddsArgs;
  implied: GenericImpliedArgs;
  // Baseline Poisson por linha (ADR 0037) — predict computa sobre a matriz e passa
  // aqui em camelCase; mapeamos pro snake_case do schema. Opcional (ausente = escada
  // de degradação: standings indisponível → cartucho roda como antes).
  scorelineModel?: {
    source: "poisson";
    degraded: boolean;
    perLine: { line: number; overPct: number }[];
  };
};

// camelCase (args de predict) → snake_case (schema). undefined preserva a ausência.
function buildScorelineModel(
  m: BuildPredictionInputArgs["scorelineModel"],
): ScorelineModelFacts | undefined {
  if (!m) return undefined;
  return {
    source: m.source,
    degraded: m.degraded,
    per_line: m.perLine.map((l) => ({ line: l.line, over_pct: l.overPct })),
  };
}

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

  // Down-map do shape GENÉRICO (selections[]/pct) pro binário do OverUnderInput.
  // As chaves 'over'/'under' vêm de descriptor.selectionKeys (predict monta o
  // generic args sobre essa ordem). Ausência = bug de seed/descriptor → BuildInputError.
  const overSel = args.odds.selections.find((s) => s.key === "over");
  const underSel = args.odds.selections.find((s) => s.key === "under");
  if (!overSel || !underSel) {
    throw new BuildInputError(
      "over_under odds missing 'over'/'under' selection in generic args",
      {
        keys: args.odds.selections.map((s) => s.key),
      },
    );
  }
  const overPct = args.implied.pct.over;
  const underPct = args.implied.pct.under;
  if (overPct === undefined || underPct === undefined) {
    throw new BuildInputError(
      "over_under implied missing 'over'/'under' pct in generic args",
      { keys: Object.keys(args.implied.pct) },
    );
  }

  // The composite fixture key has the same shape as a team identifier per side.
  // The output schema wants `id` as a string and `name` as the display name —
  // we use canonical name as both since IDs are no longer provider-bound.
  const draft: OverUnderInput = {
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
      over_2_5_decimal: overSel.odd,
      under_2_5_decimal: underSel.odd,
      captured_at: args.odds.captured_at,
    },
    implied: { over_pct: overPct, under_pct: underPct },
    scoreline_model: buildScorelineModel(args.scorelineModel),
  } satisfies OverUnderInput;

  const parsed = OverUnderInputSchema.safeParse(draft);
  if (!parsed.success) {
    throw new BuildInputError("OverUnderInputSchema validation failed", {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

// ─── build-input v3 (multi-linha, #175) ──────────────────────────────────────

// Monta o OverUnderInputV3 consumindo a escada `args.odds.lineLadder` (montada por
// predict UMA vez, um bundle por linha candidata). O CONTEXTO (match/home/away/h2h)
// reusa os MESMOS helpers do v2 — shape idêntico. O bloco de odds vira a lista
// `lines[]` (over=seleção 'over', under=seleção 'under', pct de impliedPct por linha).
// Reaproveita BuildPredictionInputArgs: os campos de sports-data são os mesmos; só
// trocamos o consumo de odds (lineLadder em vez do par único `odds.selections`).
export function buildPredictionInputV3(
  args: BuildPredictionInputArgs,
): OverUnderInputV3 {
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

  const ladder = args.odds.lineLadder;
  if (!ladder || ladder.length === 0) {
    throw new BuildInputError(
      "over_under v3 odds missing lineLadder in generic args",
      { hasLadder: Boolean(ladder), ladderLen: ladder?.length ?? 0 },
    );
  }

  // Cada entrada da escada → uma linha do input v3. As chaves 'over'/'under' vêm de
  // descriptor.selectionKeys (predict monta o ladder sobre essa ordem). Ausência de
  // qualquer seleção/pct por linha = bug de seed/descriptor → BuildInputError.
  const lines = ladder.map((entry) => {
    const overSel = entry.selections.find((s) => s.key === "over");
    const underSel = entry.selections.find((s) => s.key === "under");
    if (!overSel || !underSel) {
      throw new BuildInputError(
        "over_under v3 lineLadder entry missing 'over'/'under' selection",
        { line: entry.line, keys: entry.selections.map((s) => s.key) },
      );
    }
    const overPct = entry.impliedPct.over;
    const underPct = entry.impliedPct.under;
    if (overPct === undefined || underPct === undefined) {
      throw new BuildInputError(
        "over_under v3 lineLadder entry missing 'over'/'under' implied pct",
        { line: entry.line, keys: Object.keys(entry.impliedPct) },
      );
    }
    return {
      line: entry.line,
      bookmaker: entry.bookmaker,
      captured_at: entry.captured_at,
      over_decimal: overSel.odd,
      under_decimal: underSel.odd,
      over_pct: overPct,
      under_pct: underPct,
    };
  });

  const draft: OverUnderInputV3 = {
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
    lines,
    scoreline_model: buildScorelineModel(args.scorelineModel),
  } satisfies OverUnderInputV3;

  const parsed = OverUnderInputV3Schema.safeParse(draft);
  if (!parsed.success) {
    throw new BuildInputError("OverUnderInputV3Schema validation failed", {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

export type { SideOrientation };
