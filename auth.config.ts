import type { NextAuthConfig } from "next-auth";

/**
 * Config edge-safe do Auth.js v5 — SEM adapter, SEM providers e SEM dependência
 * de DB, pra rodar no edge runtime (middleware). O `auth.ts` (Node) estende isto
 * com o DrizzleAdapter E o provider Resend. Padrão "split config" do v5.
 *
 * IMPORTANTE: o provider Resend (type "email") NÃO pode morar aqui. O
 * `assertConfig` do @auth/core roda em TODA invocação de `Auth()` — inclusive a
 * leitura de sessão que o middleware faz a cada navegação — e exige um adapter
 * sempre que existe um provider de email. Como o edge não tem adapter, deixar o
 * Resend aqui dispara `MissingAdapter`, o middleware aborta antes de decodificar
 * o cookie, e toda rota protegida vira loop de redirect pro /signin. Por isso o
 * Resend vive só no `auth.ts`, junto do adapter.
 *
 * Sessão via JWT: o middleware valida a sessão a partir do cookie no edge, sem
 * ida ao DB (só precisa do AUTH_SECRET, não dos providers). Trade-off aceito
 * (app pessoal): sem revogação server-side instantânea — o JWT vale até expirar.
 */
export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  // Providers ficam no `auth.ts` (Node), junto do adapter — ver comentário acima.
  providers: [],
  callbacks: {
    // O gate de whitelist (signIn) vive no `auth.ts` (Node), não aqui, porque
    // lê o DB (`pending_invites`/`users.allowed`) — ADR 0009. Este config é
    // edge-safe e NÃO pode importar DB. O middleware só usa authorized/jwt/
    // session, então a ausência do signIn aqui é segura.
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
