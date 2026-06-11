import { asc, count, eq, ilike } from "drizzle-orm";

import { users } from "@/db/schema";
import { db } from "@/lib/db";
import { isAIModelId, type AIModelId } from "@/lib/ai/models";

type UserSummary = { id: string; email: string; role: "admin" | "user" };

/**
 * Lista usuários (id, email, role) pra área de admin, ordenados por e-mail. Se
 * `query` for não-vazio (após trim), filtra por `email ILIKE %q%` — ILIKE já é
 * case-insensitive, então só fazemos trim, sem lowercase. NÃO é escopado por
 * usuário: é listagem admin-only. As páginas chamadoras
 * (`app/admin/users/*`) são gateadas pelo `app/admin/layout.tsx` (role ===
 * "admin" → notFound) + um re-check defensivo de role na própria página.
 */
export async function searchUsers(query?: string): Promise<UserSummary[]> {
  const q = query?.trim() ?? "";
  const base = db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users);
  const filtered = q ? base.where(ilike(users.email, `%${q}%`)) : base;
  return filtered.orderBy(asc(users.email));
}

/**
 * Lookup tipado de UM usuário por id (id, email, role) ou null. Usado pelo
 * header da página de tracking de admin (`app/admin/users/[userId]`) pro e-mail
 * do alvo e pra existência (notFound se não existir). Distinto do `userExists`,
 * que só devolve boolean.
 */
export async function getUserById(id: string): Promise<UserSummary | null> {
  const rows = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * True se existe uma row em `users` com este id. Sob sessão JWT o `token.id` é
 * carimbado no login e nunca revalidado contra o DB; se a row do usuário for
 * deletada/recriada depois (ex.: reset + claim-admin), o cookie segue apontando
 * pra um id que não existe mais. Usado pra recusar a sessão órfã ANTES de gastar
 * uma chamada paga ao Anthropic (FK `ai_calls_user_id_users_id_fk` falharia de
 * qualquer forma, mas só depois do custo).
 */
export async function userExists(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return rows.length > 0;
}

type UserProfile = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  preferredModelId: string | null;
};

/**
 * Lê o perfil editável (nome/avatar/preferência de modelo) do próprio usuário
 * pra popular o form em `/perfil`. Distinto do `getUserById`, que devolve role
 * (não name/image). `preferredModelId` é o valor cru da coluna (validação de
 * registry/audiência fica na page/action que renderiza o form).
 */
export async function getUserProfile(id: string): Promise<UserProfile | null> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      preferredModelId: users.preferredModelId,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Preferência pessoal de modelo do usuário, validada contra o registry. Se a
 * coluna for null/ausente OU o valor persistido não estiver no registry
 * (registry encolheu / dado ruim), devolve null — um id stale nunca chega à
 * cascata de predict. NÃO filtra audiência: o gate admin-only mora em predict,
 * que é quem resolve o modelo final.
 */
export async function getPreferredModelId(
  userId: string,
): Promise<AIModelId | null> {
  const rows = await db
    .select({ preferredModelId: users.preferredModelId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const stored = rows[0]?.preferredModelId;
  if (stored && isAIModelId(stored)) return stored;
  return null;
}

/**
 * Grava (ou limpa, com `null`) a preferência pessoal de modelo de UM usuário. O
 * gate de "só o dono edita" + a checagem de audiência moram na server action
 * (`app/actions/profile.ts`); esta função confia nos argumentos recebidos.
 */
export async function setPreferredModelId(
  userId: string,
  modelId: AIModelId | null,
): Promise<void> {
  await db
    .update(users)
    .set({ preferredModelId: modelId })
    .where(eq(users.id, userId));
}

/**
 * Atualiza nome/avatar de UM usuário. O gate de "só o dono edita" mora na server
 * action (`app/actions/profile.ts`); esta função confia no `id` recebido.
 */
export async function updateUser(
  id: string,
  data: { name: string; image: string | null }
): Promise<void> {
  await db
    .update(users)
    .set({ name: data.name, image: data.image })
    .where(eq(users.id, id));
}

type UserManagement = {
  id: string;
  email: string;
  role: "admin" | "user";
  allowed: boolean;
};

/**
 * Lê id/email/role/allowed de UM usuário pra UI de gestão de admin
 * (`app/admin/users/[userId]`). Superset do `getUserById`, que não traz
 * `allowed`.
 */
export async function getUserManagement(
  id: string
): Promise<UserManagement | null> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      allowed: users.allowed,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Conta admins. Usado pela guarda anti-lockout (nunca rebaixar o último). */
export async function countAdmins(): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(users)
    .where(eq(users.role, "admin"));
  return row?.value ?? 0;
}

/**
 * Muta a role de UM usuário. Mutação — o gate de admin e as guardas anti-lockout
 * moram na server action (`app/actions/admin-users.ts`); esta função confia nos
 * argumentos recebidos.
 */
export async function updateUserRole(
  id: string,
  role: "admin" | "user"
): Promise<void> {
  await db.update(users).set({ role }).where(eq(users.id, id));
}

/**
 * Muta o acesso (whitelist em DB, ADR 0009) de UM usuário. `allowed=false`
 * bloqueia logins FUTUROS (não a sessão vigente) e NÃO vale pra e-mails do env
 * `ALLOWED_EMAILS` (floor). Gate/guardas na action.
 */
export async function updateUserAccess(
  id: string,
  allowed: boolean
): Promise<void> {
  await db.update(users).set({ allowed }).where(eq(users.id, id));
}
