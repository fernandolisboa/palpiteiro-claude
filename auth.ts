import { DrizzleAdapter } from "@auth/drizzle-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import WebAuthn from "next-auth/providers/webauthn";

import { authConfig } from "@/auth.config";
import {
  accounts,
  authenticators,
  sessions,
  users,
  verificationTokens,
} from "@/db/schema";
import { isSignInAllowed } from "@/lib/auth/whitelist-db";
import { revalidateToken } from "@/lib/auth/jwt-revalidate";
import { db } from "@/lib/db";
import { promoteInvitedUserOnLogin } from "@/lib/db/queries/invites";
import { getUserAccessState } from "@/lib/db/queries/users";

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
 * (createUser/getUserByEmail/createVerificationToken/useVerificationToken) e no
 * OAuth Google, que grava a row de `accounts` (provider="google"). `sessions`
 * segue inativa sob JWT (a sessão é o token, não uma row de DB).
 */
export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  ...authConfig,
  // WebAuthn/passkey é EXPERIMENTAL no Auth.js v5 beta; o flag precisa estar
  // ligado pro provider WebAuthn registrar os endpoints (webauthn-options). Mora
  // AQUI (Node, junto do adapter), NUNCA no `auth.config.ts` (edge): o provider
  // arrasta o adapter + `@simplewebauthn/server` (Node-only), que quebrariam o
  // bundle do middleware. ADR 0023.
  experimental: { enableWebAuthn: true },
  // `providers` e `adapter` DEPOIS do spread de propósito: o spread traz
  // `providers: []` do edge config; estas chaves precisam sobrescrever isso.
  // Inverter a ordem zera os providers e quebra signIn("resend") silenciosamente.
  providers: [
    // AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET são auto-detectadas pelo Auth.js v5.
    // allowDangerousEmailAccountLinking: o e-mail do Google vem verificado, então
    // linkar ao mesmo `users` de um login por magic link é seguro (ADR 0023).
    Google({ allowDangerousEmailAccountLinking: true }),
    // apiKey é auto-detectada de AUTH_RESEND_KEY pelo Auth.js.
    Resend({ from: process.env.RESEND_FROM_EMAIL }),
    // Passkey (WebAuthn), método OPCIONAL adicional. `id: "passkey"` sobrescreve
    // o default "webauthn" do provider — o `signIn` cliente (next-auth/webauthn)
    // valida `providers[id].type === "webauthn"`, então o id customizado é só a
    // chave/URL; os call-sites usam `signIn("passkey", …)`. SEM `relayingParty`
    // literal: o default do provider deriva o RP id por-request (`url.hostname`)
    // e origin (`url.origin`), o que com `trustHost: true` (auth.config.ts)
    // resolve localhost / *.vercel.app / palpiteiro.live automaticamente, por
    // ambiente, sem hardcode. Consequência esperada do WebAuthn (não bug): uma
    // passkey é por-RP-id — registrada em localhost/preview não vale em prod nem
    // em outro preview (host muda). Documentado no PR/ADR 0023.
    WebAuthn({ id: "passkey" }),
  ],
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
    // Tabela das credenciais passkey — o provider WebAuthn usa
    // createAuthenticator/getAuthenticator/listAuthenticatorsByUserId/
    // updateAuthenticatorCounter. `userId` uuid casa o generic do adapter.
    authenticatorsTable: authenticators,
  }),
  // signIn DB-aware mora AQUI (Node), não no `auth.config.ts` edge — lê o DB
  // (ADR 0009/0023). Roda ANTES do envio do magic link (fluxo do @auth/core),
  // então e-mail bloqueado = AccessDenied = nenhum e-mail/token (cost-safe).
  // Self-provision ABERTO (#257): `isSignInAllowed` é allow-by-default — só
  // recusa row com `allowed=false`; e-mail novo é auto-provisionado, env-floor
  // é sempre permitido (anti-lockout). Spread de authConfig.callbacks PRIMEIRO
  // pra preservar authorized/jwt/session; só o signIn é adicionado/sobrescrito.
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user }) {
      return isSignInAllowed(user.email);
    },
    // Override Node do jwt() (#252, ADR 0023): roda o jwt() edge-safe primeiro
    // (carimbo de id/role no login + edição de perfil), depois revalida
    // role+allowed contra o DB a cada invocação pra que mudança de role / bloqueio
    // valham SEM novo login. DEPOIS do spread de authConfig.callbacks de propósito
    // — espelha o padrão do signIn. A leitura do DB mora SÓ aqui (Node); o
    // middleware usa só authConfig (jwt edge DB-free), então o cliente Neon nunca
    // entra no bundle do edge. `jwt()` no Node roda em `auth()` (Server
    // Components/Actions); +1 SELECT indexado por PK por invocação — barato, mas
    // não roda no middleware (que fica DB-free). Ver ADR 0023.
    async jwt(params) {
      // Roda o jwt() edge-safe (carimbo) ANTES de revalidar contra o DB. Bind
      // por destructuring (não `authConfig.callbacks!.jwt!(...)`): se um refactor
      // futuro reestruturasse `auth.config.ts` e removesse o jwt edge, isto vira
      // erro de tipo aqui em vez de um null-deref silencioso em runtime.
      const { jwt: stampJwt } = authConfig.callbacks;
      const stamped = await stampJwt(params);
      if (!stamped) return stamped;
      return revalidateToken(stamped, getUserAccessState);
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
