import { z } from "zod";

const RecommendationSchema = z.enum(["over", "under", "pass"]);

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
    rationale: z.string().min(1).max(600),
    key_factors: z.array(z.string().min(1).max(160)).min(2).max(5),
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
