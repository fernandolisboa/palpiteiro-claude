import { eq } from "drizzle-orm";

import { aiConfig } from "@/db/schema";
import { db } from "@/lib/db";
import { DEFAULT_MODEL_ID, isAIModelId, type AIModelId } from "@/lib/ai/models";

// Boundary única de leitura/escrita do default global de modelo. O default é
// um único row (id=1).

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
