import { isEmailAllowed } from "@/lib/auth/whitelist";
import { getUserAllowedByEmail } from "@/lib/db/queries/users";

/**
 * Gate de signIn do self-provision ABERTO (ADR 0023 §3/§6, #257). O default daqui
 * é ALLOW, exceto bloqueio explícito. Regra (ordem env-first inegociável — §6: o
 * floor do env NUNCA é auto-bloqueável):
 *
 *  (defensivo) e-mail vazio → false (nunca passa).
 *  (a) e-mail no floor do env `ALLOWED_EMAILS` → SEMPRE allow, SEM ler o DB
 *      (anti-lockout do dono/admin — o short-circuit que a §6 exige).
 *  (c) e-mail NOVO (sem row no DB) → allow (auto-provisionado).
 *  (b) row existente: `allowed=true` → allow; `allowed=false` → reject (bloqueado).
 *  (erro de DB) → cai pro env-only (desconhecido recusado = conservador, sem
 *      auto-provisionar às cegas durante uma falha de leitura).
 *
 * Lê `users.allowed` via `getUserAllowedByEmail` (allow-by-default: e-mail sem row
 * passa). `isEmailAllowed` já normaliza o e-mail (trim + lowercase). Módulo
 * Node-only — NUNCA importar do `auth.config.ts`/edge (puxaria o cliente Neon pro
 * bundle do middleware); `whitelist.ts` segue como a checagem env-only edge-safe.
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

/**
 * Passkey NUNCA cria conta (auditoria de segurança 2026-11-01). O @auth/core aceita
 * `register` deslogado quando o e-mail ainda não tem row e cria o `users` SEM provar
 * posse do e-mail. Como Google (`allowDangerousEmailAccountLinking`) e o magic link
 * resolvem a conta por e-mail, quem registrasse uma passkey com o e-mail da vítima
 * ANTES dela se cadastrar entraria depois na conta dela (pre-account takeover).
 *
 * Regra: login `webauthn` só passa quando já existe row pro e-mail (passkey é método
 * ADICIONAL, cadastrado logado em /perfil — ADR 0023). Sem row → recusa, inclusive
 * pro floor do env. Erro de DB → recusa (fail-closed). Os demais providers seguem
 * `isSignInAllowed`.
 */
export async function isSignInAllowedForAccount(
  email: string | null | undefined,
  accountType: string | undefined,
): Promise<boolean> {
  if (accountType === "webauthn") {
    if (!email) return false;
    try {
      const row = await getUserAllowedByEmail(email);
      if (row === null) return false;
    } catch {
      return false;
    }
  }
  return isSignInAllowed(email);
}
