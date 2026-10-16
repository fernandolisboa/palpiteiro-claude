import { and, desc, eq, gte, inArray, lt, ne, notLike, sql } from "drizzle-orm";

import { aiCalls, aiConfig, modelVersions } from "@/db/schema";
import { db } from "@/lib/db";
import { DEFAULT_MODEL_ID, type ModelFamily } from "@/lib/ai/models";
import {
  ModelPricingSchema,
  ModelVersionsCheckSummarySchema,
  type CallOutcomeCounts,
  type ModelPricing,
  type ModelVersionsCheckSummary,
} from "@/lib/ai/model-versions/types";

// Boundary única de `model_versions` e das colunas de checagem de `ai_config` (ADR
// 0062). NÃO importa lib/db/queries/ai-config.ts: ~27 arquivos de teste mockam aquele
// módulo com factory, e o seam (adopted-versions → active → aqui) roda em todos eles.

export type ModelVersionRow = typeof modelVersions.$inferSelect;

export type ActiveModelState = {
  // Kill switch `ai_config.enable_auto_model_versions` (default ON sem row).
  enabled: boolean;
  // As rows `active` (no máximo uma por família). Vazio quando desligado.
  active: ModelVersionRow[];
};

/** Kill switch + versões ativas, lidos direto do banco pro resolver do seam. */
export async function getActiveModelState(): Promise<ActiveModelState> {
  const [config] = await db
    .select({ enabled: aiConfig.enableAutoModelVersions })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  const enabled = config?.enabled ?? true;
  if (!enabled) return { enabled, active: [] };
  const active = await db
    .select()
    .from(modelVersions)
    .where(eq(modelVersions.status, "active"));
  return { enabled, active };
}

/** Todas as versões conhecidas, mais novas primeiro (painel e cron). */
export async function listModelVersions(): Promise<ModelVersionRow[]> {
  return db
    .select()
    .from(modelVersions)
    .orderBy(desc(modelVersions.createdAt), modelVersions.id);
}

export type ModelVersionInput = {
  id: string;
  family: ModelFamily;
  displayName: string;
  apiCreatedAt: Date | null;
  capabilities: unknown;
  maxTokens: number | null;
  pricing: ModelPricing;
  probeAiCallId: string | null;
};

/**
 * Adota a versão: rebaixa a `active` da família e insere a nova como `active`. Um
 * db.batch é uma transação no neon-http (padrão de team-ratings.ts); um CTE não
 * serve, porque o índice parcial único é checado antes do UPDATE do próprio CTE (23505).
 */
export async function adoptModelVersion(
  input: ModelVersionInput,
  now: Date = new Date(),
): Promise<void> {
  await db.batch([
    db
      .update(modelVersions)
      .set({ status: "superseded", updatedAt: now })
      .where(
        and(
          eq(modelVersions.family, input.family),
          eq(modelVersions.status, "active"),
        ),
      ),
    db.insert(modelVersions).values({
      ...input,
      capabilities: input.capabilities ?? null,
      status: "active",
      adoptedAt: now,
      createdAt: now,
      updatedAt: now,
    }),
  ]);
}

/** Grava uma versão reprovada (capabilities, sondagem). Repetir é no-op. */
export async function recordFailedVersion(
  input: ModelVersionInput & { reason: string },
  now: Date = new Date(),
): Promise<void> {
  const { reason, ...row } = input;
  await db
    .insert(modelVersions)
    .values({
      ...row,
      capabilities: row.capabilities ?? null,
      status: "failed",
      failureReason: reason,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: modelVersions.id });
}

/**
 * Marca uma versão em uso como `failed`. Idempotente: só a primeira marcação vale
 * (uma versão já `failed` mantém o motivo original). Devolve se mudou algo.
 */
export async function markModelVersionFailed(
  id: string,
  reason: string,
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(modelVersions)
    .set({ status: "failed", failureReason: reason, updatedAt: now })
    .where(and(eq(modelVersions.id, id), ne(modelVersions.status, "failed")))
    .returning({ id: modelVersions.id });
  return rows.length > 0;
}

export const REJECTED_BY_ADMIN_REASON = "rejeitada pelo admin";

/** "Rejeitar esta versão" do admin: vira `failed` e a família volta pra conferida. */
export async function rejectModelVersion(
  id: string,
  now: Date = new Date(),
): Promise<boolean> {
  return markModelVersionFailed(id, REJECTED_BY_ADMIN_REASON, now);
}

/**
 * Confirma o preço oficial (input/output por 1M). A tarifa de prompt longo herdada,
 * se houver, fica como está. Os custos já gravados em ai_calls NÃO são reescritos
 * (auditoria imutável): o preço vale a partir das próximas chamadas.
 */
export async function confirmModelVersionPrice(
  id: string,
  price: { inputPricePerMTok: number; outputPricePerMTok: number },
  now: Date = new Date(),
): Promise<boolean> {
  const [row] = await db
    .select({ pricing: modelVersions.pricing })
    .from(modelVersions)
    .where(eq(modelVersions.id, id))
    .limit(1);
  if (!row) return false;
  const stored = ModelPricingSchema.safeParse(row.pricing);
  const pricing: ModelPricing = {
    ...price,
    ...(stored.success && stored.data.longPromptPricing
      ? { longPromptPricing: stored.data.longPromptPricing }
      : {}),
  };
  const rows = await db
    .update(modelVersions)
    .set({ pricing, priceConfirmedAt: now, updatedAt: now })
    .where(eq(modelVersions.id, id))
    .returning({ id: modelVersions.id });
  return rows.length > 0;
}

export type ModelVersionsCheck = {
  checkedAt: Date | null;
  summary: ModelVersionsCheckSummary | null;
};

/** Última checagem do cron (null = nunca rodou, ou resumo ilegível). */
export async function getModelVersionsCheck(): Promise<ModelVersionsCheck> {
  const [row] = await db
    .select({
      checkedAt: aiConfig.modelVersionsCheckedAt,
      summary: aiConfig.modelVersionsCheckSummary,
    })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  if (!row) return { checkedAt: null, summary: null };
  const parsed = ModelVersionsCheckSummarySchema.safeParse(row.summary);
  return {
    checkedAt: row.checkedAt,
    summary: parsed.success ? parsed.data : null,
  };
}

/** Grava a checagem. O insert (DB sem row) precisa do defaultModelId NOT NULL. */
export async function setModelVersionsCheck(
  summary: ModelVersionsCheckSummary,
  now: Date = new Date(),
): Promise<void> {
  await db
    .insert(aiConfig)
    .values({
      id: 1,
      defaultModelId: DEFAULT_MODEL_ID,
      modelVersionsCheckedAt: now,
      modelVersionsCheckSummary: summary,
    })
    .onConflictDoUpdate({
      target: aiConfig.id,
      set: {
        modelVersionsCheckedAt: now,
        modelVersionsCheckSummary: summary,
      },
    });
}

/**
 * Chamadas de produção de um modelo numa janela, e quantas saíram ruins (S2):
 * `tool_missing`, `invalid_output` ou recusa do modelo (`stop_reason: refusal` na
 * resposta crua). A sondagem (`model_probe_*`) fica de fora.
 */
export async function countCallOutcomes(args: {
  model: string;
  from: Date;
  to: Date;
}): Promise<CallOutcomeCounts> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      bad: sql<number>`count(*) filter (where ${inArray(aiCalls.status, [
        "tool_missing",
        "invalid_output",
      ])} or ${aiCalls.outputPayload}->>'stop_reason' = 'refusal')::int`,
    })
    .from(aiCalls)
    .where(
      and(
        eq(aiCalls.model, args.model),
        eq(aiCalls.provider, "anthropic"),
        gte(aiCalls.createdAt, args.from),
        lt(aiCalls.createdAt, args.to),
        notLike(aiCalls.promptVersion, "model_probe_%"),
      ),
    );
  return { total: Number(row?.total ?? 0), bad: Number(row?.bad ?? 0) };
}
