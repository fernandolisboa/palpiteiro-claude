import type { z } from "zod";

import { inMemoryCache } from "@/lib/cache/in-memory";
import type { CacheStore } from "@/lib/cache/types";
import {
  API_FOOTBALL_BASE_URL,
  currentSeason,
  isFinishedStatus,
} from "@/lib/providers/api-football-constants";
import {
  envelopeErrorsAreEmpty,
  FixtureEnvelopeSchema,
  InjuryEnvelopeSchema,
  LineupEnvelopeSchema,
  StandingsEnvelopeSchema,
  StatusResponseSchema,
  type ApiFootballFixture,
  type ApiFootballInjury,
  type ApiFootballLineup,
  type ApiFootballStandings,
  type ApiFootballStatus,
} from "@/lib/providers/api-football-schemas";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const JITTER_RATIO = 0.2;

const ONE_MINUTE = 60_000;
const FIVE_MINUTES = 5 * ONE_MINUTE;
const FIFTEEN_MINUTES = 15 * ONE_MINUTE;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;

export class ApiFootballError extends Error {
  readonly endpoint: string;
  readonly params: Record<string, string | number>;
  constructor(
    message: string,
    endpoint: string,
    params: Record<string, string | number>,
  ) {
    super(message);
    this.name = "ApiFootballError";
    this.endpoint = endpoint;
    this.params = params;
  }
}

export class ApiFootballHttpError extends ApiFootballError {
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
    this.name = "ApiFootballHttpError";
    this.status = status;
    this.body = body;
  }
}

export class ApiFootballApiError extends ApiFootballError {
  readonly errors: string[] | Record<string, string>;
  constructor(
    message: string,
    endpoint: string,
    params: Record<string, string | number>,
    errors: string[] | Record<string, string>,
  ) {
    super(message, endpoint, params);
    this.name = "ApiFootballApiError";
    this.errors = errors;
  }
}

export class ApiFootballSchemaError extends ApiFootballError {
  readonly zodError: z.ZodError;
  constructor(
    message: string,
    endpoint: string,
    params: Record<string, string | number>,
    zodError: z.ZodError,
  ) {
    super(message, endpoint, params);
    this.name = "ApiFootballSchemaError";
    this.zodError = zodError;
  }
}

export class ApiFootballTimeoutError extends ApiFootballError {
  constructor(endpoint: string, params: Record<string, string | number>) {
    super(`API-Football request timed out for ${endpoint}`, endpoint, params);
    this.name = "ApiFootballTimeoutError";
  }
}

type Params = Record<string, string | number | undefined>;

type LogFields = {
  endpoint: string;
  params: Record<string, string | number>;
  cache_hit: boolean;
  latency_ms: number;
  status_code: number | null;
  attempt: number;
  error?: string;
};

function logCall(fields: LogFields): void {
  console.log(JSON.stringify({ provider: "api-football", ...fields }));
}

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
  // Endpoint like "/fixtures/headtohead" -> "fixtures:headtohead"
  const endpointSegment = endpoint.replace(/^\//, "").replace(/\//g, ":");
  const entries = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  const tail = entries.map(([k, v]) => `${k}:${v}`).join(":");
  return tail
    ? `api-football:${endpointSegment}:${tail}`
    : `api-football:${endpointSegment}`;
}

function buildUrl(
  endpoint: string,
  params: Record<string, string | number>,
): string {
  const url = new URL(API_FOOTBALL_BASE_URL + endpoint);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
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
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    throw new Error(
      "API_FOOTBALL_KEY is not set. Define it in .env.local (see .env.example).",
    );
  }
  return key;
}

type RequestOptions<S extends z.ZodTypeAny> = {
  endpoint: string;
  params: Params;
  schema: S;
  ttlMs: number;
  // When provided, overrides the default cache key (useful for collapsing
  // dynamic params like timezone into a single logical key).
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
  const url = buildUrl(opts.endpoint, params);

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const start = Date.now();
    let statusCode: number | null = null;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { "x-apisports-key": key, Accept: "application/json" },
        signal: controller.signal,
      });
      statusCode = response.status;
      const text = await response.text();

      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const transientError = new ApiFootballHttpError(
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
            error: transientError.message,
          });
          throw transientError;
        }
        logCall({
          endpoint: opts.endpoint,
          params,
          cache_hit: false,
          latency_ms: Date.now() - start,
          status_code: statusCode,
          attempt,
          error: `retrying after ${response.status}`,
        });
        await sleep(backoffDelayMs(attempt, retryAfter));
        lastError = transientError;
        continue;
      }

      if (!response.ok) {
        const httpError = new ApiFootballHttpError(
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
          error: httpError.message,
        });
        throw httpError;
      }

      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new ApiFootballHttpError(
          `Invalid JSON from ${opts.endpoint}`,
          opts.endpoint,
          params,
          response.status,
          text.slice(0, 2048),
        );
      }

      const envelopeErrors = (json as { errors?: unknown }).errors;
      if (envelopeErrors !== undefined) {
        const errs = envelopeErrors as string[] | Record<string, string>;
        if (!envelopeErrorsAreEmpty(errs)) {
          const apiError = new ApiFootballApiError(
            `API-Football returned errors for ${opts.endpoint}`,
            opts.endpoint,
            params,
            errs,
          );
          logCall({
            endpoint: opts.endpoint,
            params,
            cache_hit: false,
            latency_ms: Date.now() - start,
            status_code: statusCode,
            attempt,
            error: JSON.stringify(errs),
          });
          throw apiError;
        }
      }

      const parsed = opts.schema.safeParse(json);
      if (!parsed.success) {
        console.error(
          JSON.stringify({
            provider: "api-football",
            endpoint: opts.endpoint,
            params,
            error: "schema_validation_failed",
            payload_preview: text.slice(0, 2048),
            zod_issues: parsed.error.issues.slice(0, 10),
          }),
        );
        throw new ApiFootballSchemaError(
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
      });

      return parsed.data;
    } catch (err) {
      const isAbort =
        err instanceof Error &&
        (err.name === "AbortError" || (err as { name?: string }).name === "TimeoutError");
      if (isAbort) {
        if (attempt >= MAX_ATTEMPTS) {
          const timeoutError = new ApiFootballTimeoutError(opts.endpoint, params);
          logCall({
            endpoint: opts.endpoint,
            params,
            cache_hit: false,
            latency_ms: Date.now() - start,
            status_code: statusCode,
            attempt,
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
          error: "timeout — retrying",
        });
        await sleep(backoffDelayMs(attempt));
        lastError = err;
        continue;
      }

      if (
        err instanceof ApiFootballHttpError &&
        (err.status === 429 || err.status >= 500)
      ) {
        // Already handled in the retry path above; rethrow.
        throw err;
      }

      if (
        err instanceof ApiFootballHttpError ||
        err instanceof ApiFootballApiError ||
        err instanceof ApiFootballSchemaError
      ) {
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
    : new ApiFootballError(
        `Request to ${opts.endpoint} exhausted retries`,
        opts.endpoint,
        stripUndefined(opts.params),
      );
}

// ─── TTL helpers ─────────────────────────────────────────────────────────────

function pickTtlForFixture(
  kickoffAtMs: number,
  statusShort: string,
  now: number = Date.now(),
): number {
  if (isFinishedStatus(statusShort)) return ONE_DAY;
  const delta = kickoffAtMs - now;
  if (delta < 2 * ONE_HOUR) return FIVE_MINUTES;
  if (delta > ONE_DAY) return ONE_HOUR;
  return FIFTEEN_MINUTES;
}

function pickTtlForFixtureCollection(
  fixtures: ApiFootballFixture[],
  now: number = Date.now(),
): number {
  if (fixtures.length === 0) return FIVE_MINUTES;
  let minTtl = ONE_DAY;
  for (const f of fixtures) {
    const kickoffMs = f.fixture.timestamp * 1000;
    const ttl = pickTtlForFixture(kickoffMs, f.fixture.status.short, now);
    if (ttl < minTtl) minTtl = ttl;
  }
  return minTtl;
}

// ─── Public typed API ────────────────────────────────────────────────────────

export async function getFixturesByDate(
  date: string,
  leagueId?: number,
  seasonOverride?: number,
): Promise<ApiFootballFixture[]> {
  // API-Football requires `season` whenever `league` is supplied on /fixtures.
  const season =
    leagueId !== undefined
      ? (seasonOverride ?? currentSeason(leagueId))
      : seasonOverride;
  const params = { date, league: leagueId, season, timezone: "UTC" };
  const cacheKey = buildCacheKey(
    "/fixtures",
    stripUndefined({ date, league: leagueId, season }),
  );
  const envelope = await request({
    endpoint: "/fixtures",
    params,
    schema: FixtureEnvelopeSchema,
    ttlMs: ONE_HOUR,
    cacheKeyOverride: cacheKey,
  });
  // Re-tighten TTL once we know what's in the payload.
  const tighterTtl = pickTtlForFixtureCollection(envelope.response);
  if (tighterTtl < ONE_HOUR) {
    await inMemoryCache.set(cacheKey, envelope, tighterTtl);
  }
  return envelope.response;
}

export async function getFixturesByLeague(
  leagueId: number,
  season: number,
): Promise<ApiFootballFixture[]> {
  const envelope = await request({
    endpoint: "/fixtures",
    params: { league: leagueId, season },
    schema: FixtureEnvelopeSchema,
    ttlMs: ONE_HOUR,
  });
  return envelope.response;
}

export async function getFixtureById(
  id: number,
): Promise<ApiFootballFixture | undefined> {
  const cacheKey = buildCacheKey("/fixtures", { id });
  const envelope = await request({
    endpoint: "/fixtures",
    params: { id },
    schema: FixtureEnvelopeSchema,
    ttlMs: FIFTEEN_MINUTES,
    cacheKeyOverride: cacheKey,
  });
  const fixture = envelope.response[0];
  if (fixture) {
    const ttl = pickTtlForFixture(
      fixture.fixture.timestamp * 1000,
      fixture.fixture.status.short,
    );
    await inMemoryCache.set(cacheKey, envelope, ttl);
  }
  return fixture;
}

export async function getH2H(
  team1: number,
  team2: number,
  last?: number,
): Promise<ApiFootballFixture[]> {
  const [a, b] = team1 < team2 ? [team1, team2] : [team2, team1];
  const params = { h2h: `${a}-${b}`, last };
  const envelope = await request({
    endpoint: "/fixtures/headtohead",
    params,
    schema: FixtureEnvelopeSchema,
    ttlMs: ONE_DAY,
  });
  return envelope.response;
}

export async function getStandings(
  leagueId: number,
  season: number,
): Promise<ApiFootballStandings | undefined> {
  const envelope = await request({
    endpoint: "/standings",
    params: { league: leagueId, season },
    schema: StandingsEnvelopeSchema,
    ttlMs: ONE_HOUR,
  });
  return envelope.response[0];
}

export async function getInjuries(args: {
  fixtureId?: number;
  teamId?: number;
}): Promise<ApiFootballInjury[]> {
  if (args.fixtureId === undefined && args.teamId === undefined) {
    throw new Error("getInjuries requires fixtureId or teamId");
  }
  const params: Params = {
    fixture: args.fixtureId,
    team: args.teamId,
  };
  const envelope = await request({
    endpoint: "/injuries",
    params,
    schema: InjuryEnvelopeSchema,
    ttlMs: FIVE_MINUTES,
  });
  return envelope.response;
}

export async function getLineups(
  fixtureId: number,
): Promise<ApiFootballLineup[]> {
  const cacheKey = buildCacheKey("/fixtures/lineups", { fixture: fixtureId });
  const envelope = await request({
    endpoint: "/fixtures/lineups",
    params: { fixture: fixtureId },
    schema: LineupEnvelopeSchema,
    ttlMs: FIVE_MINUTES,
    cacheKeyOverride: cacheKey,
  });
  return envelope.response;
}

export async function getTeamForm(
  teamId: number,
  last: number,
): Promise<ApiFootballFixture[]> {
  if (last < 1 || last > 99) {
    throw new Error("getTeamForm `last` must be between 1 and 99");
  }
  const envelope = await request({
    endpoint: "/fixtures",
    params: { team: teamId, last },
    schema: FixtureEnvelopeSchema,
    ttlMs: ONE_HOUR,
  });
  return envelope.response;
}

// Calls /status — does NOT count against the daily quota. Useful for diagnostics
// and to verify how many real API calls a script consumed.
export async function getApiStatus(): Promise<ApiFootballStatus["response"]> {
  const envelope = await request({
    endpoint: "/status",
    params: {},
    schema: StatusResponseSchema,
    // Don't cache — purpose is to read live counters.
    ttlMs: 1,
  });
  return envelope.response;
}
