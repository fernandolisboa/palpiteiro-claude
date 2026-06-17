import { z } from "zod";

// ─── Input schema ────────────────────────────────────────────────────────────

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
  // Proveniência (ADR 0026, #226): `source` distingue oficial de fallback não-oficial
  // (o prompt pondera a confiança). `confidence`/`capturedAt` ficam pro #227 popular.
  // TODOS opcionais (additive) — hoje só `source:"official"` é preenchido.
  source: z.enum(["official", "unofficial"]).optional(),
  confidence: z.number().min(0).max(100).optional(),
  capturedAt: z.string().datetime().optional(),
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
  // for this fixture/team. The prompt rewires accordingly so the AI knows
  // an empty `absences` array under absences_available=false means "no data"
  // (do NOT assume zero), while absences=[] under absences_available=true
  // means "no injuries reported".
  absences_available: z.boolean(),
  absences: z.array(PlayerAbsenceSchema),
  lineup: LineupSchema.optional(),
});

const OddsSchema = z.object({
  bookmaker: z.string().min(1),
  over_2_5_decimal: z.number().positive(),
  under_2_5_decimal: z.number().positive(),
  captured_at: z.string().datetime(),
});

// Already normalized by overround upstream — never `1 / odd` raw.
const ImpliedProbabilitiesSchema = z.object({
  over_pct: z.number().min(0).max(100),
  under_pct: z.number().min(0).max(100),
});

const MatchSchema = z.object({
  id: z.string().min(1),
  home_team: TeamRefSchema,
  away_team: TeamRefSchema,
  league: z.string().min(1),
  kickoff_at: z.string().datetime(),
  venue: z.string().min(1).optional(),
});

export const OverUnderInputSchema = z.object({
  match: MatchSchema,
  home: TeamDataSchema,
  away: TeamDataSchema,
  h2h: z.array(H2HMatchSchema).max(20),
  odds: OddsSchema,
  implied: ImpliedProbabilitiesSchema,
});

export type OverUnderInput = z.infer<typeof OverUnderInputSchema>;

// Re-export ADITIVO das sub-schemas de contexto (match/home/away/h2h) pro v3
// reaproveitar EXATAMENTE o mesmo shape sem redefinir. Não altera os exports v2.
export {
  MatchSchema as OverUnderMatchSchema,
  TeamDataSchema as OverUnderTeamDataSchema,
  H2HMatchSchema as OverUnderH2HMatchSchema,
};

// ─── Input schema v3 (multi-linha, #175) ─────────────────────────────────────

// Uma linha da escada: a meia-linha avaliada + odds over/under + implícita já
// de-vigada (Σ=1 por linha). Substitui o par único `odds`/`implied` do v2 por uma
// lista; o resto do contexto (match/home/away/h2h) é IDÊNTICO ao v2.
const LineEntrySchema = z.object({
  line: z.number(),
  bookmaker: z.string().min(1),
  captured_at: z.string().datetime(),
  over_decimal: z.number().positive(),
  under_decimal: z.number().positive(),
  over_pct: z.number().min(0).max(100),
  under_pct: z.number().min(0).max(100),
});

export const OverUnderInputV3Schema = z.object({
  match: MatchSchema,
  home: TeamDataSchema,
  away: TeamDataSchema,
  h2h: z.array(H2HMatchSchema).max(20),
  lines: z.array(LineEntrySchema).min(1),
});

export type OverUnderInputV3 = z.infer<typeof OverUnderInputV3Schema>;

// ─── Output schema ───────────────────────────────────────────────────────────

const RecommendationSchema = z.enum(["over", "under", "pass"]);

// Prose fields (rationale, key_factors) are tolerant: the LLM passing the tool
// schema but overshooting a char limit must NEVER discard a valid bet
// recommendation (#45). The tool's maxLength is only a guide — the API doesn't
// enforce it — so we truncate gracefully instead of rejecting. We keep the
// cheap lower floors (.min(1)) because empty prose is degenerate, not "too
// long". The bet-decision fields below stay strictly validated.
const RATIONALE_MAX_CHARS = 2000; // safety ceiling; MAX_TOKENS already bounds output
const KEY_FACTOR_MAX_CHARS = 300;
const KEY_FACTORS_MAX_COUNT = 5;

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

// Convenção sobre `confidence_pct`:
// - Para `recommendation` ∈ {"over","under"}: probabilidade estimada (0-100) do
//   LADO RECOMENDADO.
// - Para `recommendation = "pass"`: probabilidade estimada do modelo para
//   "over" (NÃO é "confiança no pass"). Mantém a semântica comparável com
//   `implied.over_pct` em análises retrospectivas.
export const OverUnderOutputSchema = z
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
          "minimum_odd is required when recommendation is 'over' or 'under'",
      });
    }
  });

export type OverUnderOutput = z.infer<typeof OverUnderOutputSchema>;

// ─── Output schema v3 (multi-linha, #175) ────────────────────────────────────

// Meias-linhas válidas que o modelo pode escolher numa análise multi-linha.
// Espelha OVER_UNDER_ALT.candidateLines. `line` é OBRIGATÓRIO mesmo em "pass" (o
// modelo reporta a linha que avaliou como mais próxima de apostável → predict
// persiste em marketParams.line pra view; settlement ignora em pass).
const VALID_LINES = [1.5, 2.5, 3.5] as const;

// Mesma tolerância de prosa do v2 (RATIONALE/KEY_FACTOR), mesma convenção de
// confidence_pct e o MESMO superRefine de minimum_odd (omitido sse 'pass'); ADICIONA
// `line` obrigatório com .refine pra meia-linha válida.
export const OverUnderOutputV3Schema = z
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
    line: z
      .number()
      .refine((l) => (VALID_LINES as readonly number[]).includes(l), {
        message: "line must be one of 1.5, 2.5, 3.5",
      }),
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
          "minimum_odd is required when recommendation is 'over' or 'under'",
      });
    }
  });

export type OverUnderOutputV3 = z.infer<typeof OverUnderOutputV3Schema>;
