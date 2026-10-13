/**
 * Lock durável pros crons (issue #126; genérico por chave desde #555). Move o lock que antes vivia
 * process-scoped em `InMemoryCacheStore` (e se perdia em cold start) pra um
 * `SET NX EX` no Vercel KV (Upstash Redis), espelhando o padrão canônico de
 * `lib/rate-limit.ts`:
 *
 *   - Construção explícita `new Redis({ url, token })` (NÃO Redis.fromEnv()): o
 *     Vercel KV expõe KV_REST_API_URL/KV_REST_API_TOKEN, fromEnv() espera
 *     UPSTASH_REDIS_REST_URL/TOKEN.
 *   - Singleton por processo, construído sob demanda (não no top-level) pra que
 *     o fail-open e o stub de env nos testes funcionem.
 *   - **Fail-open quando o KV não está configurado** (dev/test): cai no lock
 *     in-memory antigo (mesma semântica do sync-upcoming-fixtures original).
 *
 * Atomicidade: `SET key val NX EX ttl` ou seta-e-vence-a-corrida (→ "OK") ou
 * falha o NX porque outra instância já segura o lock (→ null). O fail-open
 * in-memory reproduz isso com um get→set check-and-set NÃO atômico — aceitável
 * porque só roda em dev/test single-instance. Por isso NÃO estendemos
 * `CacheStore` (a interface get/set/delete não expressa check-and-set atômico).
 */

import { Redis } from "@upstash/redis";

import { inMemoryCache } from "@/lib/cache/in-memory";

// Mantido idêntico ao valor histórico — os testes asseguram esta string.
export const SYNC_LOCK_KEY = "sync:upcoming-fixtures:lock";

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h, só o fallback do opts.ttlMs

// Singleton por processo, construído UMA vez quando as envs do KV existem.
let cached: Redis | null = null;
let warned = false;

function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    // Fail-open: sem KV (dev local/test) caímos no lock in-memory. Espelha o
    // fail-open de rate-limit; warn-once pra não poluir o log.
    if (!warned) {
      console.warn(
        "[sync-lock] KV_REST_API_URL/KV_REST_API_TOKEN unset — using in-memory sync lock (fail-open, dev only).",
      );
      warned = true;
    }
    return null;
  }
  if (!cached) {
    cached = new Redis({ url, token });
  }
  return cached;
}

/**
 * Tenta adquirir o lock `key`. Retorna `true` quando este chamador o segura
 * (deve seguir e rodar o job), `false` quando outro já segura (no-op).
 *
 * - KV: `SET key stamp NX EX ttl`. Sem `force`, o `nx` garante que só um
 *   chamador vença a corrida (resultado "OK"); um segundo recebe `null` →
 *   `false`. Com `force: true` dropamos o `nx` → o SET sempre sobrescreve e
 *   sempre retorna "OK" → `true` (o cron do sync usa isso pra refrescar o lock e
 *   bypassar qualquer lock preso).
 * - Fail-open (sem KV): check-and-set in-memory — presente ⇒ `false`, ausente
 *   ⇒ set + `true`. `force` ignora o get (sempre seta + `true`).
 *
 * Genérico por chave (#555): o sync de fixtures e o cron da base do modelo
 * (`model-base:compute:lock`) usam o mesmo mecanismo com chaves próprias.
 */
export async function acquireKvLock(
  key: string,
  opts?: { ttlMs?: number; force?: boolean },
): Promise<boolean> {
  const ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const force = opts?.force ?? false;
  const stamp = Date.now();

  const redis = getRedis();
  if (!redis) {
    // Fallback in-memory: mesma semântica do lock original do sync.
    if (!force) {
      const existing = await inMemoryCache.get<number>(key);
      if (existing !== undefined) return false;
    }
    await inMemoryCache.set(key, stamp, ttlMs);
    return true;
  }

  // `ex` é em segundos; arredonda pra cima pra nunca expirar antes do TTL pedido.
  // Os dois objetos de opção são literais distintos (não um spread condicional)
  // porque o `SetCommandOptions` do Upstash é uma união discriminada que não
  // aceita `nx?: true` opcional — com `nx` (NX, só seta se ausente) ou sem
  // (force: sobrescreve sempre).
  const ttlSeconds = Math.ceil(ttlMs / 1000);
  const result = force
    ? await redis.set(key, stamp, { ex: ttlSeconds })
    : await redis.set(key, stamp, { ex: ttlSeconds, nx: true });
  return result === "OK";
}

/**
 * Libera o lock `key` (KV `DEL` ou delete in-memory).
 *
 * Best-effort: é um `DEL` cego (não compare-and-delete pelo stamp), então em
 * teoria pode apagar o lock de outro holder se um `force` tiver re-stampado
 * nesse meio-tempo. Inofensivo nos dois usos: o pior caso é um run extra,
 * absorvido pelas escritas idempotentes (upsert do sync, fingerprint da base).
 */
export async function releaseKvLock(key: string): Promise<void> {
  const redis = getRedis();
  if (!redis) {
    await inMemoryCache.delete(key);
    return;
  }
  await redis.del(key);
}

/**
 * Lock do sync de fixtures (wrapper de `acquireKvLock` com `SYNC_LOCK_KEY`).
 * O caminho de erro do sync chama `releaseSyncLock()` pra permitir retry
 * imediato; o caminho feliz deixa o lock vencer sozinho por TTL.
 */
export function acquireSyncLock(opts?: {
  ttlMs?: number;
  force?: boolean;
}): Promise<boolean> {
  return acquireKvLock(SYNC_LOCK_KEY, opts);
}

export function releaseSyncLock(): Promise<void> {
  return releaseKvLock(SYNC_LOCK_KEY);
}
