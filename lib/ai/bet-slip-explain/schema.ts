import { z } from "zod";

import {
  EXPLAIN_SUMMARY_MAX,
  EXPLAIN_TEXT_MAX,
  MAX_EXPLAIN_LEGS,
} from "./cartridge";

// Saída da ferramenta submit_bet_explanation (#562), fail-closed: campo a mais, índice
// fora da faixa ou texto vazio reprovam e a explicação vira o template.
export const BetExplanationSchema = z
  .object({
    resumo: z.string().trim().min(1).max(EXPLAIN_SUMMARY_MAX),
    pernas: z
      .array(
        z
          .object({
            indice: z
              .number()
              .int()
              .min(0)
              .max(MAX_EXPLAIN_LEGS - 1),
            texto: z.string().trim().min(1).max(EXPLAIN_TEXT_MAX),
          })
          .strict()
      )
      .max(MAX_EXPLAIN_LEGS),
    combinada: z.string().trim().min(1).max(EXPLAIN_TEXT_MAX).nullable(),
  })
  .strict();

export type BetExplanation = z.infer<typeof BetExplanationSchema>;
