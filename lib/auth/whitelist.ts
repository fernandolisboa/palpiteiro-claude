/**
 * Floor de e-mails do env `ALLOWED_EMAILS` (lista separada por vírgula), checagem
 * env-only e edge-safe.
 *
 * NÃO é mais o gate de cadastro: desde o self-provision aberto (#257, ADR 0023) o
 * `signIn` usa `isSignInAllowed` (lib/auth/whitelist-db.ts), allow-by-default — e-mail
 * novo entra e é auto-provisionado; só `users.allowed=false` recusa. Este floor
 * continua como anti-lockout (e-mail do env sempre entra, nunca é bloqueável), como
 * fallback quando o DB falha, e como atalho nas actions (`!access.allowed &&
 * !isEmailAllowed(...)`).
 *
 * Histórico: ADR 0007 (emenda o 0004) começou com a whitelist só no env.
 */

function parseAllowedEmails(raw: string | undefined): ReadonlySet<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );
}

export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  // Reparseado a cada chamada (não cacheado em módulo) pra refletir mudança de
  // env sem rebuild em runtime serverless — o custo é desprezível.
  const allowed = parseAllowedEmails(process.env.ALLOWED_EMAILS);
  return allowed.has(email.trim().toLowerCase());
}
