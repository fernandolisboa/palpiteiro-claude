import { z } from "zod";

// ─── Input schema ────────────────────────────────────────────────────────────
//
// MESMOS campos de supportingData do MatchResultInput (match, home/away com
// form/standings/absences/lineup, h2h) — só o bloco odds/implied muda pras 3
// DUPLAS (home_or_draw=1X / away_or_draw=X2 / home_or_away=12). A dupla chance é
// decidida SOBRE os mesmos dados de sports-data; só a fronteira de mercado é a
// cobertura de pares.

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
  // Per-side: true when the provider returned an injuries response (even if
  // empty list), false when the active provider does not support injury data
  // for this fixture/team. Same semantics as match_result.
  absences_available: z.boolean(),
  absences: z.array(PlayerAbsenceSchema),
  lineup: LineupSchema.optional(),
});

// Odds das 3 duplas (1X/X2/12). Espelha o OddsSchema do match_result, mas a
// tríade home/draw/away vira a tríade de pares.
const OddsSchema = z.object({
  bookmaker: z.string().min(1),
  home_or_draw_decimal: z.number().positive(),
  away_or_draw_decimal: z.number().positive(),
  home_or_away_decimal: z.number().positive(),
  captured_at: z.string().datetime(),
});

// Implícitas de-vigadas mantendo a semântica de PAR (ADR 0018 + emenda
// não-partição): as 3 duplas se sobrepõem, então SOMAM ~200% (não 100). Cada
// dupla é ≤100% (a cobertura de um par nunca passa de certeza) — por isso o clamp
// [0,100] por campo segue válido. Nunca `1/odd` cru.
const ImpliedProbabilitiesSchema = z.object({
  home_or_draw_pct: z.number().min(0).max(100),
  away_or_draw_pct: z.number().min(0).max(100),
  home_or_away_pct: z.number().min(0).max(100),
});

const MatchSchema = z.object({
  id: z.string().min(1),
  home_team: TeamRefSchema,
  away_team: TeamRefSchema,
  league: z.string().min(1),
  kickoff_at: z.string().datetime(),
  venue: z.string().min(1).optional(),
});

export const DoubleChanceInputSchema = z.object({
  match: MatchSchema,
  home: TeamDataSchema,
  away: TeamDataSchema,
  h2h: z.array(H2HMatchSchema).max(20),
  odds: OddsSchema,
  implied: ImpliedProbabilitiesSchema,
});

export type DoubleChanceInput = z.infer<typeof DoubleChanceInputSchema>;

// ─── Output schema (OPTION B: per-selection probabilities) ───────────────────

const RecommendationSchema = z.enum([
  "home_or_draw",
  "away_or_draw",
  "home_or_away",
  "pass",
]);

// Prose fields tolerantes (mesma decisão do match_result/#45): truncar, nunca
// rejeitar; os campos de DECISÃO ficam estritos.
const RATIONALE_MAX_CHARS = 2000; // safety ceiling; MAX_TOKENS já limita o output
const KEY_FACTOR_MAX_CHARS = 300;
const KEY_FACTORS_MAX_COUNT = 5;

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

// Convenção sobre `confidence_pct` (espelha match_result):
// - Para `recommendation` ∈ {home_or_draw, away_or_draw, home_or_away}:
//   probabilidade estimada (0-100) da DUPLA RECOMENDADA (= prob_<dupla>).
// - Para `recommendation = "pass"`: probabilidade estimada do modelo para
//   "home_or_draw" (NÃO é "confiança no pass"). Convenção pra comparabilidade
//   com `implied.home_or_draw_pct` em análises retrospectivas.
//
// As 3 probs são as probabilidades HONESTAS de cada dupla — elas SE SOBREPÕEM e
// SOMAM ~200% (cada par cobre 2 de 3 resultados). NÃO rejeitamos se não somam um
// valor específico (ADR 0012-D8: sem rechecks). Cada uma é clampada a [0,100]; a
// implícita vem na MESMA escala (de-vig Σ=2), então o edge por dupla é honesto.
export const DoubleChanceOutputSchema = z
  .object({
    recommendation: RecommendationSchema,
    confidence_pct: z.number().min(0).max(100),
    prob_home_or_draw: z.number().min(0).max(100),
    prob_away_or_draw: z.number().min(0).max(100),
    prob_home_or_away: z.number().min(0).max(100),
    rationale: z
      .string()
      .min(1)
      .transform((s) => truncate(s, RATIONALE_MAX_CHARS)),
    key_factors: z
      .array(
        z.string().min(1).transform((s) => truncate(s, KEY_FACTOR_MAX_CHARS)),
      )
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
          "minimum_odd is required when recommendation is a double chance selection",
      });
    }
  });

export type DoubleChanceOutput = z.infer<typeof DoubleChanceOutputSchema>;
