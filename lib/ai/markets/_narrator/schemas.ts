import { z } from "zod";

import {
  KEY_FACTOR_MAX_CHARS,
  KEY_FACTORS_MAX,
  KEY_FACTORS_MIN,
  RATIONALE_MAX_CHARS,
} from "./prompt";

// Output do narrador: SÓ racional + fatores. `.strict()` rejeita qualquer campo a
// mais (probabilidade, lado, stake) — o LLM não tem por onde mexer na decisão.
export const NarratorOutputSchema = z
  .object({
    rationale: z.string().trim().min(1).max(RATIONALE_MAX_CHARS),
    key_factors: z
      .array(z.string().trim().min(1).max(KEY_FACTOR_MAX_CHARS))
      .min(KEY_FACTORS_MIN)
      .max(KEY_FACTORS_MAX),
  })
  .strict();

export type NarratorOutput = z.infer<typeof NarratorOutputSchema>;
