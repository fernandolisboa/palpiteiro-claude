import { z } from "zod";

// ─── Input schema ────────────────────────────────────────────────────────────
// Espelha over_under/schemas.ts (mercado binário). ÚNICA diferença estrutural:
// odds/implied são yes/no SEM linha (btts não tem `point`/linha). Os schemas de
// dados de suporte (form/standing/h2h/absences/lineup) são byte-idênticos — são
// duplicados por cartucho (não há módulo compartilhado), conforme o padrão atual.

const TeamRefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});

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
  // Ver over_under/schemas.ts: true quando o provider retornou lesões (mesmo
  // lista vazia), false quando o provider não suporta lesões pra este jogo. O
  // prompt rewira: absences=[] sob absences_available=false significa "sem dados".
  absences_available: z.boolean(),
  absences: z.array(PlayerAbsenceSchema),
  lineup: LineupSchema.optional(),
});

// btts: SEM linha — odds são yes/no diretos (não há `point`/2.5).
const OddsSchema = z.object({
  bookmaker: z.string().min(1),
  yes_decimal: z.number().positive(),
  no_decimal: z.number().positive(),
  captured_at: z.string().datetime(),
});

// Já normalizado pelo overround upstream — nunca `1 / odd` cru.
const ImpliedProbabilitiesSchema = z.object({
  yes_pct: z.number().min(0).max(100),
  no_pct: z.number().min(0).max(100),
});

const MatchSchema = z.object({
  id: z.string().min(1),
  home_team: TeamRefSchema,
  away_team: TeamRefSchema,
  league: z.string().min(1),
  kickoff_at: z.string().datetime(),
  venue: z.string().min(1).optional(),
});

export const BttsInputSchema = z.object({
  match: MatchSchema,
  home: TeamDataSchema,
  away: TeamDataSchema,
  h2h: z.array(H2HMatchSchema).max(20),
  odds: OddsSchema,
  implied: ImpliedProbabilitiesSchema,
});

export type BttsInput = z.infer<typeof BttsInputSchema>;

// ─── Output schema ───────────────────────────────────────────────────────────

const RecommendationSchema = z.enum(["yes", "no", "pass"]);

// Prose tolerante (igual over_under): o LLM passar o schema da ferramenta mas
// estourar um limite de chars NUNCA pode descartar uma recomendação válida (#45).
const RATIONALE_MAX_CHARS = 2000; // teto de segurança; MAX_TOKENS já limita o output
const KEY_FACTOR_MAX_CHARS = 300;
const KEY_FACTORS_MAX_COUNT = 5;

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

// Convenção sobre `confidence_pct`:
// - Para `recommendation` ∈ {"yes","no"}: probabilidade estimada (0-100) do LADO
//   RECOMENDADO.
// - Para `recommendation = "pass"`: probabilidade estimada do modelo para "yes"
//   (NÃO é "confiança no pass"). Mantém a semântica comparável com
//   `implied.yes_pct` em análises retrospectivas.
export const BttsOutputSchema = z
  .object({
    recommendation: RecommendationSchema,
    confidence_pct: z.number().min(0).max(100),
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
        message:
          "minimum_odd is required when recommendation is 'yes' or 'no'",
      });
    }
  });

export type BttsOutput = z.infer<typeof BttsOutputSchema>;
