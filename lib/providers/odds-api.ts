import type { z } from "zod";

import { inMemoryCache } from "@/lib/cache/in-memory";
import type { CacheStore } from "@/lib/cache/types";
import { ODDS_API_BASE_URL } from "@/lib/providers/odds-api-constants";
import {
  EventOddsSchema,
  EventsListResponseSchema,
  SportOddsResponseSchema,
  SportsResponseSchema,
  type OddsApiEventListItem,
  type OddsApiEventOdds,
  type OddsApiSport,
} from "@/lib/providers/odds-api-schemas";
import {
  createProviderClient,
  HttpClientError,
  HttpClientTimeoutError,
  RetryableHttpError,
} from "@/lib/providers/http/client";
import {
  getLastQuota,
  type ObservedQuota,
} from "@/lib/providers/http/quota-logger";

const ONE_MINUTE = 60_000;
const FIVE_MINUTES = 5 * ONE_MINUTE;
const FIFTEEN_MINUTES = 15 * ONE_MINUTE;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;

const DEFAULT_REGIONS = ["eu"] as const;
const DEFAULT_MARKETS = ["totals"] as const;

// The Odds API documents a monthly quota (500/month free) but no strict
// per-minute limit. We still cap concurrency at 2 (avoid pathological bursts)
// and throttle at 15/min — comfortably higher than api-football to prioritize
// burning through legitimate demand without artificial waits, but low enough
// that runaway loops stay bounded.
const oddsApiClient = createProviderClient({
  name: "odds-api",
  concurrency: 2,
  throttle: { maxRequests: 15, windowMs: ONE_MINUTE },
  quotaHeaders: {
    monthly: "x-requests-remaining",
    monthlyUsed: "x-requests-used",
    monthlyLimit: 500,
  },
});

/**
 * Última quota da The Odds API vista nesta process-memory (monthly remaining/used),
 * ou null se nenhum fetch real rodou ainda (cold start / só cache hits). Usada pelo
 * cron de CLV (#180) pra logar o crédito mensal restante após seus fetches — a
 * mensuração de quota é a telemetria por-call do logCall; isto só dá a linha de
 * summary do run.
 */
export function getLastOddsApiQuota(): ObservedQuota | null {
  return getLastQuota("odds-api");
}

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

type Params = Record<string, string | number | undefined>;

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

// The Odds API requires commenceTimeFrom/To as `YYYY-MM-DDTHH:MM:SSZ`. It
// rejects the millisecond form `Date#toISOString()` produces (".000Z") with a
// 422 INVALID_COMMENCE_TIME_FROM — the failure behind #42, hit only on the
// analysis path (the sole caller that passes commenceTime). Normalize any ISO
// input to the accepted second-precision UTC form.
function toOddsApiCommenceTime(iso: string | undefined): string | undefined {
  if (iso === undefined) return undefined;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso; // let the API surface a clear error
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// regions and markets are mandatory on the odds endpoints; an empty array would
// serialize to "" and trigger 422 MISSING_REGION. Fall back to defaults so no
// request ever leaves without them.
function resolveCsv(
  values: readonly string[] | undefined,
  fallback: readonly string[],
): string {
  return (values && values.length > 0 ? values : fallback).join(",");
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
    oddsApiClient.logCacheHit(opts.endpoint, Date.now() - cacheStart);
    return cached;
  }

  const key = requireApiKey();
  const url = buildUrl(opts.endpoint, params, key);

  let text: string;
  let response: Response;
  try {
    const r = await oddsApiClient.send({
      endpoint: opts.endpoint,
      url,
      init: {
        method: "GET",
        headers: { Accept: "application/json" },
      },
    });
    response = r.response;
    text = r.text;
  } catch (err) {
    if (err instanceof RetryableHttpError) {
      throw new OddsApiHttpError(
        `Transient HTTP ${err.statusCode} on ${opts.endpoint}`,
        opts.endpoint,
        params,
        err.statusCode,
        err.body,
      );
    }
    if (err instanceof HttpClientError) {
      throw new OddsApiHttpError(
        `HTTP ${err.statusCode} on ${opts.endpoint}`,
        opts.endpoint,
        params,
        err.statusCode,
        err.body,
      );
    }
    if (err instanceof HttpClientTimeoutError) {
      throw new OddsApiTimeoutError(opts.endpoint, params);
    }
    throw err;
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
  return parsed.data;
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

export type GetEventsForSportOptions = {
  commenceTimeFrom?: string; // ISO 8601
  commenceTimeTo?: string; // ISO 8601
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

// Lista de eventos SEM odds (/sports/{sport}/events). GRATUITO: a The Odds API
// documenta que /sports e /sports/{sport}/events NÃO contam contra a quota
// (0 créditos). NÃO manda regions/markets — logo NÃO passa por resolveCsv (sem o
// fallback silencioso pra ['totals']). Usado pra resolver o eventId de um match
// antes de um fetch *additional* por evento (btts), sem gastar 1 crédito de batch.
export async function getEventsForSport(
  sport: string,
  options: GetEventsForSportOptions = {},
): Promise<OddsApiEventListItem[]> {
  const params: Params = {
    dateFormat: "iso",
    commenceTimeFrom: toOddsApiCommenceTime(options.commenceTimeFrom),
    commenceTimeTo: toOddsApiCommenceTime(options.commenceTimeTo),
  };
  return request({
    endpoint: `/sports/${sport}/events`,
    params,
    schema: EventsListResponseSchema,
    ttlMs: FIFTEEN_MINUTES,
    cache: options.cache,
  });
}

export async function getOddsForSport(
  sport: string,
  options: GetOddsForSportOptions = {},
): Promise<OddsApiEventOdds[]> {
  const regions = resolveCsv(options.regions, DEFAULT_REGIONS);
  const markets = resolveCsv(options.markets, DEFAULT_MARKETS);
  const params: Params = {
    regions,
    markets,
    oddsFormat: "decimal",
    dateFormat: "iso",
    bookmakers: options.bookmakers?.join(","),
    commenceTimeFrom: toOddsApiCommenceTime(options.commenceTimeFrom),
    commenceTimeTo: toOddsApiCommenceTime(options.commenceTimeTo),
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
  const regions = resolveCsv(options.regions, DEFAULT_REGIONS);
  const markets = resolveCsv(options.markets, DEFAULT_MARKETS);
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
