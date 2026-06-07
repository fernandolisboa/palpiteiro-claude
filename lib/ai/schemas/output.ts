import { z } from "zod";

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
