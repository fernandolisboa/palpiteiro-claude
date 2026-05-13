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
  mapApiFootballStatus,
} from "@/lib/providers/sports-data/api-football/constants";
import {
  FIFTEEN_MINUTES,
  FIVE_MINUTES,
  ONE_DAY,
  ONE_HOUR,
  ONE_MINUTE,
  pickTtlForFixtureCollection,
} from "@/lib/providers/sports-data/cache-ttl";
import {
  ApiFootballApiError,
  ApiFootballError,
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
import { API_FOOTBALL_TEAM_IDS } from "@/lib/providers/sports-data/api-football/team-ids";
import {
  API_FOOTBALL_LEAGUE_IDS,
  currentSeason as currentSeasonByLeague,
  type SupportedLeague,
} from "@/lib/providers/sports-data/leagues";
import {
  canonicalizeOrPassthrough,
  canonicalizeTeamName,
} from "@/lib/providers/sports-data/team-names";
import {
  compositeFixtureKey,
  type FixtureRef,
  type NormalizedFixture,
  type NormalizedFixtureStatus,
  type NormalizedH2H,
  type NormalizedInjury,
  type NormalizedLineup,
  type NormalizedLineupPlayer,
  type NormalizedStanding,
  type NormalizedStandingTeam,
  type NormalizedTeamLineup,
  type ProviderCapabilities,
  type SportsDataProvider,
  SportsDataNotFoundError,
  SportsDataTransientError,
} from "@/lib/providers/sports-data/types";

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

// Error classes live in ./errors — import them from there directly.

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

// ─── Season helper ───────────────────────────────────────────────────────────

// Reverse of API_FOOTBALL_LEAGUE_IDS. Used by the free getFixturesByDate when
// a caller passes leagueId but no explicit seasonOverride — we resolve the
// SupportedLeague so currentSeasonByLeague (the single source of truth for
// season label logic in leagues.ts) can be applied.
const SUPPORTED_LEAGUE_BY_API_FOOTBALL_ID: Record<number, SupportedLeague> =
  Object.fromEntries(
    Object.entries(API_FOOTBALL_LEAGUE_IDS).map(
      ([league, id]) => [id, league as SupportedLeague] as const,
    ),
  );

function seasonForApiFootballLeagueId(
  leagueId: number,
  now: Date = new Date(),
): number {
  const league = SUPPORTED_LEAGUE_BY_API_FOOTBALL_ID[leagueId];
  if (!league) {
    throw new Error(
      `No SupportedLeague mapped for API-Football league id ${leagueId}. ` +
        `Pass seasonOverride explicitly or extend API_FOOTBALL_LEAGUE_IDS.`,
    );
  }
  return currentSeasonByLeague(league, now);
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
      ? (seasonOverride ?? seasonForApiFootballLeagueId(leagueId))
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
  return envelope.response;
}

// Builds the same /fixtures cache key that getFixturesByDate uses, so the
// adapter class method can tighten the TTL on the cached envelope after
// normalization.
function fixturesByDateCacheKey(
  date: string,
  leagueId: number,
  season: number,
): string {
  return buildCacheKey("/fixtures", { date, league: leagueId, season });
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
  const envelope = await request({
    endpoint: "/fixtures",
    params: { id },
    schema: FixtureEnvelopeSchema,
    ttlMs: FIFTEEN_MINUTES,
  });
  return envelope.response[0];
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

// ─── SportsDataProvider adapter ──────────────────────────────────────────────
// Wraps the free functions above and normalizes API-Football's native shapes
// into provider-agnostic types. Internal errors (ApiFootball*Error) are
// mapped to the SportsData{Transient,NotFound,Unsupported}Error contract
// that FallbackProvider relies on for the cascade decision.

const PROVIDER_NAME = "api-football" as const;

function mapStatusToNormalized(short: string): NormalizedFixtureStatus {
  const v = mapApiFootballStatus(short);
  if (v === "scheduled") return "scheduled";
  if (v === "live") return "live";
  if (v === "finished") return "finished";
  if (v === "postponed") return "postponed";
  if (v === "cancelled") return "cancelled";
  return "other";
}

function toNormalizedFixture(
  f: ApiFootballFixture,
  league: SupportedLeague,
): NormalizedFixture {
  const home = canonicalizeOrPassthrough(f.teams.home.name, league);
  const away = canonicalizeOrPassthrough(f.teams.away.name, league);
  const kickoffAt = new Date(f.fixture.timestamp * 1000).toISOString();
  return {
    id: compositeFixtureKey({
      league,
      kickoffAt,
      homeTeam: home,
      awayTeam: away,
    }),
    league,
    kickoffAt,
    kickoffTimestampMs: f.fixture.timestamp * 1000,
    homeTeam: home,
    awayTeam: away,
    status: mapStatusToNormalized(f.fixture.status.short),
    score: { home: f.goals.home, away: f.goals.away },
    venue: f.fixture.venue?.name ?? undefined,
  };
}

function toNormalizedStanding(
  s: ApiFootballStandings,
  league: SupportedLeague,
): NormalizedStanding {
  const tables = s.league.standings.map((group) => {
    const teams: NormalizedStandingTeam[] = group.map((row) => {
      const teamName = canonicalizeOrPassthrough(row.team.name, league);
      return {
        position: row.rank,
        team: teamName,
        played: row.all.played,
        won: row.all.win,
        draw: row.all.draw,
        lost: row.all.lose,
        goalsFor: row.all.goals.for,
        goalsAgainst: row.all.goals.against,
        points: row.points,
        homeSplit: {
          played: row.home.played,
          wins: row.home.win,
          draws: row.home.draw,
          losses: row.home.lose,
          goalsFor: row.home.goals.for,
          goalsAgainst: row.home.goals.against,
        },
        awaySplit: {
          played: row.away.played,
          wins: row.away.win,
          draws: row.away.draw,
          losses: row.away.lose,
          goalsFor: row.away.goals.for,
          goalsAgainst: row.away.goals.against,
        },
      } satisfies NormalizedStandingTeam;
    });
    const first = group[0];
    const groupLabel =
      first?.group && first.group.trim() !== "" ? first.group : undefined;
    return groupLabel ? { group: groupLabel, teams } : { teams };
  });
  return { league, season: s.league.season, tables };
}

function mapApiFootballPositionToLabel(
  pos: string | null | undefined,
): string | undefined {
  switch (pos) {
    case "G":
      return "GK";
    case "D":
      return "DEF";
    case "M":
      return "MID";
    case "F":
      return "FWD";
    default:
      return undefined;
  }
}

function mapApiFootballAbsenceStatus(
  injury: ApiFootballInjury,
): NormalizedInjury["status"] {
  const type = (injury.player.type ?? "").toLowerCase();
  const reason = (injury.player.reason ?? "").toLowerCase();
  if (type.includes("questionable") || reason.includes("doubt"))
    return "doubtful";
  if (reason.includes("card") || reason.includes("suspension"))
    return "suspended";
  return "injured";
}

function toNormalizedInjury(injury: ApiFootballInjury): NormalizedInjury {
  const status = mapApiFootballAbsenceStatus(injury);
  return {
    player: { name: injury.player.name },
    type: status === "suspended" ? "suspension" : "injury",
    reason: injury.player.reason ?? undefined,
    status,
  };
}

function toNormalizedTeamLineup(
  lineup: ApiFootballLineup,
  league: SupportedLeague,
): NormalizedTeamLineup {
  const starters: NormalizedLineupPlayer[] = lineup.startXI.map((entry) => ({
    name: entry.player.name,
    shirtNumber: entry.player.number ?? undefined,
    position: mapApiFootballPositionToLabel(entry.player.pos),
  }));
  const bench: NormalizedLineupPlayer[] = lineup.substitutes.map((entry) => ({
    name: entry.player.name,
    shirtNumber: entry.player.number ?? undefined,
    position: mapApiFootballPositionToLabel(entry.player.pos),
  }));
  return {
    team: canonicalizeOrPassthrough(lineup.team.name, league),
    formation: lineup.formation ?? undefined,
    starters,
    bench,
  };
}

function wrapApiFootballError(
  err: unknown,
  method: string,
  context: Record<string, unknown>,
): never {
  // Schema mismatches indicate provider response drift — retry on fallback
  // is the safer bet than failing the whole prediction (which would happen
  // if we re-threw as NotFound).
  if (err instanceof ApiFootballSchemaError) {
    throw new SportsDataTransientError(
      `Schema mismatch on ${err.endpoint}`,
      PROVIDER_NAME,
      method,
      err,
      context,
    );
  }
  if (err instanceof ApiFootballTimeoutError) {
    throw new SportsDataTransientError(
      `Timed out on ${err.endpoint}`,
      PROVIDER_NAME,
      method,
      err,
      context,
    );
  }
  if (err instanceof ApiFootballHttpError) {
    // 5xx and 429 reach here only after exhausting retries; transient.
    if (err.status >= 500 || err.status === 429) {
      throw new SportsDataTransientError(
        `HTTP ${err.status} on ${err.endpoint}`,
        PROVIDER_NAME,
        method,
        err,
        context,
      );
    }
    // 4xx (except 429) — endpoint-specific not-found / bad-request. Not
    // transient, do NOT cascade.
    throw new SportsDataNotFoundError(
      `HTTP ${err.status} on ${err.endpoint}: ${err.body.slice(0, 200)}`,
      PROVIDER_NAME,
      method,
      context,
    );
  }
  if (err instanceof ApiFootballApiError) {
    // API-Football envelope errors. The most common are auth/quota issues
    // (account suspended, daily limit hit) which surface here. Treat as
    // transient so FallbackProvider takes over — but bubble up the specific
    // error message so logs make the cause obvious.
    throw new SportsDataTransientError(
      `Envelope error on ${err.endpoint}: ${JSON.stringify(err.errors)}`,
      PROVIDER_NAME,
      method,
      err,
      context,
    );
  }
  if (err instanceof ApiFootballError) {
    throw new SportsDataTransientError(
      err.message,
      PROVIDER_NAME,
      method,
      err,
      context,
    );
  }
  // Programmer error (TypeError, etc.) — surface unchanged.
  throw err;
}

function resolveApiFootballTeamId(
  canonicalName: string,
  league: SupportedLeague,
  method: string,
): number {
  const id = API_FOOTBALL_TEAM_IDS[league][canonicalName];
  if (id === undefined) {
    // Map is empty (account-suspension stub) or the canonical name isn't
    // covered. Treat as transient so FallbackProvider tries the next
    // adapter; an unmapped canonical team is functionally equivalent to an
    // outage from the caller's perspective.
    throw new SportsDataTransientError(
      `No API-Football team ID mapped for "${canonicalName}" in ${league}. ` +
        `Populate via scripts/generate-team-ids.ts --provider=api-football.`,
      PROVIDER_NAME,
      method,
      undefined,
      { canonicalName, league },
    );
  }
  return id;
}

export class ApiFootballAdapter implements SportsDataProvider {
  readonly capabilities: ProviderCapabilities = {
    name: PROVIDER_NAME,
    supportsInjuries: true,
    supportsLineups: true,
    supportedLeagues: new Set<SupportedLeague>([
      "brasileirao_a",
      "champions_league",
    ]),
  };

  async getFixturesByDate(
    date: string,
    league: SupportedLeague,
  ): Promise<NormalizedFixture[]> {
    try {
      const leagueId = API_FOOTBALL_LEAGUE_IDS[league];
      const season = currentSeasonByLeague(league);
      const fixtures = await getFixturesByDate(date, leagueId, season);
      const normalized = fixtures.map((f) => toNormalizedFixture(f, league));
      // Tighten cache TTL after normalization, mirroring the football-data-org
      // adapter: TTL heuristics operate on NormalizedFixture so both providers
      // share the same imminent/live/finished rules from cache-ttl.ts.
      const tighterTtl = pickTtlForFixtureCollection(normalized);
      if (tighterTtl < ONE_HOUR) {
        const cacheKey = fixturesByDateCacheKey(date, leagueId, season);
        const cached = await inMemoryCache.get(cacheKey);
        if (cached !== undefined) {
          await inMemoryCache.set(cacheKey, cached, tighterTtl);
        }
      }
      return normalized;
    } catch (err) {
      wrapApiFootballError(err, "getFixturesByDate", { date, league });
    }
  }

  async getFixtureByMatch(
    ref: FixtureRef,
  ): Promise<NormalizedFixture | undefined> {
    try {
      const date = ref.kickoffAt.slice(0, 10);
      const candidates = await this.getFixturesByDate(date, ref.league);
      return candidates.find(
        (f) =>
          f.homeTeam === ref.homeTeam &&
          f.awayTeam === ref.awayTeam &&
          // Same calendar day already filtered above; allow same-day kickoffs
          // even if the exact hour drifts between providers.
          f.kickoffAt.slice(0, 10) === date,
      );
    } catch (err) {
      // getFixturesByDate already wraps; this layer just adds ref context.
      if (err instanceof SportsDataTransientError) {
        throw new SportsDataTransientError(
          err.message,
          PROVIDER_NAME,
          "getFixtureByMatch",
          err.originalError,
          { ref },
        );
      }
      throw err;
    }
  }

  async getH2H(
    homeTeam: string,
    awayTeam: string,
    league: SupportedLeague,
    last = 5,
  ): Promise<NormalizedH2H[]> {
    try {
      const homeId = resolveApiFootballTeamId(homeTeam, league, "getH2H");
      const awayId = resolveApiFootballTeamId(awayTeam, league, "getH2H");
      const fixtures = await getH2H(homeId, awayId, last);
      return fixtures.map((f) => toNormalizedFixture(f, league));
    } catch (err) {
      if (
        err instanceof SportsDataTransientError ||
        err instanceof SportsDataNotFoundError
      ) {
        throw err;
      }
      wrapApiFootballError(err, "getH2H", { homeTeam, awayTeam, league, last });
    }
  }

  async getStandings(
    league: SupportedLeague,
    season?: number,
  ): Promise<NormalizedStanding | undefined> {
    try {
      const leagueId = API_FOOTBALL_LEAGUE_IDS[league];
      const seasonValue = season ?? currentSeasonByLeague(league);
      const native = await getStandings(leagueId, seasonValue);
      if (!native) return undefined;
      return toNormalizedStanding(native, league);
    } catch (err) {
      wrapApiFootballError(err, "getStandings", { league, season });
    }
  }

  async getInjuriesByFixture(
    ref: FixtureRef,
  ): Promise<{ home: NormalizedInjury[]; away: NormalizedInjury[] }> {
    try {
      const fixture = await this.getFixtureByMatch(ref);
      if (!fixture) return { home: [], away: [] };
      // We need the API-Football fixture ID, but getFixtureByMatch went
      // through normalization which discarded it. Fetch the raw fixture by
      // (date, league) and pull the native id by team name match.
      const leagueId = API_FOOTBALL_LEAGUE_IDS[ref.league];
      const season = currentSeasonByLeague(ref.league);
      const native = await getFixturesByDate(
        ref.kickoffAt.slice(0, 10),
        leagueId,
        season,
      );
      const match = native.find(
        (f) =>
          canonicalizeOrPassthrough(f.teams.home.name, ref.league) ===
            ref.homeTeam &&
          canonicalizeOrPassthrough(f.teams.away.name, ref.league) ===
            ref.awayTeam,
      );
      if (!match) return { home: [], away: [] };
      const injuries = await getInjuries({ fixtureId: match.fixture.id });
      const home: NormalizedInjury[] = [];
      const away: NormalizedInjury[] = [];
      for (const inj of injuries) {
        const teamCanon = canonicalizeOrPassthrough(
          inj.team.name,
          ref.league,
        );
        const normalized = toNormalizedInjury(inj);
        if (teamCanon === ref.homeTeam) home.push(normalized);
        else if (teamCanon === ref.awayTeam) away.push(normalized);
        // else: ignore — injury attached to a team not in this fixture
      }
      return { home, away };
    } catch (err) {
      if (err instanceof SportsDataTransientError) throw err;
      wrapApiFootballError(err, "getInjuriesByFixture", { ref });
    }
  }

  async getInjuriesByTeam(
    team: string,
    league: SupportedLeague,
  ): Promise<NormalizedInjury[]> {
    try {
      const teamId = resolveApiFootballTeamId(team, league, "getInjuriesByTeam");
      const injuries = await getInjuries({ teamId });
      return injuries.map(toNormalizedInjury);
    } catch (err) {
      if (err instanceof SportsDataTransientError) throw err;
      wrapApiFootballError(err, "getInjuriesByTeam", { team, league });
    }
  }

  async getLineups(ref: FixtureRef): Promise<NormalizedLineup | undefined> {
    try {
      const leagueId = API_FOOTBALL_LEAGUE_IDS[ref.league];
      const season = currentSeasonByLeague(ref.league);
      const candidates = await getFixturesByDate(
        ref.kickoffAt.slice(0, 10),
        leagueId,
        season,
      );
      const match = candidates.find(
        (f) =>
          canonicalizeOrPassthrough(f.teams.home.name, ref.league) ===
            ref.homeTeam &&
          canonicalizeOrPassthrough(f.teams.away.name, ref.league) ===
            ref.awayTeam,
      );
      if (!match) return undefined;
      const lineups = await getLineups(match.fixture.id);
      const homeLineup = lineups.find(
        (l) =>
          canonicalizeOrPassthrough(l.team.name, ref.league) === ref.homeTeam,
      );
      const awayLineup = lineups.find(
        (l) =>
          canonicalizeOrPassthrough(l.team.name, ref.league) === ref.awayTeam,
      );
      if (!homeLineup || !awayLineup) return undefined;
      return {
        fixtureId: compositeFixtureKey(ref),
        home: toNormalizedTeamLineup(homeLineup, ref.league),
        away: toNormalizedTeamLineup(awayLineup, ref.league),
      };
    } catch (err) {
      wrapApiFootballError(err, "getLineups", { ref });
    }
  }

  async getTeamForm(
    team: string,
    league: SupportedLeague,
    last: number,
  ): Promise<NormalizedFixture[]> {
    try {
      const teamId = resolveApiFootballTeamId(team, league, "getTeamForm");
      const fixtures = await getTeamForm(teamId, last);
      // Map to normalized; keep only finished games (form analysis).
      return fixtures
        .map((f) => toNormalizedFixture(f, league))
        .filter((f) => f.status === "finished");
    } catch (err) {
      if (err instanceof SportsDataTransientError) throw err;
      wrapApiFootballError(err, "getTeamForm", { team, league, last });
    }
  }
}

// Internal exports for unit tests.
export const __testing = {
  toNormalizedFixture,
  toNormalizedStanding,
  toNormalizedInjury,
  toNormalizedTeamLineup,
  mapStatusToNormalized,
  resolveApiFootballTeamId,
  seasonForApiFootballLeagueId,
  wrapApiFootballError,
};
export { canonicalizeTeamName };
