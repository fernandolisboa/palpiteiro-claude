import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import {
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
  type NormalizedStanding,
  type ProviderCapabilities,
  type SportsDataProvider,
} from "@/lib/providers/sports-data/types";

/**
 * Composes two SportsDataProvider adapters with primary-first dispatch and
 * automatic cascade to the fallback on transient errors.
 *
 * Cascade contract:
 * - `SportsDataTransientError` -> try next candidate (5xx, 429 after retry,
 *   timeout, network failure, schema drift, envelope error like
 *   account-suspended).
 * - `SportsDataNotFoundError`  -> bubble up (4xx that isn't 429: input error,
 *   not an outage).
 * - `SportsDataUnsupportedError` -> handled via `capabilityGate` so the
 *   request never reaches a provider lacking the capability. When neither
 *   provider supports the capability, the gate throws Unsupported.
 * - Any other error (programmer error like TypeError) -> bubble up unchanged.
 *
 * Capability aggregation: `name = fallback(<primary>,<fallback>)`,
 * supports{Injuries,Lineups} = OR over the two adapters, supportedLeagues =
 * union of both adapters' sets.
 */
export class FallbackProvider implements SportsDataProvider {
  readonly capabilities: ProviderCapabilities;

  constructor(
    private readonly primary: SportsDataProvider,
    private readonly fallback: SportsDataProvider,
  ) {
    const leagues = new Set<SupportedLeague>();
    for (const l of primary.capabilities.supportedLeagues) leagues.add(l);
    for (const l of fallback.capabilities.supportedLeagues) leagues.add(l);
    this.capabilities = {
      name: `fallback(${primary.capabilities.name},${fallback.capabilities.name})`,
      supportsInjuries:
        primary.capabilities.supportsInjuries ||
        fallback.capabilities.supportsInjuries,
      supportsLineups:
        primary.capabilities.supportsLineups ||
        fallback.capabilities.supportsLineups,
      supportedLeagues: leagues,
    };
  }

  private logFallback(args: {
    method: string;
    primary: string;
    fallback: string;
    cause: unknown;
  }): void {
    const cause =
      args.cause instanceof Error
        ? `${args.cause.name}: ${args.cause.message}`
        : String(args.cause);
    console.warn(
      JSON.stringify({
        event: "fallback_activated",
        method: args.method,
        primary: args.primary,
        fallback: args.fallback,
        cause,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  private async withFallback<T>(
    method: string,
    capabilityGate: ((p: SportsDataProvider) => boolean) | null,
    invoke: (p: SportsDataProvider) => Promise<T>,
  ): Promise<T> {
    const candidates = [this.primary, this.fallback].filter(
      (p) => capabilityGate === null || capabilityGate(p),
    );
    if (candidates.length === 0) {
      throw new SportsDataUnsupportedError(
        `No provider supports ${method}`,
        this.capabilities.name,
        method,
      );
    }
    let lastError: unknown;
    for (let i = 0; i < candidates.length; i++) {
      const provider = candidates[i]!;
      try {
        return await invoke(provider);
      } catch (err) {
        if (err instanceof SportsDataNotFoundError) {
          // Input error — don't cascade.
          throw err;
        }
        if (!(err instanceof SportsDataTransientError)) {
          // Unsupported (shouldn't happen post-gate), programmer error, etc.
          throw err;
        }
        lastError = err;
        const next = candidates[i + 1];
        if (next) {
          this.logFallback({
            method,
            primary: provider.capabilities.name,
            fallback: next.capabilities.name,
            cause: err,
          });
        }
      }
    }
    // Exhausted all candidates with transient errors. Re-throw the last one so
    // the caller sees the most recent failure and the original cause chain.
    throw lastError;
  }

  getFixturesByDate(
    date: string,
    league: SupportedLeague,
  ): Promise<NormalizedFixture[]> {
    return this.withFallback(
      "getFixturesByDate",
      (p) => p.capabilities.supportedLeagues.has(league),
      (p) => p.getFixturesByDate(date, league),
    );
  }

  getFixturesBySeason(
    league: SupportedLeague,
    season?: number,
  ): Promise<NormalizedFixture[]> {
    return this.withFallback(
      "getFixturesBySeason",
      (p) => p.capabilities.supportedLeagues.has(league),
      (p) => p.getFixturesBySeason(league, season),
    );
  }

  getFixtureByMatch(ref: FixtureRef): Promise<NormalizedFixture | undefined> {
    return this.withFallback(
      "getFixtureByMatch",
      (p) => p.capabilities.supportedLeagues.has(ref.league),
      (p) => p.getFixtureByMatch(ref),
    );
  }

  getFixtureResult(
    ref: FixtureRef,
  ): Promise<NormalizedFixtureResult | undefined> {
    return this.withFallback(
      "getFixtureResult",
      (p) => p.capabilities.supportedLeagues.has(ref.league),
      (p) => p.getFixtureResult(ref),
    );
  }

  getFixtureEvents(
    ref: FixtureRef,
  ): Promise<NormalizedFixtureEvents | undefined> {
    return this.withFallback(
      "getFixtureEvents",
      // Capability-gated (#290): só providers com supportsFixtureEvents === true
      // (api-football) entram; football-data-org é filtrado fora. Se nenhum
      // suporta, withFallback lança SportsDataUnsupportedError.
      (p) =>
        p.capabilities.supportsFixtureEvents === true &&
        p.capabilities.supportedLeagues.has(ref.league),
      (p) => p.getFixtureEvents(ref),
    );
  }

  getH2H(
    homeTeam: string,
    awayTeam: string,
    league: SupportedLeague,
    last?: number,
  ): Promise<NormalizedH2H[]> {
    return this.withFallback(
      "getH2H",
      (p) => p.capabilities.supportedLeagues.has(league),
      (p) => p.getH2H(homeTeam, awayTeam, league, last),
    );
  }

  getStandings(
    league: SupportedLeague,
    season?: number,
  ): Promise<NormalizedStanding | undefined> {
    return this.withFallback(
      "getStandings",
      (p) => p.capabilities.supportedLeagues.has(league),
      (p) => p.getStandings(league, season),
    );
  }

  getInjuriesByFixture(
    ref: FixtureRef,
  ): Promise<{ home: NormalizedInjury[]; away: NormalizedInjury[] }> {
    return this.withFallback(
      "getInjuriesByFixture",
      (p) =>
        p.capabilities.supportsInjuries &&
        p.capabilities.supportedLeagues.has(ref.league),
      (p) => p.getInjuriesByFixture(ref),
    );
  }

  getInjuriesByTeam(
    team: string,
    league: SupportedLeague,
  ): Promise<NormalizedInjury[]> {
    return this.withFallback(
      "getInjuriesByTeam",
      (p) =>
        p.capabilities.supportsInjuries &&
        p.capabilities.supportedLeagues.has(league),
      (p) => p.getInjuriesByTeam(team, league),
    );
  }

  getLineups(ref: FixtureRef): Promise<NormalizedLineup | undefined> {
    return this.withFallback(
      "getLineups",
      (p) =>
        p.capabilities.supportsLineups &&
        p.capabilities.supportedLeagues.has(ref.league),
      (p) => p.getLineups(ref),
    );
  }

  getTeamForm(
    team: string,
    league: SupportedLeague,
    last: number,
  ): Promise<NormalizedFixture[]> {
    return this.withFallback(
      "getTeamForm",
      (p) => p.capabilities.supportedLeagues.has(league),
      (p) => p.getTeamForm(team, league, last),
    );
  }
}
