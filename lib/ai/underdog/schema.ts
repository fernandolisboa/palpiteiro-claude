import { z } from "zod";

import {
  ADVOCATE_MAX_SENTENCES,
  ADVOCATE_MIN_SENTENCES,
  ADVOCATE_SENTENCE_MAX,
  MAX_FACTS_PER_SENTENCE,
} from "./advocate-cartridge";
import { COUNTERPOINT_MAX, REVIEW_REASON_MAX } from "./review-cartridge";

// Saídas das ferramentas do painel do azarão (#671), fail-closed: campo a mais, id de
// fato fora do formato ou fora dos limites reprova.

export const UnderdogCaseSchema = z
  .object({
    frases: z
      .array(
        z
          .object({
            texto: z.string().trim().min(1).max(ADVOCATE_SENTENCE_MAX),
            fatos: z
              .array(z.string().regex(/^[PSCFM]\d{1,2}$/))
              .min(1)
              .max(MAX_FACTS_PER_SENTENCE),
          })
          .strict()
      )
      .min(ADVOCATE_MIN_SENTENCES)
      .max(ADVOCATE_MAX_SENTENCES),
  })
  .strict();
export type UnderdogCase = z.infer<typeof UnderdogCaseSchema>;

export const UnderdogReviewSchema = z
  .object({
    avaliacoes: z
      .array(
        z
          .object({
            indice: z
              .number()
              .int()
              .min(0)
              .max(ADVOCATE_MAX_SENTENCES - 1),
            veredito: z.enum(["apoiada", "exagerada", "sem_base"]),
            motivo: z.string().trim().min(1).max(REVIEW_REASON_MAX),
          })
          .strict()
      )
      .min(1)
      .max(ADVOCATE_MAX_SENTENCES),
    contraponto: z.string().trim().min(1).max(COUNTERPOINT_MAX),
  })
  .strict();
export type UnderdogReview = z.infer<typeof UnderdogReviewSchema>;
