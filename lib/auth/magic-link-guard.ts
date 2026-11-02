import { clientIp, ipBucketKey } from "@/lib/auth/client-ip";
import {
  checkMagicLinkGlobalRateLimit,
  checkMagicLinkIpRateLimit,
  checkMagicLinkRateLimit,
} from "@/lib/auth/magic-link-rate-limit";

type HeaderReader = Parameters<typeof clientIp>[0];

/**
 * Tetos de envio do magic link (cost-safety, ADR 0023 §3, report 01 achado #1, #435/#469),
 * num lugar só pros DOIS caminhos que disparam o Resend: a server action `sendMagicLink`
 * e o POST cru do Auth.js em `/api/auth/signin/resend` (que fica fora do middleware e,
 * antes da auditoria 2026-11-01, pulava todos os tetos).
 *
 * Ordem: por origem (IPv4 ou /64) → por e-mail → global POR ÚLTIMO, pra um script barrado
 * por IP/e-mail não gastar o orçamento global. Sem IP válido (dev) → pula o teto por IP.
 * Retorna `true` quando o envio pode seguir.
 */
export async function isMagicLinkSendAllowed(
  email: string,
  headers: HeaderReader,
): Promise<boolean> {
  const rawIp = clientIp(headers);
  const ipBucket = rawIp ? ipBucketKey(rawIp) : null;
  if (ipBucket && !(await checkMagicLinkIpRateLimit(ipBucket))) return false;
  if (!(await checkMagicLinkRateLimit(email))) return false;
  return checkMagicLinkGlobalRateLimit();
}

/** Normalização do e-mail do form, igual à da action (trim + lowercase). */
export function normalizeMagicLinkEmail(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase();
}
