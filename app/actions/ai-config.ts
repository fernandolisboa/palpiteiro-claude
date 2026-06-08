"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { isAIModelId } from "@/lib/ai/models";
import { setDefaultModelId } from "@/lib/db/queries/ai-config";

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
  if (!isAIModelId(modelId)) {
    return { ok: false, error: "Modelo inválido." };
  }

  await setDefaultModelId(modelId, session.user.id);
  revalidatePath("/admin/settings");
  return { ok: true };
}
