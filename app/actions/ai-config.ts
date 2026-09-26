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
import { resetAnalysisEngineMemo } from "@/lib/ai/engine/analysis-engine-flag";
import { resetDixonColesFlagMemo } from "@/lib/ratings/model-scoreline";
import { refitTeamRatings } from "@/lib/ratings/refit-team-ratings";
import {
  validateAdminFlagInput,
  type AdminFlagValue,
} from "@/lib/config/admin-flags";
import {
  setAdminFlag,
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

export type UpdateAdminFlagResult = { ok: boolean; error?: string };

// Flags de ai_config editáveis pelo /admin/settings (#514), dirigidas pelo registry
// lib/config/admin-flags.ts. Key fora do registry ou valor que não casa com o kind
// (boolean / valores do enum) é recusado em validateAdminFlagInput.
export async function updateAdminFlag(
  _prev: UpdateAdminFlagResult | null,
  formData: FormData,
): Promise<UpdateAdminFlagResult> {
  const session = await auth();
  // Defense-in-depth igual ao updateDefaultModel: server actions são POST
  // chamáveis fora do layout /admin, então a role é revalidada AQUI.
  if (session?.user?.role !== "admin" || !session.user.id) {
    return { ok: false, error: "Acesso negado." };
  }

  const verdict = validateAdminFlagInput({
    key: formData.get("key"),
    value: formData.get("value"),
  });
  if (!verdict.ok) return { ok: false, error: verdict.error };

  // Cast seguro: validateAdminFlagInput só aprova valor do kind da key.
  await setAdminFlag(
    verdict.key,
    verdict.value as AdminFlagValue,
    session.user.id,
  );
  // Motor de análise (ADR 0041): vale já nesta instância; nas outras, em até 60s
  // (TTL do memo lido pelo predict).
  if (verdict.key === "analysisEngine") resetAnalysisEngineMemo();
  if (verdict.key === "enableDixonColes") resetDixonColesFlagMemo();
  revalidatePath("/admin/settings");
  return { ok: true };
}

export type RefitTeamRatingsResult =
  | { ok: true; fitted: number; skipped: number }
  | { ok: false; error: string };

/**
 * Refit do Dixon-Coles sob demanda (ADR 0051): o mesmo job do cron diário, pra não
 * esperar o próximo disparo depois de um deploy ou de ligar uma liga.
 */
export async function refitTeamRatingsNow(
  _prev: RefitTeamRatingsResult | null,
  _formData: FormData,
): Promise<RefitTeamRatingsResult> {
  const session = await auth();
  if (session?.user?.role !== "admin" || !session.user.id) {
    return { ok: false, error: "Acesso negado." };
  }
  try {
    const results = await refitTeamRatings();
    revalidatePath("/admin/settings");
    const fitted = results.filter((r) => r.status === "fitted").length;
    return { ok: true, fitted, skipped: results.length - fitted };
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "refit_team_ratings",
        event: "manual_refit_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ok: false, error: "O refit falhou. Veja os logs." };
  }
}
