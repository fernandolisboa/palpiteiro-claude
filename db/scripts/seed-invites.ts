import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";

import { pendingInvites, users } from "../schema";

/**
 * Migra a whitelist do env `ALLOWED_EMAILS` pra o modelo de duas fontes em DB
 * (ADR 0009), populando o DB no dia 1 sem redeploy.
 *
 * Por e-mail:
 *   - se já existe uma row em `users` → set `allowed=true` (usuário existente);
 *   - senão → upsert em `pending_invites` (convidado que ainda não logou).
 *
 * Idempotente: allowed=true é no-op ao re-rodar; onConflictDoNothing na PK
 * (email) de `pending_invites`. Cliente Neon standalone (não `@/lib/db`) pra
 * rodar fora do runtime do Next — espelha `db/scripts/claim-admin.ts`.
 *
 * Uso:
 *   ALLOWED_EMAILS=a@x.com,b@y.com pnpm tsx db/scripts/seed-invites.ts
 */

function parseAllowedEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0),
    ),
  ];
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set — create .env.local from .env.example");
  }

  const emails = parseAllowedEmails(process.env.ALLOWED_EMAILS);
  if (emails.length === 0) {
    console.log("· ALLOWED_EMAILS vazio/ausente — nada a semear.");
    return;
  }

  const db = drizzle(neon(process.env.DATABASE_URL), { casing: "snake_case" });

  let promoted = 0;
  let invited = 0;

  for (const email of emails) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      await db.update(users).set({ allowed: true }).where(eq(users.email, email));
      promoted++;
      console.log(`✓ promoted (users.allowed=true): ${email}`);
    } else {
      await db
        .insert(pendingInvites)
        .values({ email })
        .onConflictDoNothing();
      invited++;
      console.log(`✓ invited (pending_invites):     ${email}`);
    }
  }

  console.log(
    `\nResumo: ${emails.length} e-mail(s) — ${promoted} promovido(s), ${invited} convidado(s).`,
  );
}

main().catch((err) => {
  console.error("seed-invites failed:", err);
  process.exit(1);
});
