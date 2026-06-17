import { z } from "zod";

// ─── Input schema ────────────────────────────────────────────────────────────
//
// MESMOS campos de supportingData do MatchResultInput (match, home/away com
// form/standings/absences/lineup, h2h — duplicados por convenção, um por
// cartucho) — só o bloco odds/implied muda de 3-vias (1X2) pra 16 células
// (placar exato, grid 0..3 × 0..3). O correct score é decidido SOBRE os mesmos
// dados de sports-data; só a fronteira de mercado é N=16.

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
  // for this fixture/team. Same semantics as match_result — see that schema.
  absences_available: z.boolean(),
  absences: z.array(PlayerAbsenceSchema),
  lineup: LineupSchema.optional(),
});

// As 16 chaves canônicas do grid (home 0..3 × away 0..3), row-major. ESPELHA
// CORRECT_SCORE.selectionKeys — qualquer divergência é bug de seed/descriptor.
export const CORRECT_SCORE_KEYS = [
  "cs_0_0", "cs_0_1", "cs_0_2", "cs_0_3",
  "cs_1_0", "cs_1_1", "cs_1_2", "cs_1_3",
  "cs_2_0", "cs_2_1", "cs_2_2", "cs_2_3",
  "cs_3_0", "cs_3_1", "cs_3_2", "cs_3_3",
] as const;

// Refina um record a conter EXATAMENTE as 16 chaves do grid (book/dist incompleto
// = bug, dropado upstream em build-input). Helper pra reuso odds/implied/cell_probs.
function refineSixteenCells<T>(rec: Record<string, T>): boolean {
  return CORRECT_SCORE_KEYS.every((k) => k in rec);
}

// Record de odds das 16 células (decimais). Substitui o OddsSchema 3-vias do
// match_result. `bookmaker`/`captured_at` carregam o metadado do book único; o
// `cells` mapeia cada chave cs_H_A → odd decimal.
const OddsSchema = z.object({
  bookmaker: z.string().min(1),
  cells: z
    .record(z.string(), z.number().positive())
    .refine(refineSixteenCells, {
      message: "odds must contain all 16 correct-score cells (cs_0_0..cs_3_3)",
    }),
  captured_at: z.string().datetime(),
});

// Já normalizadas sobre a MESMA grid limitada de 16 (Σ 1/odd sobre as 16 células
// → Σ implied = 100%). Espelha o ImpliedProbabilitiesSchema do match_result, mas
// como record das 16 chaves. Cada célula tem seu próprio implied (ADR 0018).
const ImpliedProbabilitiesSchema = z
  .record(z.string(), z.number().min(0).max(100))
  .refine(refineSixteenCells, {
    message: "implied must contain all 16 correct-score cells (cs_0_0..cs_3_3)",
  });

const MatchSchema = z.object({
  id: z.string().min(1),
  home_team: TeamRefSchema,
  away_team: TeamRefSchema,
  league: z.string().min(1),
  kickoff_at: z.string().datetime(),
  venue: z.string().min(1).optional(),
});

export const CorrectScoreInputSchema = z.object({
  match: MatchSchema,
  home: TeamDataSchema,
  away: TeamDataSchema,
  h2h: z.array(H2HMatchSchema).max(20),
  odds: OddsSchema,
  implied: ImpliedProbabilitiesSchema,
});

export type CorrectScoreInput = z.infer<typeof CorrectScoreInputSchema>;

// ─── Output schema (OPTION B: per-cell probabilities) ────────────────────────

// A recomendação é uma das 16 células OU "pass". z.enum aceita um array literal,
// então construímos a partir das chaves canônicas + "pass".
const RecommendationSchema = z.enum([...CORRECT_SCORE_KEYS, "pass"]);

// Prose fields (rationale, key_factors) são tolerantes: o LLM passando o schema
// da tool mas estourando um limite de char NUNCA pode descartar uma recomendação
// válida (#45). O maxLength da tool é só um guia (a API não força) — truncamos em
// vez de rejeitar. Os campos de DECISÃO ficam estritos. Espelha match_result.
const RATIONALE_MAX_CHARS = 2000; // safety ceiling; MAX_TOKENS já limita o output
const KEY_FACTOR_MAX_CHARS = 300;
const KEY_FACTORS_MAX_COUNT = 5;

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

// `cell_probs` é a DISTRIBUIÇÃO completa do modelo sobre as 16 células: alimenta
// a grade de cenários (edge por seleção). Cada prob é clampada ao range [0,100]
// pelo Zod e o record deve conter EXATAMENTE as 16 chaves. NÃO rejeitamos se não
// somam exatamente 100 — tolerância (ADR 0012-D8: sem rechecks). A normalização
// defensiva, se necessária, vive no consumidor da grade, não aqui.
const CellProbsSchema = z
  .record(z.string(), z.number().min(0).max(100))
  .refine(refineSixteenCells, {
    message: "cell_probs must contain all 16 correct-score cells (cs_0_0..cs_3_3)",
  });

// Convenção sobre `confidence_pct` (espelha match_result):
// - Para `recommendation` ∈ {16 células}: probabilidade estimada (0-100) da
//   CÉLULA RECOMENDADA (= cell_probs[recommendation]).
// - Para `recommendation = "pass"`: probabilidade estimada do modelo para a
//   célula mais provável (NÃO é "confiança no pass").
export const CorrectScoreOutputSchema = z
  .object({
    recommendation: RecommendationSchema,
    confidence_pct: z.number().min(0).max(100),
    cell_probs: CellProbsSchema,
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
          "minimum_odd is required when recommendation is a correct-score cell",
      });
    }
  });

export type CorrectScoreOutput = z.infer<typeof CorrectScoreOutputSchema>;
