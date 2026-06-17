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
  pickTtlForFixture,
  pickTtlForFixtureCollection,
  FIFTEEN_MINUTES,
  FIVE_MINUTES,
  ONE_DAY,
  ONE_HOUR,
  ONE_MINUTE,
} from "@/lib/providers/sports-data/cache-ttl";
import {
  FOOTBALL_DATA_ORG_BASE_URL,
  mapFootballDataOrgStatus,
} from "@/lib/providers/sports-data/football-data-org/constants";
import {
  FootballDataOrgError,
  FootballDataOrgHttpError,
  FootballDataOrgSchemaError,
  FootballDataOrgTimeoutError,
} from "@/lib/providers/sports-data/football-data-org/errors";
import {
  MatchByIdSchema,
  MatchesListSchema,
  StandingsResponseSchema,
  type FootballDataOrgMatch,
  type FootballDataOrgMatchWithLineup,
  type FootballDataOrgMatchesList,
  type FootballDataOrgStandingsResponse,
} from "@/lib/providers/sports-data/football-data-org/schemas";
import { FOOTBALL_DATA_ORG_TEAM_IDS } from "@/lib/providers/sports-data/football-data-org/team-ids";
import {
  FOOTBALL_DATA_ORG_LEAGUE_CODES,
  currentSeason,
  type SupportedLeague,
} from "@/lib/providers/sports-data/leagues";
import { canonicalizeOrPassthrough } from "@/lib/providers/sports-data/team-names";
import {
  compositeFixtureKey,
  SportsDataNotFoundError,
  SportsDataTransientError,
  SportsDataUnsupportedError,
  type FixtureRef,
  type NormalizedFixture,
  type NormalizedFixtureEvents,
  type NormalizedFixtureResult,
  type NormalizedH2H,
  type NormalizedInjury,
  type NormalizedLineup,
  type NormalizedLineupPlayer,
  type NormalizedStanding,
  type NormalizedStandingTeam,
  type NormalizedTeamLineup,
  type ProviderCapabilities,
  type SportsDataProvider,
} from "@/lib/providers/sports-data/types";

// ─── HTTP client config ─────────────────────────────────────────────────────
// Free tier: 10 req/min via X-Auth-Token. We throttle 10% below (9/min) to
// avoid burst-edge anti-abuse. Concurrency=2 mirrors api-football.
// X-RequestCounter-Reset is a reset timestamp, not a count, so it's not mapped.

const PROVIDER_NAME = "football-data-org" as const;

const footballDataOrgClient = createProviderClient({
  name: PROVIDER_NAME,
  concurrency: 2,
  throttle: { maxRequests: 9, windowMs: ONE_MINUTE },
  quotaHeaders: { perMinute: "X-Requests-Available-Minute" },
});

function requireApiKey(): string {
  const key = process.env.FOOTBALL_DATA_ORG_API_KEY;
  if (!key) {
    throw new Error(
      "FOOTBALL_DATA_ORG_API_KEY is not set. Define it in .env.local (see .env.example).",
    );
  }
  return key;
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
  const seg = endpoint.replace(/^\//, "").replace(/\//g, ":");
  const entries = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  const tail = entries.map(([k, v]) => `${k}:${v}`).join(":");
  return tail
    ? `sports-data:${PROVIDER_NAME}:${seg}:${tail}`
    : `sports-data:${PROVIDER_NAME}:${seg}`;
}

function buildUrl(
  endpoint: string,
  params: Record<string, string | number>,
): string {
  const url = new URL(FOOTBALL_DATA_ORG_BASE_URL + endpoint);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  return url.toString();
}

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
    footballDataOrgClient.logCacheHit(opts.endpoint, Date.now() - cacheStart);
    return cached;
  }

  const key = requireApiKey();
  const url = buildUrl(opts.endpoint, params);

  let result: { response: Response; text: string };
  try {
    const r = await footballDataOrgClient.send({
      endpoint: opts.endpoint,
      url,
      init: {
        method: "GET",
        headers: { "X-Auth-Token": key, Accept: "application/json" },
      },
    });
    result = { response: r.response, text: r.text };
  } catch (err) {
    if (err instanceof RetryableHttpError) {
      throw new FootballDataOrgHttpError(
        `Transient HTTP ${err.statusCode} on ${opts.endpoint}`,
        opts.endpoint,
        params,
        err.statusCode,
        err.body,
      );
    }
    if (err instanceof HttpClientError) {
      throw new FootballDataOrgHttpError(
        `HTTP ${err.statusCode} on ${opts.endpoint}`,
        opts.endpoint,
        params,
        err.statusCode,
        err.body,
      );
    }
    if (err instanceof HttpClientTimeoutError) {
      throw new FootballDataOrgTimeoutError(opts.endpoint, params);
    }
    throw err;
  }

  const { response, text } = result;

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new FootballDataOrgHttpError(
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
        provider: PROVIDER_NAME,
        endpoint: opts.endpoint,
        params,
        error: "schema_validation_failed",
        payload_preview: text.slice(0, 2048),
        zod_issues: parsed.error.issues.slice(0, 10),
      }),
    );
    throw new FootballDataOrgSchemaError(
      `Schema validation failed for ${opts.endpoint}`,
      opts.endpoint,
      params,
      parsed.error,
    );
  }

  await cache.set(cacheKey, parsed.data, opts.ttlMs);
  return parsed.data;
}

// ─── Normalization helpers ──────────────────────────────────────────────────

function toNormalizedFixture(
  m: FootballDataOrgMatch,
  league: SupportedLeague,
): NormalizedFixture {
  const home = canonicalizeOrPassthrough(m.homeTeam.name, league);
  const away = canonicalizeOrPassthrough(m.awayTeam.name, league);
  const kickoffAt = new Date(m.utcDate).toISOString();
  return {
    id: compositeFixtureKey({
      league,
      kickoffAt,
      homeTeam: home,
      awayTeam: away,
    }),
    league,
    kickoffAt,
    kickoffTimestampMs: Date.parse(m.utcDate),
    homeTeam: home,
    awayTeam: away,
    status: mapFootballDataOrgStatus(m.status),
    score: { home: m.score.fullTime.home, away: m.score.fullTime.away },
    venue: m.venue ?? undefined,
  };
}

// Settlement result: 90' regulation score. v4's score.fullTime is the running
// final score (includes extra time + penalties on knockouts), so prefer
// score.regularTime, which holds the 90' result. fullTime is correct only when
// the match ended in regulation (regularTime absent).
function toNormalizedFixtureResult(
  m: FootballDataOrgMatch,
): NormalizedFixtureResult {
  // Prefer the explicit 90' field. fullTime is the running final score and on
  // knockouts includes ET + penalties, so trust it ONLY when the match ended in
  // regulation. If the match went beyond 90' but the provider didn't give us
  // regularTime, refuse to settle (null) rather than settle on an ET score.
  const wentBeyond90 =
    (m.score.duration ?? "REGULAR") !== "REGULAR" || m.score.extraTime != null;
  const reg =
    m.score.regularTime ?? (wentBeyond90 ? null : m.score.fullTime);
  const regulationScore =
    reg && reg.home !== null && reg.away !== null
      ? { home: reg.home, away: reg.away }
      : null;
  return {
    status: mapFootballDataOrgStatus(m.status),
    regulationScore,
  };
}

function mapStandingsPositionToRole(pos: string): string | undefined {
  // football-data.org returns the full position label (e.g. "Goalkeeper",
  // "Centre-Back", "Right Winger"). Collapse to GK/DEF/MID/FWD to match the
  // AI-input schema.
  const p = pos.toLowerCase();
  if (p.includes("goalkeeper") || p === "gk") return "GK";
  if (
    p.includes("back") ||
    p.includes("defender") ||
    p === "def" ||
    p.includes("wing-back")
  )
    return "DEF";
  if (p.includes("midfield") || p === "mid") return "MID";
  if (
    p.includes("forward") ||
    p.includes("striker") ||
    p.includes("winger") ||
    p === "fwd" ||
    p === "attacker"
  )
    return "FWD";
  return undefined;
}

function toNormalizedStanding(
  s: FootballDataOrgStandingsResponse,
  league: SupportedLeague,
): NormalizedStanding {
  // Group entries by `group` value (null for league competitions).
  // Within each group, find TOTAL/HOME/AWAY entries; merge into per-team rows.
  const byGroup = new Map<
    string,
    {
      total?: FootballDataOrgStandingsResponse["standings"][number];
      home?: FootballDataOrgStandingsResponse["standings"][number];
      away?: FootballDataOrgStandingsResponse["standings"][number];
    }
  >();
  for (const entry of s.standings) {
    const key = entry.group ?? "__default__";
    const bucket = byGroup.get(key) ?? {};
    if (entry.type === "TOTAL") bucket.total = entry;
    else if (entry.type === "HOME") bucket.home = entry;
    else if (entry.type === "AWAY") bucket.away = entry;
    byGroup.set(key, bucket);
  }

  const tables: NormalizedStanding["tables"] = [];
  for (const [groupKey, bucket] of byGroup) {
    if (!bucket.total) continue;
    const teams: NormalizedStandingTeam[] = bucket.total.table.map((row) => {
      const teamName = canonicalizeOrPassthrough(row.team.name, league);
      const homeRow = bucket.home?.table.find((r) => r.team.id === row.team.id);
      const awayRow = bucket.away?.table.find((r) => r.team.id === row.team.id);
      return {
        position: row.position,
        team: teamName,
        played: row.playedGames,
        won: row.won,
        draw: row.draw,
        lost: row.lost,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        points: row.points,
        homeSplit: homeRow
          ? {
              played: homeRow.playedGames,
              wins: homeRow.won,
              draws: homeRow.draw,
              losses: homeRow.lost,
              goalsFor: homeRow.goalsFor,
              goalsAgainst: homeRow.goalsAgainst,
            }
          : undefined,
        awaySplit: awayRow
          ? {
              played: awayRow.playedGames,
              wins: awayRow.won,
              draws: awayRow.draw,
              losses: awayRow.lost,
              goalsFor: awayRow.goalsFor,
              goalsAgainst: awayRow.goalsAgainst,
            }
          : undefined,
      };
    });
    tables.push(
      groupKey === "__default__" ? { teams } : { group: groupKey, teams },
    );
  }

  return {
    league,
    season: s.season && typeof s.season.id === "number" ? s.season.id : null,
    tables,
  };
}

function toNormalizedTeamLineup(
  team: FootballDataOrgMatchWithLineup["homeTeam"],
  league: SupportedLeague,
): NormalizedTeamLineup | undefined {
  if (!team.lineup || team.lineup.length === 0) return undefined;
  const starters: NormalizedLineupPlayer[] = team.lineup.map((p) => ({
    name: p.name,
    shirtNumber: p.shirtNumber ?? undefined,
    position: p.position ? mapStandingsPositionToRole(p.position) : undefined,
  }));
  const bench: NormalizedLineupPlayer[] | undefined = team.bench?.map((p) => ({
    name: p.name,
    shirtNumber: p.shirtNumber ?? undefined,
    position: p.position ? mapStandingsPositionToRole(p.position) : undefined,
  }));
  return {
    team: canonicalizeOrPassthrough(team.name, league),
    formation: team.formation ?? undefined,
    starters,
    bench,
  };
}

// ─── Error wrapping ─────────────────────────────────────────────────────────

function wrapFootballDataOrgError(
  err: unknown,
  method: string,
  context: Record<string, unknown>,
): never {
  if (err instanceof FootballDataOrgSchemaError) {
    throw new SportsDataTransientError(
      `Schema mismatch on ${err.endpoint}`,
      PROVIDER_NAME,
      method,
      err,
      context,
    );
  }
  if (err instanceof FootballDataOrgTimeoutError) {
    throw new SportsDataTransientError(
      `Timed out on ${err.endpoint}`,
      PROVIDER_NAME,
      method,
      err,
      context,
    );
  }
  if (err instanceof FootballDataOrgHttpError) {
    if (err.status >= 500 || err.status === 429) {
      throw new SportsDataTransientError(
        `HTTP ${err.status} on ${err.endpoint}`,
        PROVIDER_NAME,
        method,
        err,
        context,
      );
    }
    throw new SportsDataNotFoundError(
      `HTTP ${err.status} on ${err.endpoint}: ${err.body.slice(0, 200)}`,
      PROVIDER_NAME,
      method,
      context,
    );
  }
  if (err instanceof FootballDataOrgError) {
    throw new SportsDataTransientError(
      err.message,
      PROVIDER_NAME,
      method,
      err,
      context,
    );
  }
  throw err;
}

function resolveTeamId(
  canonicalName: string,
  league: SupportedLeague,
  method: string,
): number {
  const id = FOOTBALL_DATA_ORG_TEAM_IDS[league][canonicalName];
  if (id === undefined) {
    throw new SportsDataNotFoundError(
      `No football-data.org team ID mapped for "${canonicalName}" in ${league}.`,
      PROVIDER_NAME,
      method,
      { canonicalName, league },
    );
  }
  return id;
}

// ─── Adapter ────────────────────────────────────────────────────────────────

export class FootballDataOrgAdapter implements SportsDataProvider {
  readonly capabilities: ProviderCapabilities = {
    name: PROVIDER_NAME,
    supportsInjuries: false,
    supportsLineups: true,
    // Sem endpoint de desfalques no tier grátis (#227) — espelha supportsInjuries.
    supportsAbsences: false,
    supportedLeagues: new Set<SupportedLeague>([
      "brasileirao_a",
      "champions_league",
      "world_cup",
    ]),
  };

  /**
   * Internal: lists matches for a league in a date window. Used by
   * getFixturesByDate (1-day window) and getFixtureByMatch (same).
   * Cache key includes both bounds so day-window queries don't collide with
   * range queries.
   */
  private async listCompetitionMatches(
    league: SupportedLeague,
    dateFrom: string,
    dateTo: string,
  ): Promise<FootballDataOrgMatchesList> {
    const code = FOOTBALL_DATA_ORG_LEAGUE_CODES[league];
    const endpoint = `/competitions/${code}/matches`;
    return await request({
      endpoint,
      params: { dateFrom, dateTo },
      schema: MatchesListSchema,
      ttlMs: FIFTEEN_MINUTES,
    });
  }

  /**
   * Internal: lists the WHOLE competition+season in one call via the v4
   * `season` filter on /competitions/{code}/matches (confirmed: the docs
   * accept `season` as a four-digit year, e.g. `?season=2025`; default is the
   * current season). Distinct cache key from the date-window variant because
   * the `season` param differs, so season-wide and day-window reads never
   * collide. ONE_HOUR TTL mirrors getStandings — a competition-wide payload
   * mixes finished and upcoming matches, so per-fixture imminent/live tightening
   * isn't meaningful for the bulk fetch.
   */
  private async listCompetitionMatchesBySeason(
    league: SupportedLeague,
    season: number,
  ): Promise<FootballDataOrgMatchesList> {
    const code = FOOTBALL_DATA_ORG_LEAGUE_CODES[league];
    const endpoint = `/competitions/${code}/matches`;
    return await request({
      endpoint,
      params: { season },
      schema: MatchesListSchema,
      ttlMs: ONE_HOUR,
    });
  }

  /**
   * Internal: fetches up to `limit` finished matches for a team. Shared cache
   * between getH2H and getTeamForm — both methods hit the same endpoint with
   * the same `{teamId, status, limit}` params, so a single fetch serves both.
   * TTL = ONE_DAY since FINISHED matches don't change.
   *
   * Use a stable `limit` (50) regardless of the caller's `last` so the cache
   * key collides across getH2H/getTeamForm; callers slice down to their N.
   */
  private async listTeamFinishedMatches(
    teamId: number,
    limit = 50,
  ): Promise<FootballDataOrgMatchesList> {
    return await request({
      endpoint: `/teams/${teamId}/matches`,
      params: { status: "FINISHED", limit },
      schema: MatchesListSchema,
      ttlMs: ONE_DAY,
    });
  }

  async getFixturesByDate(
    date: string,
    league: SupportedLeague,
  ): Promise<NormalizedFixture[]> {
    try {
      const list = await this.listCompetitionMatches(league, date, date);
      const fixtures = list.matches.map((m) => toNormalizedFixture(m, league));
      // Tighten cache TTL based on payload — adopt the same heuristic as
      // api-football: short TTL when any fixture is imminent or live.
      const tighterTtl = pickTtlForFixtureCollection(fixtures);
      if (tighterTtl < FIFTEEN_MINUTES) {
        const code = FOOTBALL_DATA_ORG_LEAGUE_CODES[league];
        const cacheKey = buildCacheKey(`/competitions/${code}/matches`, {
          dateFrom: date,
          dateTo: date,
        });
        await inMemoryCache.set(cacheKey, list, tighterTtl);
      }
      return fixtures;
    } catch (err) {
      wrapFootballDataOrgError(err, "getFixturesByDate", { date, league });
    }
  }

  async getFixturesBySeason(
    league: SupportedLeague,
    season?: number,
  ): Promise<NormalizedFixture[]> {
    try {
      const seasonValue = season ?? currentSeason(league);
      // One call covers the whole competition+season via the v4 `season` filter,
      // then normalize through the SAME toNormalizedFixture path getFixturesByDate
      // uses so both entry points emit identical fixtures.
      const list = await this.listCompetitionMatchesBySeason(
        league,
        seasonValue,
      );
      return list.matches.map((m) => toNormalizedFixture(m, league));
    } catch (err) {
      wrapFootballDataOrgError(err, "getFixturesBySeason", { league, season });
    }
  }

  async getFixtureByMatch(
    ref: FixtureRef,
  ): Promise<NormalizedFixture | undefined> {
    try {
      const date = ref.kickoffAt.slice(0, 10);
      const list = await this.listCompetitionMatches(ref.league, date, date);
      const match = list.matches.find((m) => {
        const home = canonicalizeOrPassthrough(m.homeTeam.name, ref.league);
        const away = canonicalizeOrPassthrough(m.awayTeam.name, ref.league);
        return home === ref.homeTeam && away === ref.awayTeam;
      });
      if (!match) return undefined;
      const fixture = toNormalizedFixture(match, ref.league);
      // Re-tighten cache for the day-list once we know the match status.
      const ttl = pickTtlForFixture(
        fixture.kickoffTimestampMs,
        fixture.status,
      );
      if (ttl < FIFTEEN_MINUTES) {
        const code = FOOTBALL_DATA_ORG_LEAGUE_CODES[ref.league];
        const cacheKey = buildCacheKey(`/competitions/${code}/matches`, {
          dateFrom: date,
          dateTo: date,
        });
        await inMemoryCache.set(cacheKey, list, ttl);
      }
      return fixture;
    } catch (err) {
      wrapFootballDataOrgError(err, "getFixtureByMatch", { ref });
    }
  }

  async getFixtureResult(
    ref: FixtureRef,
  ): Promise<NormalizedFixtureResult | undefined> {
    try {
      const date = ref.kickoffAt.slice(0, 10);
      const list = await this.listCompetitionMatches(ref.league, date, date);
      const match = list.matches.find((m) => {
        const home = canonicalizeOrPassthrough(m.homeTeam.name, ref.league);
        const away = canonicalizeOrPassthrough(m.awayTeam.name, ref.league);
        return home === ref.homeTeam && away === ref.awayTeam;
      });
      if (!match) return undefined;
      return toNormalizedFixtureResult(match);
    } catch (err) {
      wrapFootballDataOrgError(err, "getFixtureResult", { ref });
    }
  }

  async getFixtureEvents(
    _ref: FixtureRef,
  ): Promise<NormalizedFixtureEvents | undefined> {
    // football-data.org (tier grátis) NÃO expõe eventos de gol/assistência por
    // jogador — settlement de scorer/assist (#290) só roda via api-football. O
    // FallbackProvider faz capability-gate em supportsFixtureEvents, então este
    // throw é só o backstop (provider sem a capability nunca deveria ser chamado).
    throw new SportsDataUnsupportedError(
      "football-data.org free tier does not expose per-player fixture events",
      PROVIDER_NAME,
      "getFixtureEvents",
    );
  }

  async getH2H(
    homeTeam: string,
    awayTeam: string,
    league: SupportedLeague,
    last = 5,
  ): Promise<NormalizedH2H[]> {
    try {
      const homeId = resolveTeamId(homeTeam, league, "getH2H");
      const awayId = resolveTeamId(awayTeam, league, "getH2H");
      // football-data.org doesn't expose /head2head against teamIds directly
      // (only against an existing match id). Workaround: fetch home team's
      // finished matches and filter for ones where the opponent is awayId.
      // The same payload feeds getTeamForm (same cache key).
      const list = await this.listTeamFinishedMatches(homeId, 50);
      const h2h = list.matches.filter(
        (m) => m.homeTeam.id === awayId || m.awayTeam.id === awayId,
      );
      return h2h
        .map((m) => toNormalizedFixture(m, league))
        .sort((a, b) => b.kickoffTimestampMs - a.kickoffTimestampMs)
        .slice(0, last);
    } catch (err) {
      if (
        err instanceof SportsDataNotFoundError ||
        err instanceof SportsDataTransientError
      ) {
        throw err;
      }
      wrapFootballDataOrgError(err, "getH2H", {
        homeTeam,
        awayTeam,
        league,
        last,
      });
    }
  }

  async getStandings(
    league: SupportedLeague,
    season?: number,
  ): Promise<NormalizedStanding | undefined> {
    try {
      const code = FOOTBALL_DATA_ORG_LEAGUE_CODES[league];
      const data = await request({
        endpoint: `/competitions/${code}/standings`,
        params: season !== undefined ? { season } : {},
        schema: StandingsResponseSchema,
        ttlMs: ONE_HOUR,
      });
      return toNormalizedStanding(data, league);
    } catch (err) {
      wrapFootballDataOrgError(err, "getStandings", { league, season });
    }
  }

  async getInjuriesByFixture(
    _ref: FixtureRef,
  ): Promise<{ home: NormalizedInjury[]; away: NormalizedInjury[] }> {
    throw new SportsDataUnsupportedError(
      "football-data.org free tier does not expose injuries",
      PROVIDER_NAME,
      "getInjuriesByFixture",
    );
  }

  async getInjuriesByTeam(
    _team: string,
    _league: SupportedLeague,
  ): Promise<NormalizedInjury[]> {
    throw new SportsDataUnsupportedError(
      "football-data.org free tier does not expose injuries",
      PROVIDER_NAME,
      "getInjuriesByTeam",
    );
  }

  async getLineups(ref: FixtureRef): Promise<NormalizedLineup | undefined> {
    try {
      // Step 1: locate the match by date + canonical team names.
      const date = ref.kickoffAt.slice(0, 10);
      const list = await this.listCompetitionMatches(ref.league, date, date);
      const match = list.matches.find((m) => {
        const home = canonicalizeOrPassthrough(m.homeTeam.name, ref.league);
        const away = canonicalizeOrPassthrough(m.awayTeam.name, ref.league);
        return home === ref.homeTeam && away === ref.awayTeam;
      });
      if (!match) return undefined;
      // Step 2: fetch the single-match endpoint which carries lineup data.
      const full = await request({
        endpoint: `/matches/${match.id}`,
        params: {},
        schema: MatchByIdSchema,
        ttlMs: FIVE_MINUTES,
      });
      const home = toNormalizedTeamLineup(full.homeTeam, ref.league);
      const away = toNormalizedTeamLineup(full.awayTeam, ref.league);
      if (!home || !away) return undefined;
      return {
        fixtureId: compositeFixtureKey(ref),
        home,
        away,
      };
    } catch (err) {
      wrapFootballDataOrgError(err, "getLineups", { ref });
    }
  }

  async getTeamForm(
    team: string,
    league: SupportedLeague,
    last: number,
  ): Promise<NormalizedFixture[]> {
    try {
      const teamId = resolveTeamId(team, league, "getTeamForm");
      const list = await this.listTeamFinishedMatches(teamId, 50);
      const fixtures = list.matches
        .map((m) => toNormalizedFixture(m, league))
        .filter((f) => f.status === "finished")
        .sort((a, b) => b.kickoffTimestampMs - a.kickoffTimestampMs)
        .slice(0, last);
      return fixtures;
    } catch (err) {
      if (
        err instanceof SportsDataNotFoundError ||
        err instanceof SportsDataTransientError
      ) {
        throw err;
      }
      wrapFootballDataOrgError(err, "getTeamForm", { team, league, last });
    }
  }
}

// Internal exports for unit tests.
export const __testing = {
  toNormalizedFixture,
  toNormalizedFixtureResult,
  toNormalizedStanding,
  toNormalizedTeamLineup,
  wrapFootballDataOrgError,
  resolveTeamId,
  buildCacheKey,
};
