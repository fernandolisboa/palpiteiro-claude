import type { z } from "zod";

import { inMemoryCache } from "@/lib/cache/in-memory";
import type { CacheStore } from "@/lib/cache/types";
import {
  createProviderClient,
  HttpClientError,
  HttpClientTimeoutError,
  RetryableHttpError,
} from "@/lib/providers/http/client";
import {
  API_FOOTBALL_BASE_URL,
  currentSeason,
  isFinishedStatus,
} from "@/lib/providers/sports-data/api-football/constants";
import {
  ApiFootballApiError,
  ApiFootballHttpError,
  ApiFootballSchemaError,
  ApiFootballTimeoutError,
} from "@/lib/providers/sports-data/api-football/errors";
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
} from "@/lib/providers/sports-data/api-football/schemas";

const ONE_MINUTE = 60_000;
const FIVE_MINUTES = 5 * ONE_MINUTE;
const FIFTEEN_MINUTES = 15 * ONE_MINUTE;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;

// API-Football free tier is 10 req/min and 100 req/day. We throttle at 8/min
// (20% under the per-minute cap) to avoid the burst-detection auto-ban that
// suspended the account during issue #7 testing.
const apiFootballClient = createProviderClient({
  name: "api-football",
  concurrency: 2,
  throttle: { maxRequests: 8, windowMs: ONE_MINUTE },
  quotaHeaders: {
    daily: "x-ratelimit-requests-remaining",
    dailyLimit: "x-ratelimit-requests-limit",
    perMinute: "X-RateLimit-Remaining",
  },
});

// Error classes live in ./errors. Re-exported here for backward compatibility
// with callers that imported them from the old `lib/providers/api-football`
// path (step 13 of issue #24 removes these once everyone consumes the class).
export {
  ApiFootballError,
  ApiFootballApiError,
  ApiFootballHttpError,
  ApiFootballSchemaError,
  ApiFootballTimeoutError,
} from "@/lib/providers/sports-data/api-football/errors";

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
    apiFootballClient.logCacheHit(opts.endpoint, Date.now() - cacheStart);
    return cached;
  }

  const key = requireApiKey();
  const url = buildUrl(opts.endpoint, params);

  let result: { response: Response; text: string };
  try {
    const r = await apiFootballClient.send({
      endpoint: opts.endpoint,
      url,
      init: {
        method: "GET",
        headers: { "x-apisports-key": key, Accept: "application/json" },
      },
    });
    result = { response: r.response, text: r.text };
  } catch (err) {
    if (err instanceof RetryableHttpError) {
      throw new ApiFootballHttpError(
        `Transient HTTP ${err.statusCode} on ${opts.endpoint}`,
        opts.endpoint,
        params,
        err.statusCode,
        err.body,
      );
    }
    if (err instanceof HttpClientError) {
      throw new ApiFootballHttpError(
        `HTTP ${err.statusCode} on ${opts.endpoint}`,
        opts.endpoint,
        params,
        err.statusCode,
        err.body,
      );
    }
    if (err instanceof HttpClientTimeoutError) {
      throw new ApiFootballTimeoutError(opts.endpoint, params);
    }
    throw err;
  }

  const { response, text } = result;

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
      throw new ApiFootballApiError(
        `API-Football returned errors for ${opts.endpoint}`,
        opts.endpoint,
        params,
        errs,
      );
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
  return parsed.data;
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
