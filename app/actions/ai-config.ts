"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { isModelAllowedForAudience } from "@/lib/ai/models";
import {
  isEffort,
  isValidMaxTokens,
  isValidTemperature,
  MAX_TOKENS_MAX,
  MAX_TOKENS_MIN,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
} from "@/lib/ai/generation-params";
import { isAnalysisEngine } from "@/lib/ai/engine/analysis-engine";
import {
  setAnalysisEngine,
  setDefaultModelId,
  setGenerationParams,
} from "@/lib/db/queries/ai-config";

export type UpdateDefaultModelResult = { ok: boolean; error?: string };

export async function updateDefaultModel(
  _prev: UpdateDefaultModelResult | null,
  formData: FormData,
): Promise<UpdateDefaultModelResult> {
  const session = await auth();
  // Server actions são POST chamáveis FORA do layout (que gateia /admin/**),
  // então a role é revalidada AQUI — defense-in-depth além de esconder a UI.
  if (session?.user?.role !== "admin" || !session.user.id) {
    return { ok: false, error: "Acesso negado." };
  }

  const modelId = String(formData.get("modelId") ?? "");
  // O default global vale pra TODOS (inclusive usuário comum), então só pode ser
  // um modelo userSelectable — audiência "usuário comum" (isAdmin=false). Isso
  // valida o id contra o registry E aplica o gating de audiência (ADR 0013).
  if (!isModelAllowedForAudience(modelId, false)) {
    return { ok: false, error: "Modelo inválido." };
  }

  await setDefaultModelId(modelId, session.user.id);
  revalidatePath("/admin/settings");
  return { ok: true };
}

export type UpdateGenerationParamsResult = { ok: boolean; error?: string };

// Calibração dos parâmetros de geração (ADR 0008, emenda 2). Parâmetros sensíveis
// — afetam custo/qualidade/latência de TODA análise — por isso a UI gateia a
// edição atrás de um toggle + aviso, e aqui revalidamos role admin E os ranges.
export async function updateGenerationParams(
  _prev: UpdateGenerationParamsResult | null,
  formData: FormData,
): Promise<UpdateGenerationParamsResult> {
  const session = await auth();
  // Defense-in-depth igual ao updateDefaultModel: server actions são POST
  // chamáveis fora do layout /admin, então a role é revalidada AQUI.
  if (session?.user?.role !== "admin" || !session.user.id) {
    return { ok: false, error: "Acesso negado." };
  }

  const maxTokens = Number(formData.get("maxTokens"));
  const effort = String(formData.get("effort") ?? "");
  const temperature = Number(formData.get("temperature"));

  if (!isValidMaxTokens(maxTokens)) {
    return {
      ok: false,
      error: `max_tokens deve ser um inteiro entre ${MAX_TOKENS_MIN} e ${MAX_TOKENS_MAX}.`,
    };
  }
  if (!isEffort(effort)) {
    return { ok: false, error: "Effort inválido." };
  }
  if (!isValidTemperature(temperature)) {
    return {
      ok: false,
      error: `temperature deve estar entre ${TEMPERATURE_MIN} e ${TEMPERATURE_MAX}.`,
    };
  }

  await setGenerationParams({ maxTokens, effort, temperature }, session.user.id);
  revalidatePath("/admin/settings");
  return { ok: true };
}

export type UpdateAnalysisEngineResult = { ok: boolean; error?: string };

// Motor de análise (ADR 0041 §5, #511): 'llm' (atual) ou 'code_jev' (código + JEV
// decidem, LLM narra). Vale pra TODA análise nova, sem deploy; voltar é trocar de novo.
export async function updateAnalysisEngine(
  _prev: UpdateAnalysisEngineResult | null,
  formData: FormData,
): Promise<UpdateAnalysisEngineResult> {
  const session = await auth();
  // Defense-in-depth igual às actions acima: role revalidada AQUI.
  if (session?.user?.role !== "admin" || !session.user.id) {
    return { ok: false, error: "Acesso negado." };
  }

  const engine = String(formData.get("analysisEngine") ?? "");
  if (!isAnalysisEngine(engine)) {
    return { ok: false, error: "Motor de análise inválido." };
  }

  await setAnalysisEngine(engine, session.user.id);
  revalidatePath("/admin/settings");
  return { ok: true };
}
