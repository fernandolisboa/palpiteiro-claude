/**
 * Teto diário de análises por usuário (proteção de custo — cada análise dispara
 * uma chamada paga ao Anthropic; ver gotcha de tokens em CLAUDE.md).
 *
 * Implementado com Upstash Ratelimit sobre o Vercel KV (que é Upstash Redis por
 * baixo). Aplicado em `analyzeMatch` ANTES de qualquer chamada a `predict()`.
 * Admin tem um limite separado/maior, com prefixo de chave distinto pra que os
 * contadores de user e admin nunca colidam.
 *
 * Follow-up de rate-limit deferido na ADR 0007.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  reset: number;
  // Discriminador explícito do fallback fail-CLOSED (KV ausente p/ não-admin):
  // o caller distingue "indisponível" de "teto real atingido" por ESTE campo, não
  // por `limit === 0` — um `limit:0` legítimo (config de Upstash inesperada) nunca
  // dispara a copy de indisponibilidade por engano (ADR 0023).
  reason?: "fail-closed";
};

const DEFAULT_USER_LIMIT = 20;
const DEFAULT_ADMIN_LIMIT = 200;

/**
 * Lê um teto inteiro positivo do env, com fallback NaN/<=0-guarded. Diferente do
 * reparse-por-chamada de `lib/auth/whitelist.ts`: aqui o valor é lido UMA vez na
 * construção do singleton (`getLimiters`), então mudar
 * RATE_LIMIT_ANALYSES_PER_DAY(_ADMIN) exige restart do processo (cold start em
 * serverless pega o valor novo).
 */
function limitFromEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Singleton por processo: o cliente Redis + os limiters são construídos UMA vez,
// mas só quando as envs do KV existem (construir no top-level do módulo
// impediria o fail-open e o stub de env nos testes).
let cached: { user: Ratelimit; admin: Ratelimit } | null = null;
let warned = false;

function getLimiters(): { user: Ratelimit; admin: Ratelimit } | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    // Sem KV configurado: o caller (checkAnalysisRateLimit) decide o fallback por
    // role — admin fail-OPEN (dono roda `pnpm dev` sem KV), não-admin fail-CLOSED
    // (buraco de custo quando o cadastro abrir; ADR 0023). Aqui só avisamos uma vez.
    if (!warned) {
      console.warn(
        "[rate-limit] KV_REST_API_URL/KV_REST_API_TOKEN unset — admin fail-open, non-admin fail-closed (ADR 0023).",
      );
      warned = true;
    }
    return null;
  }
  if (!cached) {
    // Construção explícita (NÃO Redis.fromEnv()): o Vercel KV expõe
    // KV_REST_API_URL/KV_REST_API_TOKEN, enquanto fromEnv() espera
    // UPSTASH_REDIS_REST_URL/TOKEN.
    const redis = new Redis({ url, token });
    // fixedWindow(N, '1 d') reseta 24h após o primeiro hit da janela — satisfaz
    // "reseta no dia seguinte". Prefixos distintos isolam user vs admin.
    cached = {
      user: new Ratelimit({
        redis,
        limiter: Ratelimit.fixedWindow(
          limitFromEnv("RATE_LIMIT_ANALYSES_PER_DAY", DEFAULT_USER_LIMIT),
          "1 d",
        ),
        prefix: "ratelimit:analyze",
      }),
      admin: new Ratelimit({
        redis,
        limiter: Ratelimit.fixedWindow(
          limitFromEnv("RATE_LIMIT_ANALYSES_PER_DAY_ADMIN", DEFAULT_ADMIN_LIMIT),
          "1 d",
        ),
        prefix: "ratelimit:analyze:admin",
      }),
    };
  }
  return cached;
}

/**
 * Verifica (e incrementa) o teto diário de análises do usuário. Admin
 * (`role === "admin"`, a mesma checagem usada no override de modelo) cai no
 * limiter de admin.
 *
 * Sem KV configurado (dev local / KV ausente em prod), o fallback é por role
 * (ADR 0023):
 *  - admin → fail-OPEN (`ok:true`, limit Infinity): o dono roda `pnpm dev` sem
 *    KV e nunca trava as próprias análises.
 *  - não-admin → fail-CLOSED (`ok:false`, `reason:"fail-closed"`): sem o teto, um
 *    usuário comum poderia gastar Anthropic sem limite quando o cadastro abrir.
 *    Recusar é o default seguro de custo. O `reason` (não `limit:0`) sinaliza pro
 *    caller (analyzeMatch) usar a copy de indisponibilidade em vez de "limite de 0
 *    análises" — assim um `limit:0` legítimo do Upstash nunca a dispara por engano.
 */
export async function checkAnalysisRateLimit(
  userId: string,
  role?: string,
): Promise<RateLimitResult> {
  const limiters = getLimiters();
  if (!limiters) {
    if (role === "admin") {
      return { ok: true, limit: Infinity, remaining: Infinity, reset: 0 };
    }
    return {
      ok: false,
      limit: 0,
      remaining: 0,
      reset: 0,
      reason: "fail-closed",
    };
  }
  const limiter = role === "admin" ? limiters.admin : limiters.user;
  const { success, limit, remaining, reset } = await limiter.limit(userId);
  return { ok: success, limit, remaining, reset };
}
