import { eq } from "drizzle-orm";

import { aiConfig } from "@/db/schema";
import { db } from "@/lib/db";
import { DEFAULT_MODEL_ID, isAIModelId, type AIModelId } from "@/lib/ai/models";
import {
  DEFAULT_ANALYSIS_ENGINE,
  isAnalysisEngine,
  type AnalysisEngine,
} from "@/lib/ai/engine/analysis-engine";
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
 * Feature-flag (#175): as linhas EXTRAS de over/under (1.5/3.5 via o cartucho
 * multi-linha over_under_v3.0) estão ligadas? Lê do single-row (id=1); default OFF
 * (false) quando não há row — o caminho de hoje (featured 2.5, byte-idêntico). Flip
 * data-driven (sem deploy): true → todos os usuários recebem a análise multi-linha
 * onde há cobertura de alternate_totals (world_cup).
 */
export async function getEnableOverUnderExtraLines(): Promise<boolean> {
  const rows = await db
    .select({ enabled: aiConfig.enableOverUnderExtraLines })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  return rows[0]?.enabled ?? false;
}

/**
 * Feature-flag (#178): o modo "melhor aposta do jogo" (fan-out cross-mercado em
 * código) está ligado? Lê do single-row (id=1); default OFF (false) quando não há
 * row — só o analyze single-market de hoje. Flip data-driven (sem deploy): true → a
 * CTA "Analisar todos os mercados" aparece pra todos os usuários onde há ≥2 mercados
 * candidatos. Independente de getEnableOverUnderExtraLines (que governa a multi-linha).
 */
export async function getEnableBestBetFanOut(): Promise<boolean> {
  const rows = await db
    .select({ enabled: aiConfig.enableBestBetFanOut })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  return rows[0]?.enabled ?? false;
}

/**
 * Feature-flag (#180): a CAPTURA da closing line (snapshot pré-kickoff que alimenta
 * o CLV) está ligada? Lê do single-row (id=1); default OFF (false) quando não há row
 * — zero gasto de quota. Flip data-driven (sem deploy): true → o cron
 * capture-closing-odds passa a buscar odds perto do KO só pra jogos com predição
 * non-pass. A EXIBIÇÃO do CLV é independente desta flag (sempre on; mostra null sem dado).
 */
export async function getEnableClvCapture(): Promise<boolean> {
  const rows = await db
    .select({ enabled: aiConfig.enableClvCapture })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  return rows[0]?.enabled ?? false;
}

/**
 * Feature-flag (#380): a VALIDAÇÃO DE FIDELIDADE pós-síntese está ligada? Lê do
 * single-row (id=1); default ON (true) — DUPLAMENTE seguro: a COLUNA default é true E
 * o fallback de no-row é `?? true`, então um DB fresco/vazio (testes, primeiro deploy)
 * também valida por padrão, casando o intent ON-dia-1 e exercitando o caminho real sem
 * seed. Flip data-driven (sem deploy): UPDATE ai_config SET enable_fidelity_validation =
 * false WHERE id = 1 → validação pulada, comportamento de hoje, ZERO custo extra. Default
 * INVERTIDO vs. as flags acima (que são OFF-by-default) — o padrão sem-gates do dono.
 */
export async function getEnableFidelityValidation(): Promise<boolean> {
  const rows = await db
    .select({ enabled: aiConfig.enableFidelityValidation })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  return rows[0]?.enabled ?? true;
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

/**
 * Kill-switch (#503, ADR 0039 D3): o staking quarter-Kelly pode ser usado? Default
 * ON quando não há row. NÃO liga o Kelly sozinho: o predict também exige o gate do
 * Kelly "pronto" (isKellyStakingActive). false → bandas do ADR 0019 sempre.
 */
export async function getEnableKellyStaking(): Promise<boolean> {
  const rows = await db
    .select({ enabled: aiConfig.enableKellyStaking })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  return rows[0]?.enabled ?? true;
}

/**
 * Motor de análise (ADR 0041 §5, #511): 'llm' (cartucho de mercado decide — caminho
 * de hoje) ou 'code_jev' (código + julgamentos JEV decidem, LLM narra). Sem row ou
 * valor persistido inválido → 'llm'.
 */
export async function getAnalysisEngine(): Promise<AnalysisEngine> {
  const rows = await db
    .select({ analysisEngine: aiConfig.analysisEngine })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  const stored = rows[0]?.analysisEngine;
  return isAnalysisEngine(stored) ? stored : DEFAULT_ANALYSIS_ENGINE;
}

/**
 * Upsert do motor de análise (single-row id=1), editado em /admin/settings. Grava
 * quem alterou pra auditoria. O valor já vem validado da server action.
 */
export async function setAnalysisEngine(
  engine: AnalysisEngine,
  userId: string,
): Promise<void> {
  await db
    .insert(aiConfig)
    .values({
      id: 1,
      defaultModelId: DEFAULT_MODEL_ID,
      analysisEngine: engine,
      updatedByUserId: userId,
    })
    .onConflictDoUpdate({
      target: aiConfig.id,
      set: {
        analysisEngine: engine,
        updatedByUserId: userId,
        updatedAt: new Date(),
      },
    });
}
