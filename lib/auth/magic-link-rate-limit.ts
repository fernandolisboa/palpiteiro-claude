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

import * as Sentry from "@sentry/nextjs";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const DEFAULT_PER_HOUR = 5;
// Teto por IP de origem (report 01 achado #1 / #435). O teto por-e-mail acima não barra
// email-bombing: um atacante distribui ≤5 envios/h por endereço sobre uma lista ILIMITADA
// de e-mails de vítimas, de IPs ilimitados → volume agregado ilimitado de e-mails Resend
// pagos. O teto por IP corta o agregado na origem. Mais folgado que o por-e-mail (um usuário
// legítimo raramente pede >10 links/h).
const DEFAULT_IP_PER_HOUR = 10;
// Teto global por dia (#469) — abaixo dos 100/dia do free tier do Resend.
const DEFAULT_GLOBAL_PER_DAY = 80;

/**
 * Lê um teto inteiro positivo do env, com fallback NaN/<=0-guarded. Lido UMA vez
 * na construção do singleton — mudar RATE_LIMIT_MAGIC_LINK_PER_HOUR exige restart
 * (cold start em serverless pega o valor novo). Mesmo padrão de `lib/rate-limit.ts`.
 */
function limitFromEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// Três buckets independentes (prefixos próprios), todos fixedWindow sobre o mesmo KV:
//  - por e-mail   → não deixa spammar UMA vítima;
//  - por IP (/64) → corta o agregado de um script single-origin (report 01 #1, #435/#469);
//  - global       → circuit breaker de custo do Resend (#469): um atacante com muitas
//    origens ainda esbarra num teto app-wide, que fica ABAIXO da quota diária do free tier
//    do Resend (100/dia, docs/ops/03-email-resend.md) pra sobrar envio pros alertas de gasto.
//    Estourado, o magic link fica indisponível até a janela virar, mas Google/passkey seguem
//    funcionando (não custam e-mail) — preferível a queimar a quota inteira.
type LimiterSpec = {
  prefix: string;
  envName: string;
  fallback: number;
  window: "1 h" | "24 h";
};

const EMAIL_SPEC: LimiterSpec = {
  prefix: "ratelimit:magic-link",
  envName: "RATE_LIMIT_MAGIC_LINK_PER_HOUR",
  fallback: DEFAULT_PER_HOUR,
  window: "1 h",
};
const IP_SPEC: LimiterSpec = {
  prefix: "ratelimit:magic-link-ip",
  envName: "RATE_LIMIT_MAGIC_LINK_IP_PER_HOUR",
  fallback: DEFAULT_IP_PER_HOUR,
  window: "1 h",
};
const GLOBAL_SPEC: LimiterSpec = {
  prefix: "ratelimit:magic-link-global",
  envName: "RATE_LIMIT_MAGIC_LINK_GLOBAL_PER_DAY",
  fallback: DEFAULT_GLOBAL_PER_DAY,
  window: "24 h",
};

// Singletons por processo, construídos UMA vez quando as envs do KV existem (não no
// top-level, pra que o fail-open e o stub de env nos testes funcionem).
const cached = new Map<string, Ratelimit>();
let warned = false;

function getLimiter(spec: LimiterSpec): Ratelimit | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    // Fail-OPEN sem KV (dev/local): o caminho de login não pode travar e este é
    // só anti-spam de e-mail, não a guarda de custo do Anthropic (#264, fail-
    // closed e independente). Warn-once pra não poluir o log — espelha lock.ts.
    if (!warned) {
      console.warn(
        "[magic-link-rate-limit] KV_REST_API_URL/KV_REST_API_TOKEN unset — fail-open (dev only, ADR 0023)."
      );
      warned = true;
    }
    return null;
  }
  let limiter = cached.get(spec.prefix);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.fixedWindow(
        limitFromEnv(spec.envName, spec.fallback),
        spec.window
      ),
      prefix: spec.prefix,
    });
    cached.set(spec.prefix, limiter);
  }
  return limiter;
}

async function allowed(spec: LimiterSpec, key: string): Promise<boolean> {
  const limiter = getLimiter(spec);
  if (!limiter) return true;
  const { success } = await limiter.limit(key);
  return success;
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
  return allowed(EMAIL_SPEC, email.trim().toLowerCase());
}

/**
 * Verifica (e incrementa) o teto de envios de magic link pra origem. `bucket` é a
 * chave de `ipBucketKey` (IPv4 cru ou prefixo IPv6 /64). Sem KV: fail-OPEN.
 */
export async function checkMagicLinkIpRateLimit(
  bucket: string
): Promise<boolean> {
  return allowed(IP_SPEC, bucket);
}

// Throttle do alerta: num flood, cada request pós-teto estouraria de novo — um evento
// Sentry por instância por hora basta pra o dono saber que o circuit breaker abriu.
const TRIP_REPORT_INTERVAL_MS = 60 * 60 * 1000;
let lastTripReport = 0;

/**
 * Verifica (e incrementa) o teto GLOBAL de envios de magic link (app-wide, janela de
 * 24h). Sem KV: fail-OPEN. Ao estourar, avisa no Sentry (throttled).
 */
export async function checkMagicLinkGlobalRateLimit(): Promise<boolean> {
  const ok = await allowed(GLOBAL_SPEC, "global");
  if (!ok && Date.now() - lastTripReport > TRIP_REPORT_INTERVAL_MS) {
    lastTripReport = Date.now();
    Sentry.captureMessage("magic-link global rate limit tripped", "warning");
  }
  return ok;
}
