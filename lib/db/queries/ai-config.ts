import { eq } from "drizzle-orm";

import { aiConfig } from "@/db/schema";
import { db } from "@/lib/db";
import { DEFAULT_MODEL_ID, isAIModelId, type AIModelId } from "@/lib/ai/models";
import {
  GENERATION_PARAM_DEFAULTS,
  isEffort,
  isValidMaxTokens,
  isValidTemperature,
  type GenerationParams,
} from "@/lib/ai/generation-params";

// Boundary única de leitura/escrita da config global de IA em ai_config (single
// row, id=1): o default global de modelo E os parâmetros de geração
// (max_tokens/effort/temperature — ADR 0008, emenda 2).

/**
 * Default global de modelo. Se não houver row (DB vazio em testes) OU o valor
 * persistido falhar a validação contra o registry (registry encolheu / dado
 * ruim), cai no DEFAULT_MODEL_ID — um id stale/inválido nunca chega ao Anthropic
 * como 404 de modelo.
 */
export async function getDefaultModelId(): Promise<AIModelId> {
  const rows = await db
    .select({ defaultModelId: aiConfig.defaultModelId })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  const stored = rows[0]?.defaultModelId;
  if (stored && isAIModelId(stored)) return stored;
  return DEFAULT_MODEL_ID;
}

/**
 * Upsert do default global (single-row id=1). Grava quem alterou pra auditoria.
 */
export async function setDefaultModelId(
  modelId: AIModelId,
  userId: string,
): Promise<void> {
  await db
    .insert(aiConfig)
    .values({ id: 1, defaultModelId: modelId, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: aiConfig.id,
      set: {
        defaultModelId: modelId,
        updatedByUserId: userId,
        updatedAt: new Date(),
      },
    });
}

/**
 * Parâmetros de geração (ADR 0008, emenda 2). Lê do single-row (id=1) e cai nos
 * defaults seguros POR CAMPO se a row não existir ou o valor persistido for
 * inválido — espelha o fallback de getDefaultModelId (nunca manda lixo pro
 * Anthropic). `temperature` é numeric → string no Drizzle, convertido aqui.
 */
export async function getGenerationParams(): Promise<GenerationParams> {
  const rows = await db
    .select({
      maxTokens: aiConfig.maxTokens,
      effort: aiConfig.effort,
      temperature: aiConfig.temperature,
    })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  const row = rows[0];
  if (!row) return GENERATION_PARAM_DEFAULTS;

  const temperatureNum = Number(row.temperature);
  const maxTokens = isValidMaxTokens(row.maxTokens)
    ? row.maxTokens
    : GENERATION_PARAM_DEFAULTS.maxTokens;
  const effort = isEffort(row.effort)
    ? row.effort
    : GENERATION_PARAM_DEFAULTS.effort;
  const temperature = isValidTemperature(temperatureNum)
    ? temperatureNum
    : GENERATION_PARAM_DEFAULTS.temperature;

  // Observabilidade: se um valor persistido cai no default (DB editado direto,
  // registry encolheu, etc.) o swap é silencioso e some o sintoma. Avisa só
  // quando ALGUM campo de fato divergiu — DB vazio (sem row) é normal e não loga.
  if (
    maxTokens !== row.maxTokens ||
    effort !== row.effort ||
    temperature !== temperatureNum
  ) {
    console.warn(
      JSON.stringify({
        scope: "getGenerationParams",
        warning: "stored generation param out of range; usando default",
        stored: {
          maxTokens: row.maxTokens,
          effort: row.effort,
          temperature: row.temperature,
        },
        used: { maxTokens, effort, temperature },
      }),
    );
  }

  return { maxTokens, effort, temperature };
}

/**
 * Upsert dos parâmetros de geração (single-row id=1). Grava quem alterou pra
 * auditoria. Os valores já vêm validados da server action. `temperature` é
 * numeric → string no Drizzle.
 */
export async function setGenerationParams(
  params: GenerationParams,
  userId: string,
): Promise<void> {
  await db
    .insert(aiConfig)
    .values({
      id: 1,
      defaultModelId: DEFAULT_MODEL_ID,
      maxTokens: params.maxTokens,
      effort: params.effort,
      temperature: params.temperature.toFixed(2),
      updatedByUserId: userId,
    })
    .onConflictDoUpdate({
      target: aiConfig.id,
      set: {
        maxTokens: params.maxTokens,
        effort: params.effort,
        temperature: params.temperature.toFixed(2),
        updatedByUserId: userId,
        updatedAt: new Date(),
      },
    });
}
