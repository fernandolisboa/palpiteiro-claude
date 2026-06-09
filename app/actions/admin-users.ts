"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/auth";
import {
  countAdmins,
  getUserById,
  updateUserAccess,
  updateUserRole,
} from "@/lib/db/queries/users";

export type AdminUserResult = { ok: boolean; error?: string };

const roleSchema = z.enum(["admin", "user"]);
const allowedSchema = z.enum(["true", "false"]);
// users.id é defaultRandom() (v4); apertar pra v4 rejeita nil/variantes.
const uuidSchema = z.uuid({ version: "v4" });

function revalidateUser(userId: string): void {
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
}

/**
 * Troca a role (user ↔ admin) de OUTRO usuário. Gate de admin + guardas
 * anti-lockout no servidor (ADR 0011): nunca alterar a própria role, nunca
 * rebaixar o último admin.
 */
export async function setUserRole(
  _prev: AdminUserResult | null,
  formData: FormData
): Promise<AdminUserResult> {
  // Gate defense-in-depth (POST chamável fora do layout) — espelha invites.
  const session = await auth();
  if (session?.user?.role !== "admin" || !session.user.id) {
    return { ok: false, error: "Acesso negado." };
  }

  const userId = String(formData.get("userId") ?? "");
  if (!uuidSchema.safeParse(userId).success) {
    return { ok: false, error: "Usuário inválido." };
  }
  const parsed = roleSchema.safeParse(String(formData.get("role") ?? ""));
  if (!parsed.success) {
    return { ok: false, error: "Role inválida." };
  }
  const role = parsed.data;

  // Guarda: nunca alterar a própria role (sempre seria um auto-rebaixe aqui).
  if (userId === session.user.id) {
    return {
      ok: false,
      error: "Você não pode alterar a sua própria role — peça a outro admin.",
    };
  }

  // Guarda: nunca rebaixar o último admin (chegar a zero admins = lockout geral).
  if (role === "user") {
    const target = await getUserById(userId);
    if (!target) return { ok: false, error: "Usuário não encontrado." };
    if (target.role === "admin" && (await countAdmins()) <= 1) {
      return { ok: false, error: "Não dá pra rebaixar o último admin." };
    }
  }

  await updateUserRole(userId, role);
  revalidateUser(userId);
  return { ok: true };
}

/**
 * Revoga/concede o acesso (`users.allowed`, whitelist em DB do ADR 0009) de
 * OUTRO usuário. Revogar bloqueia LOGINS FUTUROS (não a sessão vigente) e NÃO
 * vale pra e-mails no env `ALLOWED_EMAILS` (floor). Guarda: nunca revogar o
 * próprio acesso.
 */
export async function setUserAccess(
  _prev: AdminUserResult | null,
  formData: FormData
): Promise<AdminUserResult> {
  const session = await auth();
  if (session?.user?.role !== "admin" || !session.user.id) {
    return { ok: false, error: "Acesso negado." };
  }

  const userId = String(formData.get("userId") ?? "");
  if (!uuidSchema.safeParse(userId).success) {
    return { ok: false, error: "Usuário inválido." };
  }
  // Valida explicitamente (espelha o caminho de `role`): sem isto, qualquer
  // valor ≠ "true" num POST malformado viraria revoke silencioso.
  const allowedParsed = allowedSchema.safeParse(
    String(formData.get("allowed") ?? "")
  );
  if (!allowedParsed.success) {
    return { ok: false, error: "Valor de acesso inválido." };
  }
  const allowed = allowedParsed.data === "true";

  // Guarda: nunca revogar o próprio acesso (auto-lockout no próximo login).
  if (userId === session.user.id && !allowed) {
    return { ok: false, error: "Você não pode revogar o seu próprio acesso." };
  }

  await updateUserAccess(userId, allowed);
  revalidateUser(userId);
  return { ok: true };
}
