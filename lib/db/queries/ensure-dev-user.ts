import { users } from "@/db/schema";
import { db } from "@/lib/db";
import { DEV_USER_ID } from "@/lib/auth/dev-user";

/**
 * Phase-1 stopgap until real auth (#12).
 *
 * The app has no session yet: every prediction/ai_call is attributed to the
 * hardcoded DEV_USER_ID, which is a NOT-NULL FK. The prod deploy runs
 * `drizzle-kit migrate` only (never `db:seed`), so this admin row may not exist
 * — and an absent row makes every ai_calls/predictions insert fail. This
 * idempotent upsert guarantees the FK is satisfiable before we persist.
 *
 * Idempotent via onConflictDoNothing — safe to call on every analysis. Remove
 * once real auth provisions users (#12).
 */
export async function ensureDevUser(): Promise<void> {
  await db
    .insert(users)
    .values({
      id: DEV_USER_ID,
      email: "admin@palpiteiro.local",
      name: "Admin",
      role: "admin",
      allowed: true,
    })
    // No target → suppress on ANY unique conflict (id OR email). Targeting only
    // id would let a same-email/different-id row throw an unhandled unique
    // violation up through analyzeMatch. The common cases (row absent, or
    // present with this id) are covered; the pathological same-email case
    // degrades to the FK-defense path, which persistAiCallError now surfaces.
    .onConflictDoNothing();
}
