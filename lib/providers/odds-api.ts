import type { z } from "zod";

import { inMemoryCache } from "@/lib/cache/in-memory";
import type { CacheStore } from "@/lib/cache/types";
import { ODDS_API_BASE_URL } from "@/lib/providers/odds-api-constants";
import {
  EventOddsSchema,
  SportOddsResponseSchema,
  SportsResponseSchema,
  type OddsApiEventOdds,
  type OddsApiSport,
} from "@/lib/providers/odds-api-schemas";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const JITTER_RATIO = 0.2;

const ONE_MINUTE = 60_000;
const FIVE_MINUTES = 5 * ONE_MINUTE;
const FIFTEEN_MINUTES = 15 * ONE_MINUTE;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;

const DEFAULT_REGIONS = ["eu"] as const;
const DEFAULT_MARKETS = ["totals"] as const;

const QUOTA_WARN_THRESHOLD = 50;
const QUOTA_CRITICAL_THRESHOLD = 10;

// ─── Errors ──────────────────────────────────────────────────────────────────

export class OddsApiError extends Error {
  readonly endpoint: string;
  readonly params: Record<string, string | number>;
  constructor(
    message: string,
    endpoint: string,
    params: Record<string, string | number>,
  ) {
    super(message);
    this.name = "OddsApiError";
    this.endpoint = endpoint;
    this.params = params;
  }
}

export class OddsApiHttpError extends OddsApiError {
  readonly status: number;
  readonly body: string;
  constructor(
    message: string,
    endpoint: string,
    params: Record<string, string | number>,
    status: number,
    body: string,
  ) {
    super(message, endpoint, params);
    this.name = "OddsApiHttpError";
    this.status = status;
    this.body = body;
  }
}

export class OddsApiSchemaError extends OddsApiError {
  readonly zodError: z.ZodError;
  constructor(
    message: string,
    endpoint: string,
    params: Record<string, string | number>,
    zodError: z.ZodError,
  ) {
    super(message, endpoint, params);
    this.name = "OddsApiSchemaError";
    this.zodError = zodError;
  }
}

export class OddsApiTimeoutError extends OddsApiError {
  constructor(endpoint: string, params: Record<string, string | number>) {
    super(`Odds API request timed out for ${endpoint}`, endpoint, params);
    this.name = "OddsApiTimeoutError";
  }
}

// ─── Logging ─────────────────────────────────────────────────────────────────

type Params = Record<string, string | number | undefined>;

type Quota = {
  used: number | null;
  remaining: number | null;
  last: number | null;
};

type LogFields = {
  endpoint: string;
  params: Record<string, string | number>;
  cache_hit: boolean;
  latency_ms: number;
  status_code: number | null;
  attempt: number;
  quota_used?: number | null;
  quota_remaining?: number | null;
  quota_last?: number | null;
  error?: string;
};

function logCall(fields: LogFields): void {
  console.log(JSON.stringify({ provider: "odds-api", ...fields }));
}

function warnOnLowQuota(remaining: number | null, endpoint: string): void {
  if (remaining === null) return;
  if (remaining < QUOTA_CRITICAL_THRESHOLD) {
    console.error(
      JSON.stringify({
        provider: "odds-api",
        level: "error",
        reason: "quota_critical",
        quota_remaining: remaining,
        endpoint,
      }),
    );
  } else if (remaining < QUOTA_WARN_THRESHOLD) {
    console.warn(
      JSON.stringify({
        provider: "odds-api",
        level: "warn",
        reason: "quota_low",
        quota_remaining: remaining,
        endpoint,
      }),
    );
  }
}

function parseQuotaHeaders(headers: Headers): Quota {
  const toInt = (raw: string | null): number | null => {
    if (raw === null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  return {
    used: toInt(headers.get("x-requests-used")),
    remaining: toInt(headers.get("x-requests-remaining")),
    last: toInt(headers.get("x-requests-last")),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stripUndefined(params: Params): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function buildCacheKey(
  endpoint: string,
  params: Record<string, string | number>,
): string {
  // "/sports/soccer_brazil_campeonato/odds" -> "sports:soccer_brazil_campeonato:odds"
  const endpointSegment = endpoint.replace(/^\//, "").replace(/\//g, ":");
  const entries = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  const tail = entries.map(([k, v]) => `${k}:${v}`).join(":");
  return tail
    ? `odds-api:${endpointSegment}:${tail}`
    : `odds-api:${endpointSegment}`;
}

function buildUrl(
  endpoint: string,
  params: Record<string, string | number>,
  apiKey: string,
): string {
  const url = new URL(ODDS_API_BASE_URL + endpoint);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  url.searchParams.set("apiKey", apiKey);
  return url.toString();
}

function backoffDelayMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds && Number.isFinite(retryAfterSeconds)) {
    return Math.max(0, retryAfterSeconds * 1000);
  }
  const base = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  const jitter = base * JITTER_RATIO * (Math.random() * 2 - 1);
  return Math.max(0, Math.floor(base + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireApiKey(): string {
  const key = process.env.ODDS_API_KEY;
  if (!key) {
    throw new Error(
      "ODDS_API_KEY is not set. Define it in .env.local (see .env.example).",
    );
  }
  return key;
}

// ─── Core request ────────────────────────────────────────────────────────────

type RequestOptions<S extends z.ZodTypeAny> = {
  endpoint: string;
  params: Params;
  schema: S;
  ttlMs: number;
  cacheKeyOverride?: string;
  cache?: CacheStore;
};

async function request<S extends z.ZodTypeAny>(
  opts: RequestOptions<S>,
): Promise<z.infer<S>> {
  const params = stripUndefined(opts.params);
  const cacheKey = opts.cacheKeyOverride ?? buildCacheKey(opts.endpoint, params);
  const cache = opts.cache ?? inMemoryCache;

  const cacheStart = Date.now();
  const cached = await cache.get<z.infer<S>>(cacheKey);
  if (cached !== undefined) {
    logCall({
      endpoint: opts.endpoint,
      params,
      cache_hit: true,
      latency_ms: Date.now() - cacheStart,
      status_code: null,
      attempt: 0,
    });
    return cached;
  }

  const key = requireApiKey();
  const url = buildUrl(opts.endpoint, params, key);

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const start = Date.now();
    let statusCode: number | null = null;
    let quota: Quota = { used: null, remaining: null, last: null };

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      statusCode = response.status;
      quota = parseQuotaHeaders(response.headers);
      const text = await response.text();

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const transientError = new OddsApiHttpError(
          `Transient HTTP ${response.status} on ${opts.endpoint}`,
          opts.endpoint,
          params,
          response.status,
          text.slice(0, 2048),
        );
        if (attempt >= MAX_ATTEMPTS) {
          logCall({
            endpoint: opts.endpoint,
            params,
            cache_hit: false,
            latency_ms: Date.now() - start,
            status_code: statusCode,
            attempt,
            quota_used: quota.used,
            quota_remaining: quota.remaining,
            quota_last: quota.last,
            error: transientError.message,
          });
          warnOnLowQuota(quota.remaining, opts.endpoint);
          throw transientError;
        }
        logCall({
          endpoint: opts.endpoint,
          params,
          cache_hit: false,
          latency_ms: Date.now() - start,
          status_code: statusCode,
          attempt,
          quota_used: quota.used,
          quota_remaining: quota.remaining,
          quota_last: quota.last,
          error: `retrying after ${response.status}`,
        });
        warnOnLowQuota(quota.remaining, opts.endpoint);
        await sleep(backoffDelayMs(attempt, retryAfter));
        lastError = transientError;
        continue;
      }

      if (!response.ok) {
        const httpError = new OddsApiHttpError(
          `HTTP ${response.status} on ${opts.endpoint}`,
          opts.endpoint,
          params,
          response.status,
          text.slice(0, 2048),
        );
        logCall({
          endpoint: opts.endpoint,
          params,
          cache_hit: false,
          latency_ms: Date.now() - start,
          status_code: statusCode,
          attempt,
          quota_used: quota.used,
          quota_remaining: quota.remaining,
          quota_last: quota.last,
          error: httpError.message,
        });
        warnOnLowQuota(quota.remaining, opts.endpoint);
        throw httpError;
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new OddsApiHttpError(
          `Invalid JSON from ${opts.endpoint}`,
          opts.endpoint,
          params,
          response.status,
          text.slice(0, 2048),
        );
      }

      const parsed = opts.schema.safeParse(json);
      if (!parsed.success) {
        console.error(
          JSON.stringify({
            provider: "odds-api",
            endpoint: opts.endpoint,
            params,
            error: "schema_validation_failed",
            payload_preview: text.slice(0, 2048),
            zod_issues: parsed.error.issues.slice(0, 10),
          }),
        );
        throw new OddsApiSchemaError(
          `Schema validation failed for ${opts.endpoint}`,
          opts.endpoint,
          params,
          parsed.error,
        );
      }

      await cache.set(cacheKey, parsed.data, opts.ttlMs);

      logCall({
        endpoint: opts.endpoint,
        params,
        cache_hit: false,
        latency_ms: Date.now() - start,
        status_code: statusCode,
        attempt,
        quota_used: quota.used,
        quota_remaining: quota.remaining,
        quota_last: quota.last,
      });
      warnOnLowQuota(quota.remaining, opts.endpoint);

      return parsed.data;
    } catch (err) {
      const isAbort =
        err instanceof Error &&
        (err.name === "AbortError" ||
          (err as { name?: string }).name === "TimeoutError");
      if (isAbort) {
        if (attempt >= MAX_ATTEMPTS) {
          const timeoutError = new OddsApiTimeoutError(opts.endpoint, params);
          logCall({
            endpoint: opts.endpoint,
            params,
            cache_hit: false,
            latency_ms: Date.now() - start,
            status_code: statusCode,
            attempt,
            quota_used: quota.used,
            quota_remaining: quota.remaining,
            quota_last: quota.last,
            error: timeoutError.message,
          });
          throw timeoutError;
        }
        logCall({
          endpoint: opts.endpoint,
          params,
          cache_hit: false,
          latency_ms: Date.now() - start,
          status_code: statusCode,
          attempt,
          quota_used: quota.used,
          quota_remaining: quota.remaining,
          quota_last: quota.last,
          error: "timeout — retrying",
        });
        await sleep(backoffDelayMs(attempt));
        lastError = err;
        continue;
      }

      if (
        err instanceof OddsApiHttpError &&
        (err.status === 429 || err.status >= 500)
      ) {
        throw err;
      }

      if (err instanceof OddsApiHttpError || err instanceof OddsApiSchemaError) {
        throw err;
      }

      // Network-level errors (DNS, ECONNRESET, etc.) — retry.
      if (attempt < MAX_ATTEMPTS) {
        logCall({
          endpoint: opts.endpoint,
          params,
          cache_hit: false,
          latency_ms: Date.now() - start,
          status_code: statusCode,
          attempt,
          quota_used: quota.used,
          quota_remaining: quota.remaining,
          quota_last: quota.last,
          error: err instanceof Error ? `network: ${err.message}` : "network error",
        });
        await sleep(backoffDelayMs(attempt));
        lastError = err;
        continue;
      }

      logCall({
        endpoint: opts.endpoint,
        params,
        cache_hit: false,
        latency_ms: Date.now() - start,
        status_code: statusCode,
        attempt,
        quota_used: quota.used,
        quota_remaining: quota.remaining,
        quota_last: quota.last,
        error: err instanceof Error ? err.message : "unknown error",
      });
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Defensive — the loop above always returns or throws.
  throw lastError instanceof Error
    ? lastError
    : new OddsApiError(
        `Request to ${opts.endpoint} exhausted retries`,
        opts.endpoint,
        stripUndefined(opts.params),
      );
}

// ─── TTL helpers ─────────────────────────────────────────────────────────────

function pickTtlForKickoff(
  commenceTimeMs: number,
  now: number = Date.now(),
): number {
  const delta = commenceTimeMs - now;
  if (delta < 2 * ONE_HOUR) return FIVE_MINUTES;
  if (delta > ONE_DAY) return ONE_HOUR;
  return FIFTEEN_MINUTES;
}

function pickTtlForEventCollection(
  events: OddsApiEventOdds[],
  now: number = Date.now(),
): number {
  if (events.length === 0) return FIFTEEN_MINUTES;
  let minTtl = ONE_DAY;
  for (const ev of events) {
    const ts = Date.parse(ev.commence_time);
    if (!Number.isFinite(ts)) continue;
    const ttl = pickTtlForKickoff(ts, now);
    if (ttl < minTtl) minTtl = ttl;
  }
  return minTtl;
}

// ─── Public typed API ────────────────────────────────────────────────────────

export type GetOddsForSportOptions = {
  regions?: readonly string[];
  markets?: readonly string[];
  bookmakers?: readonly string[];
  commenceTimeFrom?: string; // ISO 8601
  commenceTimeTo?: string; // ISO 8601
  cache?: CacheStore;
};

export type GetOddsForEventOptions = {
  regions?: readonly string[];
  markets?: readonly string[];
  cache?: CacheStore;
};

export async function getSports(opts?: {
  cache?: CacheStore;
}): Promise<OddsApiSport[]> {
  return request({
    endpoint: "/sports",
    params: {},
    schema: SportsResponseSchema,
    ttlMs: ONE_DAY,
    cache: opts?.cache,
  });
}

export async function getOddsForSport(
  sport: string,
  options: GetOddsForSportOptions = {},
): Promise<OddsApiEventOdds[]> {
  const regions = (options.regions ?? DEFAULT_REGIONS).join(",");
  const markets = (options.markets ?? DEFAULT_MARKETS).join(",");
  const params: Params = {
    regions,
    markets,
    oddsFormat: "decimal",
    dateFormat: "iso",
    bookmakers: options.bookmakers?.join(","),
    commenceTimeFrom: options.commenceTimeFrom,
    commenceTimeTo: options.commenceTimeTo,
  };
  const endpoint = `/sports/${sport}/odds`;
  const cacheKey = buildCacheKey(endpoint, stripUndefined(params));
  const events = await request({
    endpoint,
    params,
    schema: SportOddsResponseSchema,
    ttlMs: FIFTEEN_MINUTES,
    cacheKeyOverride: cacheKey,
    cache: options.cache,
  });
  // Re-tighten TTL based on earliest kickoff in the payload.
  const tighter = pickTtlForEventCollection(events);
  if (tighter < FIFTEEN_MINUTES) {
    await (options.cache ?? inMemoryCache).set(cacheKey, events, tighter);
  }
  return events;
}

export async function getOddsForEvent(
  sport: string,
  eventId: string,
  options: GetOddsForEventOptions = {},
): Promise<OddsApiEventOdds> {
  const regions = (options.regions ?? DEFAULT_REGIONS).join(",");
  const markets = (options.markets ?? DEFAULT_MARKETS).join(",");
  const params: Params = {
    regions,
    markets,
    oddsFormat: "decimal",
    dateFormat: "iso",
  };
  const endpoint = `/sports/${sport}/events/${eventId}/odds`;
  const cacheKey = buildCacheKey(endpoint, stripUndefined(params));
  const event = await request({
    endpoint,
    params,
    schema: EventOddsSchema,
    ttlMs: FIFTEEN_MINUTES,
    cacheKeyOverride: cacheKey,
    cache: options.cache,
  });
  const ts = Date.parse(event.commence_time);
  if (Number.isFinite(ts)) {
    const tighter = pickTtlForKickoff(ts);
    if (tighter < FIFTEEN_MINUTES) {
      await (options.cache ?? inMemoryCache).set(cacheKey, event, tighter);
    }
  }
  return event;
}
