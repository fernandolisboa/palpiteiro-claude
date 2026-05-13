import { z } from "zod";

// ─── Common shapes ──────────────────────────────────────────────────────────

const TeamRefSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  shortName: z.string().nullable().optional(),
  tla: z.string().nullable().optional(),
  crest: z.string().nullable().optional(),
});

const SeasonRefSchema = z
  .object({
    id: z.number().int(),
    startDate: z.string(),
    endDate: z.string(),
    currentMatchday: z.number().int().nullable().optional(),
    winner: z.unknown().nullable().optional(),
  })
  .partial()
  .passthrough();

const CompetitionRefSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  code: z.string(),
  type: z.string(),
  emblem: z.string().nullable().optional(),
});

const AreaRefSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    code: z.string().nullable().optional(),
    flag: z.string().nullable().optional(),
  })
  .passthrough();

const ScoreLineSchema = z.object({
  home: z.number().int().nullable(),
  away: z.number().int().nullable(),
});

const ScoreSchema = z
  .object({
    winner: z.string().nullable().optional(),
    duration: z.string().nullable().optional(),
    fullTime: ScoreLineSchema,
    halfTime: ScoreLineSchema.optional(),
    extraTime: ScoreLineSchema.optional(),
    penalties: ScoreLineSchema.optional(),
  })
  .passthrough();

const LineupEntrySchema = z.object({
  id: z.number().int().nullable().optional(),
  name: z.string(),
  position: z.string().nullable().optional(),
  shirtNumber: z.number().int().nullable().optional(),
});

const TeamWithLineupSchema = TeamRefSchema.extend({
  lineup: z.array(LineupEntrySchema).optional(),
  bench: z.array(LineupEntrySchema).optional(),
  formation: z.string().nullable().optional(),
});

// ─── Match schemas ──────────────────────────────────────────────────────────

export const MatchSchema = z.object({
  id: z.number().int(),
  utcDate: z.string(),
  status: z.string(),
  matchday: z.number().int().nullable().optional(),
  stage: z.string().nullable().optional(),
  group: z.string().nullable().optional(),
  lastUpdated: z.string().nullable().optional(),
  homeTeam: TeamRefSchema,
  awayTeam: TeamRefSchema,
  score: ScoreSchema,
  area: AreaRefSchema.optional(),
  competition: CompetitionRefSchema.optional(),
  season: SeasonRefSchema.optional(),
  odds: z.unknown().optional(),
  referees: z.array(z.unknown()).optional(),
  venue: z.string().nullable().optional(),
});

export type FootballDataOrgMatch = z.infer<typeof MatchSchema>;

// /v4/matches/{id} — single match with optional lineup data on team objects.
export const MatchByIdSchema = MatchSchema.extend({
  homeTeam: TeamWithLineupSchema,
  awayTeam: TeamWithLineupSchema,
});

export type FootballDataOrgMatchWithLineup = z.infer<typeof MatchByIdSchema>;

// /v4/competitions/{code}/matches and /v4/teams/{id}/matches both return a
// matches list with the same wrapping shape, just different filters/meta.
export const MatchesListSchema = z.object({
  filters: z.unknown().optional(),
  resultSet: z.unknown().optional(),
  count: z.number().int().optional(),
  competition: CompetitionRefSchema.optional(),
  matches: z.array(MatchSchema),
});

export type FootballDataOrgMatchesList = z.infer<typeof MatchesListSchema>;

// ─── Standings schemas ──────────────────────────────────────────────────────

export const StandingRowSchema = z.object({
  position: z.number().int(),
  team: TeamRefSchema,
  playedGames: z.number().int(),
  form: z.string().nullable().optional(),
  won: z.number().int(),
  draw: z.number().int(),
  lost: z.number().int(),
  points: z.number().int(),
  goalsFor: z.number().int(),
  goalsAgainst: z.number().int(),
  goalDifference: z.number().int(),
});

export const StandingsEntrySchema = z.object({
  stage: z.string().nullable().optional(),
  type: z.string(), // TOTAL | HOME | AWAY
  group: z.string().nullable().optional(),
  table: z.array(StandingRowSchema),
});

export const StandingsResponseSchema = z.object({
  filters: z.unknown().optional(),
  area: AreaRefSchema.optional(),
  competition: CompetitionRefSchema.optional(),
  season: SeasonRefSchema.optional(),
  standings: z.array(StandingsEntrySchema),
});

export type FootballDataOrgStandingsResponse = z.infer<
  typeof StandingsResponseSchema
>;
