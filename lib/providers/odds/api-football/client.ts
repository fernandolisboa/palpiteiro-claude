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
  getLastQuota,
  type ExtractedQuota,
} from "@/lib/providers/http/quota-logger";
import {
  OddsEnvelopeSchema,
  type ApiFootballOddsItem,
} from "@/lib/providers/odds/api-football/schemas";
import { API_FOOTBALL_BASE_URL } from "@/lib/providers/sports-data/api-football/constants";
import {
  ApiFootballApiError,
  ApiFootballHttpError,
  ApiFootballSchemaError,
  ApiFootballTimeoutError,
} from "@/lib/providers/sports-data/api-football/errors";
import { envelopeErrorsAreEmpty } from "@/lib/providers/sports-data/api-football/schemas";
import {
  FIVE_MINUTES,
  ONE_MINUTE,
} from "@/lib/providers/sports-data/cache-ttl";

// Cliente HTTP da PERNA DE ODDS da api-football. `name: "api-football-odds"` separado
// (telemetria de quota/egress atribuível — AC #5), mas MESMA chave/budget diário
// (API_FOOTBALL_KEY, Pro 7500/dia; ~8 calls/dia de odds = trivial). Throttle 8/min
// igual ao sports-data (evita o burst-ban do #7). Espelha o cliente de sports-data.
const apiFootballOddsClient = createProviderClient({
  name: "api-football-odds",
  concurrency: 2,
  throttle: { maxRequests: 8, windowMs: ONE_MINUTE },
  quotaHeaders: {
    daily: "x-ratelimit-requests-remaining",
    dailyLimit: "x-ratelimit-requests-limit",
    perMinute: "X-RateLimit-Remaining",
  },
});

/**
 * Última quota da perna de odds da api-football vista nesta process-memory, ou null
 * se nenhum fetch real rodou (cold start / só cache hits). Espelha
 * `getLastOddsApiQuota` (The Odds API) pro monitoramento de egress do AC #5.
 */
export function getLastApiFootballOddsQuota(): ExtractedQuota | null {
  return getLastQuota("api-football-odds");
}

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
  // Prefixo "odds-api-football:" — NÃO colide com "sports-data:api-football:".
  const endpointSegment = endpoint.replace(/^\//, "").replace(/\//g, ":");
  const entries = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  const tail = entries.map(([k, v]) => `${k}:${v}`).join(":");
  return tail
    ? `odds-api-football:${endpointSegment}:${tail}`
    : `odds-api-football:${endpointSegment}`;
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
  cache?: CacheStore;
};

async function request<S extends z.ZodTypeAny>(
  opts: RequestOptions<S>,
): Promise<z.infer<S>> {
  const params = stripUndefined(opts.params);
  const cacheKey = buildCacheKey(opts.endpoint, params);
  const cache = opts.cache ?? inMemoryCache;

  const cacheStart = Date.now();
  const cached = await cache.get<z.infer<S>>(cacheKey);
  if (cached !== undefined) {
    apiFootballOddsClient.logCacheHit(opts.endpoint, Date.now() - cacheStart);
    return cached;
  }

  const key = requireApiKey();
  const url = buildUrl(opts.endpoint, params);

  let result: { response: Response; text: string };
  try {
    const r = await apiFootballOddsClient.send({
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
        provider: "api-football-odds",
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

/**
 * Odds de UM bet (bet=10 correct score, bet=92 anytime scorer, bet=212 assist)
 * da liga inteira (#289/#290). A api-football devolve a rodada inteira numa página
 * (books+bets aninhados por fixture) — ~1 call por bet. TTL 5min casa o gate de
 * frescor do snapshot; o refresh do provider é ~3h, então a maioria dos hits é
 * cache. Cada item carrega só `fixture.id` (sem times) — o adapter enriquece via a
 * metadata de fixture. O `betId` segrega o cache por mercado (params do request).
 */
export async function getOddsByBetId(
  leagueId: number,
  season: number,
  betId: number,
  opts?: { cache?: CacheStore },
): Promise<ApiFootballOddsItem[]> {
  const envelope = await request({
    endpoint: "/odds",
    params: { league: leagueId, season, bet: betId },
    schema: OddsEnvelopeSchema,
    ttlMs: FIVE_MINUTES,
    cache: opts?.cache,
  });
  return envelope.response;
}
