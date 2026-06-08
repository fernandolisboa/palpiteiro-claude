import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
} from "@/db/schema";
import { db } from "@/lib/db";

/**
 * Config completa (Node runtime) — estende o `authConfig` edge-safe com o
 * DrizzleAdapter. Importado pelo route handler e por Server Components/Actions
 * que chamam `auth()`. NÃO importar isto no middleware (edge) — use só o
 * `authConfig`.
 *
 * Com strategy "jwt", o adapter é usado no fluxo de magic link
 * (createUser/getUserByEmail/createVerificationToken/useVerificationToken).
 * `sessions`/`accounts` ficam inativas (prontas pra futuro OAuth/DB-sessions).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
});
