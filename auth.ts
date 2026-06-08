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
import { isEmailAllowedWithDb } from "@/lib/auth/whitelist-db";
import { db } from "@/lib/db";
import { promoteInvitedUserOnLogin } from "@/lib/db/queries/invites";

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
  // signIn DB-aware mora AQUI (Node), não no `auth.config.ts` edge — lê o DB
  // (ADR 0009). Roda ANTES do envio do magic link (fluxo do @auth/core), então
  // e-mail não autorizado = AccessDenied = nenhum e-mail/token (cost-safe).
  // Spread de authConfig.callbacks PRIMEIRO pra preservar authorized/jwt/session;
  // só o signIn é adicionado/sobrescrito.
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user }) {
      return isEmailAllowedWithDb(user.email);
    },
  },
  // createUser dispara uma vez no primeiro login, DEPOIS do signIn ter
  // autorizado. Promove o usuário recém-criado (allowed=true + apaga o convite)
  // pra evitar lockout no próximo login.
  events: {
    async createUser({ user }) {
      await promoteInvitedUserOnLogin(user);
    },
  },
});
