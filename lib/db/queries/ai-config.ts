import { eq } from "drizzle-orm";

import { aiConfig } from "@/db/schema";
import { db } from "@/lib/db";
import {
  DEFAULT_MODEL_ID,
  MODEL_REGISTRY,
  resolveModelId,
  type AIModelId,
} from "@/lib/ai/models";
import {
  DEFAULT_ANALYSIS_ENGINE,
  isAnalysisEngine,
  type AnalysisEngine,
} from "@/lib/ai/engine/analysis-engine";
import {
  GENERATION_PARAM_DEFAULTS,
  isEffort,
  isValidMaxTokens,
  type GenerationParams,
} from "@/lib/ai/generation-params";
import {
  ADMIN_FLAGS,
  adminFlagDefaults,
  coerceStoredFlagValue,
  type AdminFlagKey,
  type AdminFlagValue,
  type AdminFlagValues,
} from "@/lib/config/admin-flags";

// Boundary única de leitura/escrita da config global de IA em ai_config (single
// row, id=1): o default global de modelo E os parâmetros de geração
// (max_tokens/effort — ADR 0008, emenda 2; a coluna temperature ficou sem uso no ADR 0061).

/**
 * Default global de modelo. Se não houver row (DB vazio em testes) OU o valor
 * persistido não resolver pra um modelo do registry, cai no DEFAULT_MODEL_ID — um id
 * inválido nunca chega ao Anthropic como 404 de modelo. Um id de versão antiga
 * (ex.: `claude-haiku-4-5`, ADR 0061) é lido como o 5.5 da mesma família, sem
 * reescrever a row. O default vale pra TODOS (ADR 0013): um id admin-only
 * (`userSelectable: false`) também cai no DEFAULT_MODEL_ID, pra um usuário comum
 * nunca rodar um modelo que não poderia escolher. O setter já recusa isso; aqui é a
 * defesa contra dado gravado por fora dele.
 */
export async function getDefaultModelId(): Promise<AIModelId> {
  const rows = await db
    .select({ defaultModelId: aiConfig.defaultModelId })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  const stored = resolveModelId(rows[0]?.defaultModelId);
  if (stored && MODEL_REGISTRY[stored].userSelectable) return stored;
  return DEFAULT_MODEL_ID;
}

/**
 * Upsert do default global (single-row id=1). Grava quem alterou pra auditoria.
 */
export async function setDefaultModelId(
  modelId: AIModelId,
  userId: string
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
 * Anthropic).
 */
export async function getGenerationParams(): Promise<GenerationParams> {
  const rows = await db
    .select({
      maxTokens: aiConfig.maxTokens,
      effort: aiConfig.effort,
    })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  const row = rows[0];
  if (!row) return GENERATION_PARAM_DEFAULTS;

  const maxTokens = isValidMaxTokens(row.maxTokens)
    ? row.maxTokens
    : GENERATION_PARAM_DEFAULTS.maxTokens;
  const effort = isEffort(row.effort)
    ? row.effort
    : GENERATION_PARAM_DEFAULTS.effort;

  // Observabilidade: se um valor persistido cai no default (DB editado direto,
  // registry encolheu, etc.) o swap é silencioso e some o sintoma. Avisa só
  // quando ALGUM campo de fato divergiu — DB vazio (sem row) é normal e não loga.
  if (maxTokens !== row.maxTokens || effort !== row.effort) {
    console.warn(
      JSON.stringify({
        scope: "getGenerationParams",
        warning: "stored generation param out of range; usando default",
        stored: {
          maxTokens: row.maxTokens,
          effort: row.effort,
        },
        used: { maxTokens, effort },
      })
    );
  }

  return { maxTokens, effort };
}

/**
 * Upsert dos parâmetros de geração (single-row id=1). Grava quem alterou pra
 * auditoria. Os valores já vêm validados da server action.
 */
export async function setGenerationParams(
  params: GenerationParams,
  userId: string
): Promise<void> {
  await db
    .insert(aiConfig)
    .values({
      id: 1,
      defaultModelId: DEFAULT_MODEL_ID,
      maxTokens: params.maxTokens,
      effort: params.effort,
      updatedByUserId: userId,
    })
    .onConflictDoUpdate({
      target: aiConfig.id,
      set: {
        maxTokens: params.maxTokens,
        effort: params.effort,
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
 * Kill-switch do Dixon-Coles em produção (ADR 0051). Default ON quando não há row.
 * false → o λ vem sempre do heurístico da tabela (ADR 0037).
 */
export async function getEnableDixonColes(): Promise<boolean> {
  const rows = await db
    .select({ enabled: aiConfig.enableDixonColes })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  return rows[0]?.enabled ?? true;
}

/**
 * Kill-switch do fan-out paralelo do "Analisar com IA". Default ON quando não há row.
 * false → os mercados rodam em série, como antes (lib/ai/best-bet.ts).
 */
export async function getEnableParallelFanOut(): Promise<boolean> {
  const rows = await db
    .select({ enabled: aiConfig.enableParallelFanOut })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  return rows[0]?.enabled ?? true;
}

/**
 * Kill-switch do JEV da base do modelo por jogo (#555, ADR 0052). Default ON quando não
 * há row. false → o cron compute-match-models grava a base só com o Dixon-Coles (ou o
 * heurístico da tabela), sem chamada JEV.
 */
export async function getEnableMatchModelJev(): Promise<boolean> {
  const rows = await db
    .select({ enabled: aiConfig.enableMatchModelJev })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  return rows[0]?.enabled ?? true;
}

/**
 * Kill-switch do LLM do "Seu palpite" (#564, ADR 0055) e do contexto extra da análise
 * (#565). Default ON quando não há row. false → o bloco mostra só a leitura pelos
 * botões (grátis, sem IA), que nunca é gateada.
 */
export async function getEnableUserContext(): Promise<boolean> {
  const rows = await db
    .select({ enabled: aiConfig.enableUserContext })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  return rows[0]?.enabled ?? true;
}

/**
 * Kill-switch do modo ao vivo (#580, ADR 0060). Default ON quando não há row. false →
 * tudo fecha no apito como antes e nada busca o estado ao vivo na API-Football.
 */
export async function getEnableLiveMode(): Promise<boolean> {
  const rows = await db
    .select({ enabled: aiConfig.enableLiveMode })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  return rows[0]?.enabled ?? true;
}

/**
 * Kill-switch das versões novas automáticas (ADR 0062). Default ON quando não há row.
 * false → o seam roda só as conferidas do registry. O seam NÃO lê daqui (lê via
 * lib/db/queries/model-versions.ts, getActiveModelState); este getter é do cron.
 */
export async function getEnableAutoModelVersions(): Promise<boolean> {
  const rows = await db
    .select({ enabled: aiConfig.enableAutoModelVersions })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  return rows[0]?.enabled ?? true;
}

/**
 * Kill-switch do "Explicar com IA" na avaliação das apostas registradas (#562, ADR
 * 0063). Default ON quando não há row. false → o painel mostra só a avaliação em
 * código, sem o botão.
 */
export async function getEnableBetSlipExplain(): Promise<boolean> {
  const rows = await db
    .select({ enabled: aiConfig.enableBetSlipExplain })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  return rows[0]?.enabled ?? true;
}

/**
 * Kill-switch da reconferência com a escalação (#619, PR B). Default ON quando não há
 * row. false → o cron recheck-lineups sai sem tocar em provider nem gravar nada.
 */
export async function getEnableLineupRecheck(): Promise<boolean> {
  const rows = await db
    .select({ enabled: aiConfig.enableLineupRecheck })
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  return rows[0]?.enabled ?? true;
}

/**
 * Motor de análise (ADR 0041 §5, #511): 'llm' (cartucho de mercado decide — caminho
 * de hoje) ou 'code_jev' (código + julgamentos JEV decidem, LLM narra). Sem row ou
 * valor persistido inválido → 'llm'. Editado em /admin/settings via registry
 * (lib/config/admin-flags.ts, entrada enum `analysisEngine`).
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
 * Valores atuais de TODAS as flags do registry (#514) pro /admin/settings. Lê a
 * row uma vez; sem row → defaults do registry; valor persistido inválido → default
 * da entrada. Só pra exibição/edição: o runtime continua lendo pelos getters acima.
 */
export async function getAdminFlagValues(): Promise<AdminFlagValues> {
  const rows = await db
    .select()
    .from(aiConfig)
    .where(eq(aiConfig.id, 1))
    .limit(1);
  const row = rows[0];
  if (!row) return adminFlagDefaults();
  return Object.fromEntries(
    ADMIN_FLAGS.map((f) => [f.key, coerceStoredFlagValue(f, row[f.key])])
  ) as AdminFlagValues;
}

/**
 * Upsert de UMA flag do registry (single-row id=1). Grava quem alterou pra
 * auditoria. O valor já vem validado da server action (validateAdminFlagInput).
 * O insert (DB sem row) precisa do defaultModelId NOT NULL, como setGenerationParams.
 */
export async function setAdminFlag(
  key: AdminFlagKey,
  value: AdminFlagValue,
  userId: string
): Promise<void> {
  // Chave computada perde o tipo por coluna no Drizzle; o par key/value já foi
  // checado contra o registry (validateAdminFlagInput) antes de chegar aqui.
  const patch = { [key]: value } as Partial<typeof aiConfig.$inferInsert>;
  await db
    .insert(aiConfig)
    .values({
      id: 1,
      defaultModelId: DEFAULT_MODEL_ID,
      ...patch,
      updatedByUserId: userId,
    })
    .onConflictDoUpdate({
      target: aiConfig.id,
      set: { ...patch, updatedByUserId: userId, updatedAt: new Date() },
    });
}
