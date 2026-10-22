import { isModelAllowedForAudience, type AIModelId } from "@/lib/ai/models";
import { getDefaultModelId } from "@/lib/db/queries/ai-config";
import { getPreferredModelId } from "@/lib/db/queries/users";

/**
 * Modelo das chamadas curtas pedidas pelo usuário fora do predict (narração do "Seu
 * palpite", #564; explicação das apostas, #562): a cascata do predict, preferência
 * filtrada pela audiência, senão o default global.
 */
export async function resolveUserRunModelId(
  userId: string,
  isAdmin: boolean
): Promise<AIModelId> {
  const pref = await getPreferredModelId(userId);
  return pref && isModelAllowedForAudience(pref, isAdmin)
    ? pref
    : getDefaultModelId();
}
