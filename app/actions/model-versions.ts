"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import { resetActiveModelMemo } from "@/lib/ai/model-versions/active";
import { parseClaudeVersion } from "@/lib/ai/models";
import {
  confirmModelVersionPrice,
  rejectModelVersion,
} from "@/lib/db/queries/model-versions";

// Ações do painel de versões de modelo em /admin/ia (ADR 0062). Server actions
// são POST chamáveis fora do layout /admin, então a role é revalidada AQUI.

export type ModelVersionActionResult = { ok: boolean; error?: string };

const VersionIdSchema = z
  .string()
  .max(100)
  .refine((id) => parseClaudeVersion(id) !== null, "versão inválida");

// Preço por 1M de tokens, como a página de preços da Anthropic publica. Zero não vale
// (zeraria o custo em ai_calls e o teto de gasto). Teto largo só contra erro de
// digitação absurdo.
const PriceSchema = z.coerce.number().positive().max(1000);

const ConfirmPriceSchema = z.object({
  id: VersionIdSchema,
  inputPricePerMTok: PriceSchema,
  outputPricePerMTok: PriceSchema,
});

async function isAdmin(): Promise<boolean> {
  const session = await auth();
  return session?.user?.role === "admin" && Boolean(session.user.id);
}

/** Confirma o preço oficial de uma versão adotada (tira o selo "estimado"). */
export async function confirmModelVersionPriceAction(
  _prev: ModelVersionActionResult | null,
  formData: FormData,
): Promise<ModelVersionActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Acesso negado." };
  const parsed = ConfirmPriceSchema.safeParse({
    id: formData.get("id"),
    // String vazia não pode virar 0 no z.coerce.
    inputPricePerMTok: formData.get("inputPricePerMTok") || undefined,
    outputPricePerMTok: formData.get("outputPricePerMTok") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: "Preço inválido: use números maiores que zero, em US$ por 1M de tokens." };
  }
  const { id, ...price } = parsed.data;
  const updated = await confirmModelVersionPrice(id, price);
  if (!updated) return { ok: false, error: "Versão não encontrada." };
  resetActiveModelMemo();
  revalidatePath("/admin/ia");
  return { ok: true };
}

/** "Rejeitar esta versão": vira `failed` e a família volta pra conferida. */
export async function rejectModelVersionAction(
  _prev: ModelVersionActionResult | null,
  formData: FormData,
): Promise<ModelVersionActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Acesso negado." };
  const id = VersionIdSchema.safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Versão inválida." };
  const changed = await rejectModelVersion(id.data);
  if (!changed) return { ok: false, error: "Versão não encontrada ou já reprovada." };
  resetActiveModelMemo();
  revalidatePath("/admin/ia");
  return { ok: true };
}
