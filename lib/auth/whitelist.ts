/**
 * Whitelist de e-mails autorizados a logar (proteção de custo — sem ela
 * qualquer um se cadastra e queima quota de Anthropic / providers).
 *
 * Fonte autoritativa: env `ALLOWED_EMAILS` (lista separada por vírgula).
 * Aplicada no callback `signIn` do Auth.js, que roda ANTES do envio do magic
 * link — e-mail fora da lista → `AccessDenied` → nenhum e-mail enviado, nenhum
 * token criado.
 *
 * ADR 0007 (que emenda o 0004): para o MVP a whitelist vive no env, não em
 * tabela. A coluna `users.allowed` permanece para uma futura whitelist em DB.
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
