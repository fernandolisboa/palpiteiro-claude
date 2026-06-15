import type { JWT } from "next-auth/jwt";

type AccessState = { role: "admin" | "user"; allowed: boolean };

/**
 * Revalida role+allowed do token contra o DB a cada invocação do `jwt()` (#252,
 * ADR 0023). Mora aqui (lib/, testável) e é chamada pelo override Node do
 * `jwt()` em `auth.ts` — NUNCA pelo config edge (`auth.config.ts`), que fica
 * DB-free pra não puxar o cliente Neon pro bundle do middleware (ADR 0009).
 *
 * Contrato:
 *  - Sem `token.id` (não deveria acontecer pós-carimbo, mas defensivo): passa o
 *    token adiante inalterado, sem ler o DB.
 *  - Row deletada (`getState` → null, ex.: reset + claim-admin com cookie
 *    velho): retorna null. O @auth/core trata null no `jwt()` como drop de
 *    sessão (limpa o cookie — `lib/actions/session.js`), então a sessão órfã
 *    morre no próximo request.
 *  - Caso normal: copia role+allowed FRESCOS do DB pro token. Mudança de role
 *    (bug da fiancée) e bloqueio (`allowed=false`) passam a valer SEM novo login.
 *
 * IMPORTANTE (anti-lockout, ADR 0023): NÃO derruba a sessão por `allowed=false`.
 * A whitelist tem um floor de env (`ALLOWED_EMAILS`) que autoriza o login SEM
 * que o DB esteja `allowed=true`; derrubar a sessão aqui por `allowed=false`
 * criaria um loop infinito (signIn autoriza via env → jwt() derruba → /signin →
 * repete) pra qualquer conta do floor (ex.: admin bloqueado). O bloqueio efetivo
 * de custo é a leitura DIRETA do DB em analyzeMatch (#264), e o `allowed` fresco
 * fica no token pra qualquer outra checagem futura.
 */
export async function revalidateToken(
  token: JWT,
  getState: (id: string) => Promise<AccessState | null>,
): Promise<JWT | null> {
  if (!token.id) return token;
  const state = await getState(token.id);
  if (!state) return null;
  token.role = state.role;
  token.allowed = state.allowed;
  return token;
}
