"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import {
  addPendingInvite,
  removePendingInvite,
} from "@/lib/db/queries/invites";
import { sendInviteEmail } from "@/lib/notifications/invite-email";

// `emailed` é o resultado best-effort do aviso ao convidado (só no inviteUser):
// undefined em revoke; false quando o convite valeu mas o e-mail não saiu.
export type InviteUserResult = {
  ok: boolean;
  error?: string;
  emailed?: boolean;
};

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

  // Aviso ao convidado (best-effort). NÃO é magic link — só um e-mail com o
  // link pra /signin, onde a pessoa solicita o acesso. AUTH_URL é a base
  // canônica (mesma que o Auth.js usa). Falha de e-mail NÃO derruba o convite:
  // a whitelist já valeu; `emailed` sinaliza pra UI avisar manualmente.
  const base = (process.env.AUTH_URL ?? "").replace(/\/+$/, "");
  const emailResult = await sendInviteEmail({
    to: email,
    signinUrl: `${base}/signin`,
  });

  revalidatePath("/admin/invites");
  return { ok: true, emailed: emailResult.sent };
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
