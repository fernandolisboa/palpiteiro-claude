import { z } from "zod";

// Schemas COMPARTILHADOS dos cartuchos independent_binary (artilheiro/assist,
// #290). Diferente dos mercados de partição (over_under/correct_score), o conjunto
// de seleções é DINÂMICO (um jogador por seleção, descoberto no fetch de odds) —
// `player_probs`/`odds`/`implied` são records FREE-FORM (key → number), não records
// refinados a um conjunto fixo de chaves.

// Sub-schemas de sports-data — MESMOS campos que match_result/correct_score
// (duplicados por convenção, um por família de cartucho).
const RecentMatchSchema = z.object({
  date: z.string().datetime(),
  opponent: z.string().min(1),
  home_or_away: z.enum(["home", "away"]),
  goals_for: z.number().int().nonnegative(),
  goals_against: z.number().int().nonnegative(),
  result: z.enum(["W", "D", "L"]),
});

const TeamFormSchema = z.object({
  matches: z.array(RecentMatchSchema).max(20),
});

const H2HMatchSchema = z.object({
  date: z.string().datetime(),
  home_team: z.string().min(1),
  away_team: z.string().min(1),
  score_home: z.number().int().nonnegative(),
  score_away: z.number().int().nonnegative(),
});

const StandingSplitSchema = z.object({
  played: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  draws: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  goals_for: z.number().int().nonnegative(),
  goals_against: z.number().int().nonnegative(),
});

const StandingSchema = z.object({
  position: z.number().int().positive(),
  played: z.number().int().nonnegative(),
  points: z.number().int().nonnegative(),
  goals_for: z.number().int().nonnegative(),
  goals_against: z.number().int().nonnegative(),
  home_split: StandingSplitSchema.optional(),
  away_split: StandingSplitSchema.optional(),
});

const PlayerRoleSchema = z.enum(["GK", "DEF", "MID", "FWD"]);

const PlayerAbsenceSchema = z.object({
  player: z.string().min(1),
  role: PlayerRoleSchema,
  status: z.enum(["injured", "suspended", "doubtful"]),
});

const LineupPlayerSchema = z.object({
  player: z.string().min(1),
  role: PlayerRoleSchema,
});

const LineupSchema = z.object({
  formation: z.string().min(1).optional(),
  starters: z.array(LineupPlayerSchema).length(11),
});

const TeamDataSchema = z.object({
  form: TeamFormSchema,
  standing: StandingSchema,
  absences_available: z.boolean(),
  absences: z.array(PlayerAbsenceSchema),
  lineup: LineupSchema.optional(),
});

const MatchSchema = z.object({
  id: z.string().min(1),
  home_team: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  away_team: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  league: z.string().min(1),
  kickoff_at: z.string().datetime(),
  venue: z.string().min(1).optional(),
});

// Um jogador cotado (seleção dinâmica): key estável (scorer_<slug>/assist_<slug>),
// NOME exibível, odd `yes` e a implícita-TETO ((1/odd)*100). Não há lado `no`.
const QuotedPlayerSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  odd: z.number().positive(),
  implied_ceiling_pct: z.number().min(0).max(100),
});

export const ScorerInputSchema = z.object({
  match: MatchSchema,
  home: TeamDataSchema,
  away: TeamDataSchema,
  h2h: z.array(H2HMatchSchema).max(20),
  bookmaker: z.string().min(1),
  captured_at: z.string().datetime(),
  // Jogadores cotados (≥1). O conjunto é dinâmico; o cartucho NÃO refina chaves.
  players: z.array(QuotedPlayerSchema).min(1),
});

export type ScorerInput = z.infer<typeof ScorerInputSchema>;

// ─── Output (per-player probabilidade yes) ───────────────────────────────────

const RATIONALE_MAX_CHARS = 2000;
const KEY_FACTOR_MAX_CHARS = 300;
const KEY_FACTORS_MAX_COUNT = 5;

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

// `player_probs` é a prob `yes` (0-100) POR jogador — INDEPENDENTES (NÃO somam 100,
// correto pra binários independentes). Record free-form (chaves dinâmicas). NÃO
// rejeita se faltar algum jogador — predict coalesce ausências a 0 na grade.
export const ScorerOutputSchema = z
  .object({
    // selectionKey do jogador escolhido (= uma key de `players`) ou "pass".
    recommendation: z.string().min(1),
    confidence_pct: z.number().min(0).max(100),
    player_probs: z.record(z.string(), z.number().min(0).max(100)),
    rationale: z
      .string()
      .min(1)
      .transform((s) => truncate(s, RATIONALE_MAX_CHARS)),
    key_factors: z
      .array(z.string().min(1).transform((s) => truncate(s, KEY_FACTOR_MAX_CHARS)))
      .min(1)
      .transform((arr) => arr.slice(0, KEY_FACTORS_MAX_COUNT)),
    minimum_odd: z.number().positive().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.recommendation === "pass" && data.minimum_odd !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minimum_odd"],
        message: "minimum_odd must be omitted when recommendation is 'pass'",
      });
    }
    if (data.recommendation !== "pass" && data.minimum_odd === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minimum_odd"],
        message: "minimum_odd is required when recommendation is a player",
      });
    }
    // O jogador recomendado PRECISA ter uma prob finita em `player_probs` (espelha
    // a garantia do correct_score, cujo `recommendation` é enum e `cell_probs` é
    // refinado a conter todas as células). Sem isso, `modelProbByKey[side]` seria
    // undefined no predict → `undefined − implied = NaN` persistido em numeric +
    // stake colapsado a 1u silenciosamente. Outros jogadores podem faltar (a grade
    // coalesce a null), mas o RECOMENDADO não.
    if (
      data.recommendation !== "pass" &&
      !Number.isFinite(data.player_probs[data.recommendation])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["player_probs"],
        message:
          "player_probs must contain a finite probability for the recommended player",
      });
    }
  });

export type ScorerOutput = z.infer<typeof ScorerOutputSchema>;
