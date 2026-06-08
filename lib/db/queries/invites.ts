import { and, eq } from "drizzle-orm";

import { pendingInvites, users } from "@/db/schema";
import { db } from "@/lib/db";

/**
 * Queries reusáveis da whitelist em DB (ADR 0009). Módulo Node-only — NUNCA
 * importar do `auth.config.ts`/edge (puxaria o cliente Neon pro bundle do
 * middleware). A UI de convites do #52 reusa add/remove + a checagem.
 *
 * Duas fontes: `users.allowed=true` (usuários que já existem) e `pending_invites`
 * (convidados que ainda não logaram). O e-mail é normalizado em TODA fronteira —
 * ele é a PK de `pending_invites`, então um insert não-normalizado criaria uma
 * row que nunca casa nos lookups.
 */

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * True se o e-mail está autorizado pela whitelist em DB: existe uma row em
 * `users` com `allowed=true`, OU existe uma row em `pending_invites`. Dois
 * selects simples (espelha o padrão de `users.ts`) — triviais de mockar.
 */
export async function isEmailWhitelistedInDb(email: string): Promise<boolean> {
  const e = normalizeEmail(email);

  const allowedUserRows = await db
    .select({ allowed: users.allowed })
    .from(users)
    .where(and(eq(users.email, e), eq(users.allowed, true)))
    .limit(1);
  if (allowedUserRows.length > 0) return true;

  const inviteRows = await db
    .select({ email: pendingInvites.email })
    .from(pendingInvites)
    .where(eq(pendingInvites.email, e))
    .limit(1);
  return inviteRows.length > 0;
}

/**
 * Promove o usuário recém-criado no primeiro login: marca `users.allowed=true` E
 * apaga o convite pendente correspondente, num único round-trip atômico. Sem
 * isto, um convidado logaria uma vez e travaria no PRÓXIMO login (sem row em
 * `pending_invites` + `allowed=false` + talvez fora do env). O invariante
 * resultante: `pending_invites` só guarda convidados que ainda não logaram.
 */
export async function promoteInvitedUserOnLogin(user: {
  // `id` é `string | undefined` no tipo `User` do next-auth, mas no evento
  // `createUser` a row já foi criada → guardamos contra o caso impossível.
  id?: string;
  email?: string | null;
}): Promise<void> {
  if (!user.id) return;

  if (!user.email) {
    await db.update(users).set({ allowed: true }).where(eq(users.id, user.id));
    return;
  }

  const e = normalizeEmail(user.email);
  // db.batch é o primitivo atômico do neon-http — db.transaction() LANÇA
  // "No transactions support in neon-http driver" em runtime; batch roda o array
  // num único round-trip transacional.
  await db.batch([
    db.update(users).set({ allowed: true }).where(eq(users.id, user.id)),
    db.delete(pendingInvites).where(eq(pendingInvites.email, e)),
  ]);
}

/**
 * Upsert idempotente de um convite por e-mail (PK). Reusado pela UI do #52.
 *
 * ATENÇÃO (clobber-on-conflict): no conflito, `invitedByUserId` e `note` são
 * SOBRESCRITOS pelos valores passados (ou null se omitidos). Re-convidar um
 * e-mail já pendente SEM repassar esses campos zera a metadata anterior. O #52
 * deve repassar a metadata existente (ou só atualizar campos fornecidos) se
 * quiser preservá-la.
 */
export async function addPendingInvite(input: {
  email: string;
  invitedByUserId?: string | null;
  note?: string | null;
}): Promise<void> {
  const e = normalizeEmail(input.email);
  await db
    .insert(pendingInvites)
    .values({
      email: e,
      invitedByUserId: input.invitedByUserId ?? null,
      note: input.note ?? null,
    })
    .onConflictDoUpdate({
      target: pendingInvites.email,
      set: {
        invitedByUserId: input.invitedByUserId ?? null,
        note: input.note ?? null,
      },
    });
}

/**
 * Remove um convite pendente por e-mail. Reusado pelo seed script e pela UI do
 * #52.
 */
export async function removePendingInvite(email: string): Promise<void> {
  await db
    .delete(pendingInvites)
    .where(eq(pendingInvites.email, normalizeEmail(email)));
}
