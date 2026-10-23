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
  errors: string[] | Record<string, string>
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
  // Acréscimos do tempo em andamento (`elapsed 45, extra 2` = 45+2'). INFERIDO da
  // documentação da API-Football (#580/#591), não visto em payload real: opcional e
  // nullable, chave ausente não derruba o parse; valor fora do formato vira null em vez
  // de derrubar o envelope (que serve também sync, settlement e a busca por data).
  // Validar com a chave num jogo ao vivo.
  extra: z.number().int().nullable().optional().catch(null),
});

const TeamRefSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  winner: z.boolean().nullable().optional(),
  // Escudo (#578). Tolerante de propósito: um logo malformado não pode derrubar o
  // parse do fixture inteiro; a validação fica no safeCrestUrl.
  logo: z.string().nullable().optional(),
});

const LeagueRefSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  country: z.string().nullable().optional(),
  season: z.number().int(),
  round: z.string().nullable().optional(),
});

// Item de /fixtures/events?fixture={id} (#290): cada evento do jogo (gol,
// cartão, substituição, VAR). Tolerante (Zod descarta chaves extras): só
// `time.elapsed`, `team`, `player`, `assist`, `type`, `detail` são load-bearing
// pro settlement de scorer/assist. `player.id`/`assist.id` podem faltar (fio NÃO
// verificado ao vivo, liga pausada) → nullable + match por nome canônico no
// fallback. `type` é "Goal"/"Card"/"subst"/"Var"; `detail` distingue "Normal
// Goal"/"Penalty"/"Own Goal"/"Missed Penalty".
export const FixtureEventItemSchema = z.object({
  time: z.object({
    elapsed: z.number().int().nullable(),
    extra: z.number().int().nullable().optional(),
  }),
  team: z
    .object({
      id: z.number().int().nullable().optional(),
      name: z.string().nullable().optional(),
    })
    .optional(),
  player: z
    .object({
      id: z.number().int().nullable().optional(),
      name: z.string().nullable().optional(),
    })
    .optional(),
  assist: z
    .object({
      id: z.number().int().nullable().optional(),
      name: z.string().nullable().optional(),
    })
    .optional(),
  type: z.string(),
  detail: z.string().nullable().optional(),
  // "Penalty Shootout" marca as cobranças da disputa de pênaltis (visto ao vivo, #600).
  comments: z.string().nullable().optional(),
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
  // Eventos do jogo. Só a busca por id (`/fixtures?id=`) os traz junto (confirmado em
  // payload real, #600); a busca por data/liga não. Tolerante em dobro: chave ausente → undefined, e um evento malformado também
  // vira undefined (`.catch`) em vez de derrubar o fixture inteiro: quem lê trata
  // undefined como "sem dados de eventos" (expulsões desconhecidas).
  events: z.array(FixtureEventItemSchema).optional().catch(undefined),
});

export type ApiFootballFixture = z.infer<typeof FixtureItemSchema>;

export type ApiFootballFixtureEvent = z.infer<typeof FixtureEventItemSchema>;
export const FixtureEventEnvelopeSchema = envelope(FixtureEventItemSchema);

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

// Home/away splits come back with all-null fields (or the whole object null)
// for competitions without home/away records — e.g. the World Cup, where every
// match is at a neutral venue, and pre-tournament before any match is played.
const NullableStandingSplitSchema = z
  .object({
    played: z.number().int().nonnegative().nullable(),
    win: z.number().int().nonnegative().nullable(),
    draw: z.number().int().nonnegative().nullable(),
    lose: z.number().int().nonnegative().nullable(),
    goals: z.object({
      for: z.number().int().nullable(),
      against: z.number().int().nullable(),
    }),
  })
  .nullable();

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
  home: NullableStandingSplitSchema,
  away: NullableStandingSplitSchema,
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

// /teams?league&season — só id e nome importam (resolução de team id em runtime).
const TeamItemSchema = z.object({
  team: z.object({
    id: z.number().int().positive(),
    name: z.string(),
  }),
});
export type ApiFootballTeamItem = z.infer<typeof TeamItemSchema>;

// Item de /players/topscorers?league&season (#617). Tolerante: só o nome, o time e os
// gols de cada linha de `statistics` são load-bearing (a 1ª linha é a da competição
// pedida; num time trocado no meio da temporada pode haver mais de uma).
export const TopScorerItemSchema = z.object({
  player: z.object({
    id: z.number().int().nullable().optional(),
    name: z.string().min(1),
  }),
  statistics: z.array(
    z.object({
      team: z.object({
        id: z.number().int().nullable().optional(),
        name: z.string().min(1),
      }),
      goals: z
        .object({ total: z.number().int().nullable().optional() })
        .partial()
        .optional(),
    })
  ),
});

export type ApiFootballTopScorer = z.infer<typeof TopScorerItemSchema>;

export const FixtureEnvelopeSchema = envelope(FixtureItemSchema);
export const TeamEnvelopeSchema = envelope(TeamItemSchema);
export const LineupEnvelopeSchema = envelope(LineupItemSchema);
export const StandingsEnvelopeSchema = envelope(StandingsItemSchema);
export const InjuryEnvelopeSchema = envelope(InjuryItemSchema);
export const TopScorerEnvelopeSchema = envelope(TopScorerItemSchema);
