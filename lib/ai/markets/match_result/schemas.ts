import { z } from "zod";

// ─── Input schema ────────────────────────────────────────────────────────────
//
// MESMOS campos de supportingData do OverUnderInput (match, home/away com
// form/standings/absences/lineup, h2h) — só o bloco odds/implied muda de binário
// (over/under) pra 3-vias (home/draw/away). O 1X2 é decidido SOBRE os mesmos
// dados de sports-data; só a fronteira de mercado é N=3.

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
  // for this fixture/team. Same semantics as over_under — see that schema.
  absences_available: z.boolean(),
  absences: z.array(PlayerAbsenceSchema),
  lineup: LineupSchema.optional(),
});

// Odds 3-vias (home/draw/away decimals). Espelha OddsSchema do over_under, mas o
// par binário vira tríade.
const OddsSchema = z.object({
  bookmaker: z.string().min(1),
  home_decimal: z.number().positive(),
  draw_decimal: z.number().positive(),
  away_decimal: z.number().positive(),
  captured_at: z.string().datetime(),
});

// Já normalizadas pelo overround do mercado COMPLETO (Σ 1/odd sobre as 3) — nunca
// `1 / odd` cru. Em N≥3 cada seleção tem seu próprio implied (ADR 0018).
const ImpliedProbabilitiesSchema = z.object({
  home_pct: z.number().min(0).max(100),
  draw_pct: z.number().min(0).max(100),
  away_pct: z.number().min(0).max(100),
});

const MatchSchema = z.object({
  id: z.string().min(1),
  home_team: TeamRefSchema,
  away_team: TeamRefSchema,
  league: z.string().min(1),
  kickoff_at: z.string().datetime(),
  venue: z.string().min(1).optional(),
});

export const MatchResultInputSchema = z.object({
  match: MatchSchema,
  home: TeamDataSchema,
  away: TeamDataSchema,
  h2h: z.array(H2HMatchSchema).max(20),
  odds: OddsSchema,
  implied: ImpliedProbabilitiesSchema,
});

export type MatchResultInput = z.infer<typeof MatchResultInputSchema>;

// ─── Output schema (OPTION B: per-selection probabilities) ───────────────────

const RecommendationSchema = z.enum(["home", "draw", "away", "pass"]);

// Prose fields (rationale, key_factors) são tolerantes: o LLM passando o schema
// da tool mas estourando um limite de char NUNCA pode descartar uma recomendação
// válida (#45). O maxLength da tool é só um guia (a API não força) — truncamos em
// vez de rejeitar. Os campos de DECISÃO ficam estritos. Espelha over_under.
const RATIONALE_MAX_CHARS = 2000; // safety ceiling; MAX_TOKENS já limita o output
const KEY_FACTOR_MAX_CHARS = 300;
const KEY_FACTORS_MAX_COUNT = 5;

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

// Convenção sobre `confidence_pct` (espelha over_under):
// - Para `recommendation` ∈ {"home","draw","away"}: probabilidade estimada
//   (0-100) do LADO RECOMENDADO (= prob_home/prob_draw/prob_away daquele lado).
// - Para `recommendation = "pass"`: probabilidade estimada do modelo para "home"
//   (NÃO é "confiança no pass"). Convenção pra manter comparabilidade com
//   `implied.home_pct` em análises retrospectivas.
//
// As 3 probs (prob_home/prob_draw/prob_away) são a DISTRIBUIÇÃO completa do
// modelo: alimentam a grade de cenários (edge por seleção). NÃO rejeitamos se não
// somam exatamente 100 — tolerância (ADR 0012-D8: sem rechecks). Cada uma é só
// clampada ao range [0,100] pelo Zod; a normalização defensiva, se necessária,
// vive no consumidor da grade, não aqui.
export const MatchResultOutputSchema = z
  .object({
    recommendation: RecommendationSchema,
    confidence_pct: z.number().min(0).max(100),
    prob_home: z.number().min(0).max(100),
    prob_draw: z.number().min(0).max(100),
    prob_away: z.number().min(0).max(100),
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
          "minimum_odd is required when recommendation is 'home', 'draw' or 'away'",
      });
    }
  });

export type MatchResultOutput = z.infer<typeof MatchResultOutputSchema>;
