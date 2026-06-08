import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";

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
 * DrizzleAdapter e o provider Resend. Importado pelo route handler e por Server
 * Components/Actions que chamam `auth()`/`signIn()`. NÃO importar isto no
 * middleware (edge) — use só o `authConfig`.
 *
 * O provider Resend (magic link) vive AQUI, não no `authConfig`, porque exige o
 * adapter: o `assertConfig` do @auth/core dispara `MissingAdapter` em qualquer
 * `Auth()` com provider de email sem adapter — e o middleware no edge não tem
 * adapter. Junto do adapter, aqui, é o único lugar correto.
 *
 * Com strategy "jwt", o adapter é usado no fluxo de magic link
 * (createUser/getUserByEmail/createVerificationToken/useVerificationToken).
 * `sessions`/`accounts` ficam inativas (prontas pra futuro OAuth/DB-sessions).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // `providers` e `adapter` DEPOIS do spread de propósito: o spread traz
  // `providers: []` do edge config; estas chaves precisam sobrescrever isso.
  // Inverter a ordem zera os providers e quebra signIn("resend") silenciosamente.
  providers: [
    // apiKey é auto-detectada de AUTH_RESEND_KEY pelo Auth.js.
    Resend({ from: process.env.RESEND_FROM_EMAIL }),
  ],
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
});
