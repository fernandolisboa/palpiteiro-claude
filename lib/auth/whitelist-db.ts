import { isEmailAllowed } from "@/lib/auth/whitelist";
import { isEmailWhitelistedInDb } from "@/lib/db/queries/invites";

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
