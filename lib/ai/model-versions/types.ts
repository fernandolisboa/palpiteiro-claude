import { z } from "zod";

import type { ModelFamily } from "@/lib/ai/models";

// Tipos e schemas puros da adoção automática de versões (PLAN-608, ADR 0062). Sem
// `db`: db/schema.ts, a query layer, o resolver e o cron importam daqui.

// Preço por 1M de tokens, no formato do `AIModel` (lib/ai/models.ts). Gravado em
// `model_versions.pricing` e validado na leitura: uma row com preço inválido nunca
// vira o modelo de uma análise.
export const ModelPricingSchema = z.object({
  inputPricePerMTok: z.number().nonnegative(),
  outputPricePerMTok: z.number().nonnegative(),
  longPromptPricing: z
    .object({
      aboveInputTokens: z.number().int().positive(),
      inputPricePerMTok: z.number().nonnegative(),
      outputPricePerMTok: z.number().nonnegative(),
    })
    .optional(),
});

export type ModelPricing = z.infer<typeof ModelPricingSchema>;

export const MODEL_VERSION_STATUSES = ["active", "superseded", "failed"] as const;
export type ModelVersionStatus = (typeof MODEL_VERSION_STATUSES)[number];

export const MODEL_FAMILIES = ["opus", "sonnet", "haiku"] as const satisfies readonly ModelFamily[];

// Resumo enxuto da última checagem (ai_config.model_versions_check_summary). O
// `transient` carrega, de um dia pro outro, desde quando um candidato só falha por
// erro transitório (N5: 7 dias seguidos → `failed`).
export const ModelVersionsCheckSummarySchema = z.object({
  status: z.enum(["ok", "disabled", "listing_failed"]),
  adopted: z.array(z.string()).default([]),
  failed: z.array(z.object({ id: z.string(), reason: z.string() })).default([]),
  transient: z
    .array(
      z.object({
        id: z.string(),
        family: z.enum(MODEL_FAMILIES),
        since: z.string(),
        reason: z.string(),
      }),
    )
    .default([]),
  pinnedMissing: z.array(z.string()).default([]),
  error: z.string().optional(),
  emailError: z.string().optional(),
});

export type ModelVersionsCheckSummary = z.infer<typeof ModelVersionsCheckSummarySchema>;

// Chamadas de produção de um modelo numa janela e quantas saíram ruins (S2).
export type CallOutcomeCounts = { total: number; bad: number };
