import { asc, count, eq, ilike } from "drizzle-orm";

import { users } from "@/db/schema";
import { db } from "@/lib/db";
import { isAIModelId, type AIModelId } from "@/lib/ai/models";

type UserSummary = { id: string; email: string; role: "admin" | "user" };

type UserListItem = UserSummary & { allowed: boolean };

/**
 * Lista usuários (id, email, role, allowed) pra área de admin, ordenados por
 * e-mail. Se `query` for não-vazio (após trim), filtra por `email ILIKE %q%` —
 * ILIKE já é case-insensitive, então só fazemos trim, sem lowercase. `allowed`
 * é trazido pra a lista renderizar o estado de bloqueio (#258) sem abrir cada
 * usuário. NÃO é escopado por usuário: é listagem admin-only. As páginas
 * chamadoras (`app/admin/users/*`) são gateadas pelo `app/admin/layout.tsx`
 * (role === "admin" → notFound) + um re-check defensivo de role na própria
 * página.
 */
export async function searchUsers(query?: string): Promise<UserListItem[]> {
  const q = query?.trim() ?? "";
  const base = db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      allowed: users.allowed,
    })
    .from(users);
  const filtered = q ? base.where(ilike(users.email, `%${q}%`)) : base;
  return filtered.orderBy(asc(users.email));
}

/**
 * Lê SÓ o flag `allowed` de UM usuário por e-mail, ou null se a row não existe.
 * Serve o gate de signIn DB-aware (self-provision aberto, ADR 0023 §3/§6, #257):
 * o callback `signIn` só tem `user.email` (no fluxo de magic link a row pode nem
 * existir ainda), então o lookup é por e-mail — distinto de `getUserAccessState`
 * (por id, pós-criação). `null` (sem row) sinaliza e-mail NOVO, que o gate
 * auto-provisiona. O e-mail é normalizado (trim+lowercase) — `users.email` é
 * gravado lowercased pelo adapter, mas normalizar no lookup é defensivo e barato.
 * Módulo Node-only — NUNCA importar do `auth.config.ts`/edge (puxaria Neon pro
 * bundle do middleware; o guard de `auth.config.test.ts` trava isso).
 */
export async function getUserAllowedByEmail(
  email: string,
): Promise<{ allowed: boolean } | null> {
  const e = email.trim().toLowerCase();
  const rows = await db
    .select({ allowed: users.allowed })
    .from(users)
    .where(eq(users.email, e))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Lookup tipado de UM usuário por id (id, email, role) ou null. Usado pelo
 * header da página de tracking de admin (`app/admin/users/[userId]`) pro e-mail
 * do alvo e pra existência (notFound se não existir). Distinto do
 * `getUserAccessState`, que devolve role+allowed (sem email) pro fluxo de auth.
 */
export async function getUserById(id: string): Promise<UserSummary | null> {
  const rows = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return rows[0] ?? null;
}

type UserAccessState = { role: "admin" | "user"; allowed: boolean };

/**
 * Lê role+allowed de UM usuário por id, ou null se a row não existe. Serve dois
 * caminhos do estado-vivo de sessão (ADR 0023):
 *  - jwt() do Node (`auth.ts`): revalida role+allowed a cada invocação pra que
 *    mudança de role / bloqueio valham SEM novo login (bug da sessão carimbada-
 *    só-no-login). `null` (row deletada — ex.: reset + claim-admin com cookie
 *    velho) → drop da sessão.
 *  - analyzeMatch (`app/actions/predictions.ts`): leitura DIRETA do DB de
 *    `allowed` ANTES de qualquer chamada paga ao Anthropic (guarda load-bearing
 *    do #264, independente da frescura do JWT). `null` também recusa a sessão
 *    órfã antes do custo (a FK `ai_calls_user_id_users_id_fk` estouraria de
 *    qualquer forma, mas só DEPOIS do gasto).
 */
export async function getUserAccessState(
  id: string,
): Promise<UserAccessState | null> {
  const rows = await db
    .select({ role: users.role, allowed: users.allowed })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return rows[0] ?? null;
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
 * Carimba o aceite de maioridade (auto-declaração 18+) de UM usuário, com `now()`
 * (#282, ADR/ops 05). Chamada do `events.createUser` em `auth.ts`, que dispara
 * quando o adapter INSERE a row de `users` (qualquer provider — Google / magic
 * link / passkey-register), ou seja, só DEPOIS de o checkbox obrigatório do
 * /signin ter destravado o método. O gate é a UI; esta função confia no `userId`
 * recebido. Não precisa ser idempotente — `createUser` dispara só na inserção.
 */
export async function markTermsAccepted(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ acceptedTermsAt: new Date() })
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
 * Muta o acesso (whitelist em DB, ADR 0009 / 0023) de UM usuário.
 * `allowed=false` bloqueia logins FUTUROS E, via revalidação no jwt() do Node
 * (#252), passa a refletir na sessão vigente no próximo request — além de ser a
 * guarda load-bearing recusada DIRETO em analyzeMatch antes de qualquer chamada
 * paga (#264). NÃO vale pra e-mails do env `ALLOWED_EMAILS` (floor permanente):
 * pra bloquear um e-mail do floor é preciso removê-lo do env também (ver ADR
 * 0023 — evita loop de login pra contas do floor). Gate/guardas na action.
 */
export async function updateUserAccess(
  id: string,
  allowed: boolean
): Promise<void> {
  await db.update(users).set({ allowed }).where(eq(users.id, id));
}
