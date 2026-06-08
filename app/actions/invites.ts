"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import {
  addPendingInvite,
  removePendingInvite,
} from "@/lib/db/queries/invites";

export type InviteUserResult = { ok: boolean; error?: string };

const emailSchema = z.email();

export async function inviteUser(
  _prev: InviteUserResult | null,
  formData: FormData
): Promise<InviteUserResult> {
  const session = await auth();
  // Server actions são POST chamáveis FORA do layout (que gateia /admin/**),
  // então a role é revalidada AQUI — defense-in-depth além de esconder a UI.
  if (session?.user?.role !== "admin" || !session.user.id) {
    return { ok: false, error: "Acesso negado." };
  }

  // Trim ANTES de validar: z.email() não apara espaços, então um e-mail válido
  // com espaços de borda falharia a validação (assimétrico com `note`, que é
  // aparado). addPendingInvite ainda normaliza (trim+lowercase) na fronteira.
  const email = String(formData.get("email") ?? "").trim();
  if (!emailSchema.safeParse(email).success) {
    return { ok: false, error: "E-mail inválido." };
  }

  const rawNote = String(formData.get("note") ?? "").trim();
  const note = rawNote.length > 0 ? rawNote : null;

  // Normalização do e-mail (trim+lowercase) acontece DENTRO de addPendingInvite
  // (é a PK de pending_invites) — não re-normalizar aqui.
  await addPendingInvite({ email, invitedByUserId: session.user.id, note });
  revalidatePath("/admin/invites");
  return { ok: true };
}

export async function revokeInvite(
  _prev: InviteUserResult | null,
  formData: FormData
): Promise<InviteUserResult> {
  const session = await auth();
  // Mesma checagem de role da action acima — defense-in-depth.
  if (session?.user?.role !== "admin" || !session.user.id) {
    return { ok: false, error: "Acesso negado." };
  }

  const email = String(formData.get("email") ?? "");
  await removePendingInvite(email);
  revalidatePath("/admin/invites");
  return { ok: true };
}
