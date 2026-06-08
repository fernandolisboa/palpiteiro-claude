import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq } from "drizzle-orm";

import { users } from "../schema";

/**
 * Reivindica (claim) a row do dev user em prod, uma única vez.
 *
 * Antes do #12 o app rodava como um usuário fake hardcoded
 * (DEV_USER_ID = "000…001", email "admin@palpiteiro.local"). Toda predição/
 * ai_call/outcome aponta pra essa row. Em vez de migrar N tabelas filhas,
 * renomeamos a própria row pro e-mail/nome real, mantendo o MESMO UUID — no
 * primeiro login o adapter faz getUserByEmail e reusa a row, então o histórico
 * (Copa) continua válido e passa a ser do admin.
 *
 * ORDEM IMPORTA (rollout):
 *   1. migration 0003 aplicada
 *   2. rodar ESTE script
 *   3. SÓ ENTÃO logar com ADMIN_EMAIL pela primeira vez
 * Se logar antes, o adapter cria uma row NOVA (uuid random) com ADMIN_EMAIL e o
 * UPDATE colidiria com users_email_unique — por isso abortamos nesse caso.
 *
 * Idempotente: re-rodar depois de reivindicado é no-op (o WHERE no e-mail
 * placeholder não casa mais).
 *
 * Uso:
 *   ADMIN_EMAIL=voce@exemplo.com ADMIN_NAME="Seu Nome" pnpm tsx db/scripts/claim-admin.ts
 */

const PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000001";
const PLACEHOLDER_EMAIL = "admin@palpiteiro.local";

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminName = process.env.ADMIN_NAME?.trim();

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set — create .env.local from .env.example");
  }
  if (!adminEmail) throw new Error("ADMIN_EMAIL not set");
  if (!adminName) throw new Error("ADMIN_NAME not set");

  const db = drizzle(neon(process.env.DATABASE_URL), { casing: "snake_case" });

  // 1. Já existe alguma row com ADMIN_EMAIL? (login antes do claim) → abortar.
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, adminEmail));

  if (existing.length > 0) {
    const onPlaceholder = existing.some((r) => r.id === PLACEHOLDER_ID);
    if (onPlaceholder) {
      console.log(
        `· ADMIN_EMAIL já está na row do dev user (${PLACEHOLDER_ID}). Nada a fazer.`,
      );
      return;
    }
    throw new Error(
      `ADMIN_EMAIL (${adminEmail}) já existe numa row diferente do placeholder ` +
        `— provavelmente houve login antes do claim. Resolva manualmente ` +
        `(merge das predições para o uuid correto) antes de re-rodar.`,
    );
  }

  // 2. Reivindicar a row placeholder in-place.
  const updated = await db
    .update(users)
    .set({ email: adminEmail, name: adminName })
    .where(
      and(eq(users.id, PLACEHOLDER_ID), eq(users.email, PLACEHOLDER_EMAIL)),
    )
    .returning({ id: users.id, email: users.email });

  if (updated.length > 0) {
    console.log(`✓ dev user reivindicado → ${updated[0].email} (${updated[0].id})`);
    console.log(
      "  Próximo passo: faça login com ADMIN_EMAIL. Se já tinha sessão ativa, " +
        "saia e entre de novo pro JWT carregar role=admin.",
    );
  } else {
    console.log(
      "· nenhuma row placeholder encontrada (DB novo ou já reivindicado). Nada a fazer.",
    );
  }
}

main().catch((err) => {
  console.error("claim-admin failed:", err);
  process.exit(1);
});
