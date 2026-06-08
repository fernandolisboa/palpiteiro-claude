import { asc, eq, ilike } from "drizzle-orm";

import { users } from "@/db/schema";
import { db } from "@/lib/db";

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
  const filtered = q
    ? base.where(ilike(users.email, `%${q}%`))
    : base;
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
};

/**
 * Lê o perfil editável (nome/avatar) do próprio usuário pra popular o form em
 * `/perfil`. Distinto do `getUserById`, que devolve role (não name/image).
 */
export async function getUserProfile(id: string): Promise<UserProfile | null> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Atualiza nome/avatar de UM usuário. Primeira mutação deste módulo (as demais
 * são read-only). O gate de "só o dono edita" mora na server action
 * (`app/actions/profile.ts`); esta função confia no `id` recebido.
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
