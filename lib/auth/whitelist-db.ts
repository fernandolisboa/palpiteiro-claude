import { isEmailAllowed } from "@/lib/auth/whitelist";
import { isEmailWhitelistedInDb } from "@/lib/db/queries/invites";
import { getUserAllowedByEmail } from "@/lib/db/queries/users";

/**
 * Checagem de whitelist DB-aware (ADR 0009). Compõe as três fontes:
 * env `ALLOWED_EMAILS` (floor permanente) + `users.allowed` + `pending_invites`.
 *
 * Módulo Node-only — NUNCA importar do `auth.config.ts`/edge (puxaria o cliente
 * Neon pro bundle do middleware). Vive aqui pra manter `whitelist.ts` como a
 * checagem env-only edge-safe intacta.
 *
 * - Env PRIMEIRO (short-circuit): no caminho admin/env retorna true sem ler o DB
 *   — também torna o env o floor permanente (admin nunca trava, sobrevive a
 *   tabela vazia).
 * - Erro de leitura do DB → cai pro resultado env-only (admin/env ainda funciona,
 *   e-mails desconhecidos recusados = cost-safe; nunca falha aberto).
 *
 * `isEmailWhitelistedInDb` e `isEmailAllowed` já normalizam o e-mail (trim +
 * lowercase) — o e-mail passa por aqui inalterado.
 */
export async function isEmailAllowedWithDb(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  if (isEmailAllowed(email)) return true;
  try {
    return await isEmailWhitelistedInDb(email);
  } catch {
    return isEmailAllowed(email);
  }
}

/**
 * Gate de signIn do self-provision ABERTO (ADR 0023 §3/§6, #257). Substitui o
 * invite-only de `isEmailAllowedWithDb`: o default daqui é ALLOW, exceto
 * bloqueio explícito. Regra (mesma ordem env-first que `isEmailAllowedWithDb`,
 * inegociável — §6: o floor do env NUNCA é auto-bloqueável):
 *
 *  (defensivo) e-mail vazio → false (nunca passa).
 *  (a) e-mail no floor do env `ALLOWED_EMAILS` → SEMPRE allow, SEM ler o DB
 *      (anti-lockout do dono/admin — o short-circuit que a §6 exige).
 *  (c) e-mail NOVO (sem row no DB) → allow (auto-provisionado).
 *  (b) row existente: `allowed=true` → allow; `allowed=false` → reject (bloqueado).
 *  (erro de DB) → cai pro env-only (desconhecido recusado = conservador, sem
 *      auto-provisionar às cegas durante uma falha de leitura).
 *
 * NÃO reusa `isEmailWhitelistedInDb`/`isEmailAllowedWithDb`: aqueles retornam
 * `false` pra e-mail sem row (semântica invite-only), o oposto do allow-by-
 * default. Módulo Node-only — NUNCA importar do `auth.config.ts`/edge.
 */
export async function isSignInAllowed(
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  if (isEmailAllowed(email)) return true;
  try {
    const row = await getUserAllowedByEmail(email);
    if (row === null) return true;
    return row.allowed;
  } catch {
    return isEmailAllowed(email);
  }
}
