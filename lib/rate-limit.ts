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
  // "timeout": o Upstash não respondeu a tempo e o `limit()` falhou ABERTO
  // (`ok:true`, `remaining:0` sem significado) — o caller não deve ler `remaining`
  // como budget do dia.
  reason?: "fail-closed" | "timeout";
};

const DEFAULT_USER_LIMIT = 20;
const DEFAULT_ADMIN_LIMIT = 200;
// Teto diário de geração de palpites por usuário (#315, ADR 0028). Bucket SEPARADO
// das análises pagas: palpite roda em Haiku (~US$0.002/set), é universal (sem split
// admin) e o auto-run já falha em silêncio — daí o fail-OPEN sem KV (ver
// checkPalpitesRateLimit). Owner-tunável via RATE_LIMIT_PALPITES_PER_DAY.
const DEFAULT_PALPITES_LIMIT = 50;
// Tetos diários da "aposta livre" (ADR 0036, Decisão 8). Buckets SEPARADOS e
// fail-CLOSED pra não-admin (como as análises pagas, NÃO como palpites): o gatilho é
// input arbitrário digitado pelo usuário — spammable — então sem KV o default seguro
// é negar (mesmo racional do ADR 0023). O parse cobre 1 chamada Haiku por texto; o
// de slips cobre a criação (inclusive slips editor-only/Poisson-only, que não passam
// pelo parse), fechando o único caminho não-metrado. Owner-tunáveis via env.
const DEFAULT_BET_PARSE_LIMIT = 30;
const DEFAULT_BET_SLIPS_LIMIT = 30;

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
let cached: {
  user: Ratelimit;
  admin: Ratelimit;
  palpites: Ratelimit;
  betParse: Ratelimit;
  betSlips: Ratelimit;
} | null = null;
let warned = false;

function getLimiters(): {
  user: Ratelimit;
  admin: Ratelimit;
  palpites: Ratelimit;
  betParse: Ratelimit;
  betSlips: Ratelimit;
} | null {
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
      // Palpites (#315): prefixo DISTINTO — NUNCA colide com analyze, então o
      // auto-run de palpite jamais dreana os 20/dia de análise paga. Sem split de
      // role (palpite é universal). 50/dia por usuário (owner-tunável).
      palpites: new Ratelimit({
        redis,
        limiter: Ratelimit.fixedWindow(
          limitFromEnv("RATE_LIMIT_PALPITES_PER_DAY", DEFAULT_PALPITES_LIMIT),
          "1 d",
        ),
        prefix: "ratelimit:palpites",
      }),
      // Aposta livre (ADR 0036): prefixos DISTINTOS. betParse cobre o parse Haiku;
      // betSlips cobre a criação de slip no confirm. Sem split de role no limiter
      // (o fail-closed por role vive nos checks abaixo).
      betParse: new Ratelimit({
        redis,
        limiter: Ratelimit.fixedWindow(
          limitFromEnv("RATE_LIMIT_BET_PARSE_PER_DAY", DEFAULT_BET_PARSE_LIMIT),
          "1 d",
        ),
        prefix: "ratelimit:bet-parse",
      }),
      betSlips: new Ratelimit({
        redis,
        limiter: Ratelimit.fixedWindow(
          limitFromEnv("RATE_LIMIT_BET_SLIPS_PER_DAY", DEFAULT_BET_SLIPS_LIMIT),
          "1 d",
        ),
        prefix: "ratelimit:bet-slips",
      }),
    };
  }
  return cached;
}

// Fallback fail-CLOSED por role (ADR 0023), compartilhado pelos dois limiters da
// aposta livre: admin fail-OPEN (dono roda sem KV), não-admin fail-CLOSED (negar é
// o default seguro de custo pra um gatilho spammable).
function failClosedByRole(role?: string): RateLimitResult {
  if (role === "admin") {
    return { ok: true, limit: Infinity, remaining: Infinity, reset: 0 };
  }
  return { ok: false, limit: 0, remaining: 0, reset: 0, reason: "fail-closed" };
}

/**
 * Teto diário do PARSE de aposta livre (ADR 0036, Decisão 8a). Bucket próprio
 * (prefixo `ratelimit:bet-parse`), fail-CLOSED pra não-admin sem KV — o parse é
 * gatilhado por texto arbitrário digitado (spammable), então NÃO consome os 20/dia
 * de análise (cobrar um slot por um typo seria mis-escalado).
 */
export async function checkBetParseRateLimit(
  userId: string,
  role?: string,
): Promise<RateLimitResult> {
  const limiters = getLimiters();
  if (!limiters) return failClosedByRole(role);
  const { success, limit, remaining, reset } =
    await limiters.betParse.limit(userId);
  return { ok: success, limit, remaining, reset };
}

/**
 * Teto diário de CRIAÇÃO de slips (ADR 0036, Decisão 8f). Cobrado no confirm —
 * cobre TAMBÉM slips editor-only (sem parse), fechando o único caminho não-metrado
 * de escrita/getStandings. Bucket próprio (`ratelimit:bet-slips`), fail-CLOSED
 * pra não-admin (mesmo racional do parse).
 */
export async function checkBetSlipsRateLimit(
  userId: string,
  role?: string,
): Promise<RateLimitResult> {
  const limiters = getLimiters();
  if (!limiters) return failClosedByRole(role);
  const { success, limit, remaining, reset } =
    await limiters.betSlips.limit(userId);
  return { ok: success, limit, remaining, reset };
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
  const { success, limit, remaining, reset, reason } =
    await limiter.limit(userId);
  return {
    ok: success,
    limit,
    remaining,
    reset,
    ...(reason === "timeout" ? { reason: "timeout" as const } : {}),
  };
}

/**
 * Verifica (e incrementa) o teto diário de GERAÇÃO de palpites do usuário (#315,
 * ADR 0028). Bucket próprio (prefixo `ratelimit:palpites`), SEM split de role —
 * palpite é universal e roda em Haiku.
 *
 * Sem KV configurado → fail-OPEN (decisão FINAL, PLAN §3): diferente da análise
 * paga (fail-closed por custo), travar palpite por falta de KV só degradaria a UX
 * sem ganho material — Haiku é barato e o auto-run já falha em silêncio. Em prod
 * com KV, o limite de 50/dia por usuário vale.
 */
export async function checkPalpitesRateLimit(
  userId: string,
): Promise<RateLimitResult> {
  const limiters = getLimiters();
  if (!limiters) {
    return { ok: true, limit: Infinity, remaining: Infinity, reset: 0 };
  }
  const { success, limit, remaining, reset } =
    await limiters.palpites.limit(userId);
  return { ok: success, limit, remaining, reset };
}
