import { z } from "zod";

const RecommendationSchema = z.enum(["over", "under", "pass"]);

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
