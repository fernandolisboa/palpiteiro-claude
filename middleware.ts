import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";

/**
 * Protege o app inteiro via callback `authorized` (sessão obrigatória). Usa só
 * o `authConfig` edge-safe (sem adapter/DB) — JWT é validado a partir do cookie
 * no edge. Rotas não-autenticadas redirecionam pra `/signin` (pages.signIn).
 *
 * O matcher exclui:
 *  - `/api/*`  → endpoints do Auth.js + cron (este tem proteção própria via
 *                CRON_SECRET). Excluir é essencial pro callback do magic link.
 *  - assets estáticos (`_next/static`, `_next/image`, `favicon.ico`)
 *  - `/signin` → a própria página de login
 */
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Âncoras (`api/`, `signin$`) evitam que rotas-irmãs hipotéticas (ex.:
  // `/signin-foo`, `/apidocs`) escapem do gate por casarem o prefixo.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|signin$).*)"],
};
