import { z } from "zod";

// API-Football's `errors` field can be an empty array, an empty object, or an
// object mapping error keys (e.g. "token", "rateLimit") to messages.
const ApiFootballErrorsSchema = z.union([
  z.array(z.string()),
  z.record(z.string(), z.string()),
]);

export function envelope<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    get: z.string(),
    parameters: z.unknown(),
    errors: ApiFootballErrorsSchema,
    results: z.number().int().nonnegative(),
    paging: z.object({
      current: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
    response: z.array(item),
  });
}

export type ApiFootballEnvelope<T> = {
  get: string;
  parameters: unknown;
  errors: string[] | Record<string, string>;
  results: number;
  paging: { current: number; total: number };
  response: T[];
};

export function envelopeErrorsAreEmpty(
  errors: string[] | Record<string, string>,
): boolean {
  if (Array.isArray(errors)) return errors.length === 0;
  return Object.keys(errors).length === 0;
}

const ScoreLineSchema = z.object({
  home: z.number().nullable(),
  away: z.number().nullable(),
});

const FixtureStatusSchema = z.object({
  long: z.string(),
  short: z.string(),
  elapsed: z.number().nullable(),
});

const TeamRefSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  winner: z.boolean().nullable().optional(),
});

const LeagueRefSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  country: z.string().nullable().optional(),
  season: z.number().int(),
  round: z.string().nullable().optional(),
});

export const FixtureItemSchema = z.object({
  fixture: z.object({
    id: z.number().int(),
    date: z.string(),
    timestamp: z.number().int(),
    timezone: z.string().optional(),
    status: FixtureStatusSchema,
    venue: z
      .object({
        id: z.number().int().nullable(),
        name: z.string().nullable(),
        city: z.string().nullable(),
      })
      .partial()
      .optional(),
  }),
  league: LeagueRefSchema,
  teams: z.object({
    home: TeamRefSchema,
    away: TeamRefSchema,
  }),
  goals: ScoreLineSchema,
  score: z.object({
    halftime: ScoreLineSchema,
    fulltime: ScoreLineSchema,
    extratime: ScoreLineSchema.nullable(),
    penalty: ScoreLineSchema.nullable(),
  }),
});

export type ApiFootballFixture = z.infer<typeof FixtureItemSchema>;

const LineupPlayerSchema = z.object({
  player: z.object({
    id: z.number().int().nullable(),
    name: z.string(),
    number: z.number().int().nullable(),
    pos: z.string().nullable(),
    grid: z.string().nullable(),
  }),
});

export const LineupItemSchema = z.object({
  team: z.object({
    id: z.number().int(),
    name: z.string(),
  }),
  formation: z.string().nullable().optional(),
  startXI: z.array(LineupPlayerSchema).optional().default([]),
  substitutes: z.array(LineupPlayerSchema).optional().default([]),
  coach: z
    .object({
      id: z.number().int().nullable(),
      name: z.string().nullable(),
    })
    .nullable()
    .optional(),
});

export type ApiFootballLineup = z.infer<typeof LineupItemSchema>;

const StandingSplitSchema = z.object({
  played: z.number().int().nonnegative(),
  win: z.number().int().nonnegative(),
  draw: z.number().int().nonnegative(),
  lose: z.number().int().nonnegative(),
  goals: z.object({
    for: z.number().int(),
    against: z.number().int(),
  }),
});

const StandingRowSchema = z.object({
  rank: z.number().int(),
  team: z.object({
    id: z.number().int(),
    name: z.string(),
  }),
  points: z.number().int(),
  goalsDiff: z.number().int(),
  group: z.string().nullable().optional(),
  form: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  all: StandingSplitSchema,
  home: StandingSplitSchema,
  away: StandingSplitSchema,
  update: z.string(),
});

export const StandingsItemSchema = z.object({
  league: z.object({
    id: z.number().int(),
    name: z.string(),
    country: z.string().nullable().optional(),
    season: z.number().int(),
    standings: z.array(z.array(StandingRowSchema)),
  }),
});

export type ApiFootballStandings = z.infer<typeof StandingsItemSchema>;

export const InjuryItemSchema = z.object({
  player: z.object({
    id: z.number().int(),
    name: z.string(),
    photo: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
  }),
  team: z.object({
    id: z.number().int(),
    name: z.string(),
  }),
  fixture: z
    .object({
      id: z.number().int().nullable(),
      timezone: z.string().nullable().optional(),
      date: z.string().nullable().optional(),
      timestamp: z.number().int().nullable().optional(),
    })
    .partial()
    .optional(),
  league: z
    .object({
      id: z.number().int(),
      season: z.number().int(),
      name: z.string().nullable().optional(),
    })
    .partial()
    .optional(),
});

export type ApiFootballInjury = z.infer<typeof InjuryItemSchema>;

export const StatusResponseSchema = z.object({
  get: z.string(),
  parameters: z.unknown(),
  errors: ApiFootballErrorsSchema,
  results: z.number().int().nonnegative(),
  response: z.object({
    account: z
      .object({
        firstname: z.string().nullable().optional(),
        lastname: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
      })
      .partial()
      .optional(),
    subscription: z
      .object({
        plan: z.string().nullable().optional(),
        end: z.string().nullable().optional(),
        active: z.boolean().nullable().optional(),
      })
      .partial()
      .optional(),
    requests: z.object({
      current: z.number().int().nonnegative(),
      limit_day: z.number().int().nonnegative(),
    }),
  }),
});

export type ApiFootballStatus = z.infer<typeof StatusResponseSchema>;

export const FixtureEnvelopeSchema = envelope(FixtureItemSchema);
export const LineupEnvelopeSchema = envelope(LineupItemSchema);
export const StandingsEnvelopeSchema = envelope(StandingsItemSchema);
export const InjuryEnvelopeSchema = envelope(InjuryItemSchema);
