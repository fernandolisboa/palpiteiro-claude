/**
 * Rate-limit do ENVIO de magic link (proteção de custo/spam — ADR 0023 §3, #257).
 *
 * Com o self-provision aberto, a whitelist deixa de barrar quem dispara o envio,
 * então qualquer um poderia pedir N links a um e-mail arbitrário — cada um é um
 * e-mail PAGO via Resend (e um 4xx do Resend NÃO é free de quota). Este teto
 * roda em `sendMagicLink` (`app/signin/page.tsx`) ANTES de chamar
 * `signIn("resend", ...)`, recusando o estouro sem nunca gerar e-mail/token.
 *
 * Espelha o padrão canônico de `lib/rate-limit.ts` (singleton lazy, construção
 * explícita `new Redis({ url, token })`, NÃO Redis.fromEnv() — o Vercel KV expõe
 * KV_REST_API_URL/TOKEN), mas é PRÉ-AUTH (sem userId/role) → a chave é o e-mail
 * normalizado. Distinto de `checkAnalysisRateLimit` (userId-keyed, fail-CLOSED
 * pra não-admin): aqui não há role pra discriminar, então sem KV cai no
 * fail-OPEN warn-once de `lib/sync/lock.ts` — o dono roda `pnpm dev` sem KV e o
 * caminho de login não pode travar (OAuth/passkey também não custam e-mail). Em
 * prod o KV está sempre presente; e a guarda de custo FORTE do Anthropic (#264,
 * fail-closed) é independente desta. Trade-off documentado na ADR 0023.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const DEFAULT_PER_HOUR = 5;

/**
 * Lê um teto inteiro positivo do env, com fallback NaN/<=0-guarded. Lido UMA vez
 * na construção do singleton — mudar RATE_LIMIT_MAGIC_LINK_PER_HOUR exige restart
 * (cold start em serverless pega o valor novo). Mesmo padrão de `lib/rate-limit.ts`.
 */
function limitFromEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Singleton por processo, construído UMA vez quando as envs do KV existem (não no
// top-level, pra que o fail-open e o stub de env nos testes funcionem).
let cached: Ratelimit | null = null;
let warned = false;

function getLimiter(): Ratelimit | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    // Fail-OPEN sem KV (dev/local): o caminho de login não pode travar e este é
    // só anti-spam de e-mail, não a guarda de custo do Anthropic (#264, fail-
    // closed e independente). Warn-once pra não poluir o log — espelha lock.ts.
    if (!warned) {
      console.warn(
        "[magic-link-rate-limit] KV_REST_API_URL/KV_REST_API_TOKEN unset — fail-open (dev only, ADR 0023).",
      );
      warned = true;
    }
    return null;
  }
  if (!cached) {
    const redis = new Redis({ url, token });
    cached = new Ratelimit({
      redis,
      limiter: Ratelimit.fixedWindow(
        limitFromEnv("RATE_LIMIT_MAGIC_LINK_PER_HOUR", DEFAULT_PER_HOUR),
        "1 h",
      ),
      prefix: "ratelimit:magic-link",
    });
  }
  return cached;
}

/**
 * Verifica (e incrementa) o teto de envios de magic link pro e-mail. Retorna
 * `true` quando o envio é permitido, `false` quando o teto foi estourado.
 *
 * Sem KV configurado: fail-OPEN (`true`) — ver nota do módulo. O e-mail é
 * normalizado (trim+lowercase) pra a chave casar com a normalização que a action
 * já faz no input.
 */
export async function checkMagicLinkRateLimit(email: string): Promise<boolean> {
  const limiter = getLimiter();
  if (!limiter) return true;
  const key = email.trim().toLowerCase();
  const { success } = await limiter.limit(key);
  return success;
}
