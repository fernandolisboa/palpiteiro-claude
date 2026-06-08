import type { NextAuthConfig } from "next-auth";
import Resend from "next-auth/providers/resend";

import { isEmailAllowed } from "@/lib/auth/whitelist";

/**
 * Config edge-safe do Auth.js v5 — SEM adapter e SEM dependência de DB, pra
 * rodar no edge runtime (middleware). O `auth.ts` (Node) estende isto com o
 * DrizzleAdapter. Padrão "split config" recomendado pelo v5.
 *
 * Sessão via JWT: o middleware valida a sessão a partir do cookie no edge, sem
 * ida ao DB. Trade-off aceito (app pessoal): sem revogação server-side
 * instantânea — o JWT vale até expirar.
 */
export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  providers: [
    // apiKey é auto-detectada de AUTH_RESEND_KEY pelo Auth.js.
    Resend({ from: process.env.RESEND_FROM_EMAIL }),
  ],
  callbacks: {
    /**
     * Whitelist: roda ANTES do envio do magic link (verificado no source do
     * @auth/core). E-mail fora da lista → AccessDenied → nenhum e-mail enviado,
     * nenhum token criado. Protege login E custo de envio.
     */
    signIn({ user }) {
      return isEmailAllowed(user.email);
    },
    /** Gate do middleware: exige sessão pra qualquer rota protegida. */
    authorized({ auth }) {
      return !!auth?.user;
    },
    /** Carimba id/role no JWT no momento do sign-in. */
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        // role vem da row do usuário (via adapter) no sign-in.
        token.role = (user as { role?: "admin" | "user" }).role ?? "user";
      }
      return token;
    },
    /** Expõe id/role na sessão lida por Server Components/Actions. */
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as "admin" | "user";
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
