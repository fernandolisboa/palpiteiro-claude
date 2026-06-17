import { z } from "zod";

import {
  type SupportedLeague,
  SupportedLeagueSchema,
} from "@/lib/providers/sports-data/leagues";

// ─── Normalized DTOs + Zod schemas ──────────────────────────────────────────

export const NormalizedFixtureStatusSchema = z.enum([
  "scheduled",
  "live",
  "finished",
  "postponed",
  "cancelled",
  "other",
]);
export type NormalizedFixtureStatus = z.infer<
  typeof NormalizedFixtureStatusSchema
>;

export const NormalizedFixtureSchema = z.object({
  // Composite key: `${league}:${kickoffAtISO}:${homeTeam}:${awayTeam}`.
  // Provider-agnostic so the same logical fixture has the same id whether
  // it came from api-football or football-data-org.
  id: z.string().min(1),
  league: SupportedLeagueSchema,
  kickoffAt: z.string().datetime(),
  kickoffTimestampMs: z.number().int(),
  homeTeam: z.string().min(1),
  awayTeam: z.string().min(1),
  status: NormalizedFixtureStatusSchema,
  score: z.object({
    home: z.number().int().nullable(),
    away: z.number().int().nullable(),
  }),
  venue: z.string().min(1).optional(),
});
export type NormalizedFixture = z.infer<typeof NormalizedFixtureSchema>;

export const NormalizedH2HSchema = NormalizedFixtureSchema;
export type NormalizedH2H = NormalizedFixture;

// Result of a fixture as needed for settlement. `regulationScore` is the score
// at the end of 90' (regulation only), deliberately EXCLUDING extra time and
// penalties — over/under 2.5 settles by the 90' result. It's null until the
// match has a finished 90' score available (live/scheduled/postponed).
export const NormalizedFixtureResultSchema = z.object({
  status: NormalizedFixtureStatusSchema,
  regulationScore: z
    .object({ home: z.number().int(), away: z.number().int() })
    .nullable(),
});
export type NormalizedFixtureResult = z.infer<
  typeof NormalizedFixtureResultSchema
>;

// Eventos de um fixture pra settlement de mercados de jogador (#290, ADR 0025
// emenda): artilheiro (bet_92) e assistência (bet_212). Cada gol/assistência
// carrega o jogador (id numérico do provider quando disponível + nome canônico
// pra match por nome) e o flag `isRegulation` (ocorreu no tempo regulamentar de
// 90', INCLUINDO acréscimos — exclui prorrogação 91-120' e pênaltis de
// disputa). Own goals (`isOwnGoal`) NÃO creditam o autor (regra de mercado);
// pênaltis (`isPenalty`) creditam normalmente. `eventsAvailable` é true SÓ
// quando o fetch teve sucesso num fixture finalizado — settlement de scorer só
// liquida com `eventsAvailable === true` (senão deixa pending, nunca fabrica
// loss). `teamSide` é informativo (não usado no settlement yes-only).
export const NormalizedGoalEventSchema = z.object({
  playerId: z.number().int().nullable(),
  playerName: z.string().min(1),
  teamSide: z.enum(["home", "away"]),
  minute: z.number().int().nullable(),
  isPenalty: z.boolean(),
  isOwnGoal: z.boolean(),
  isRegulation: z.boolean(),
});
export type NormalizedGoalEvent = z.infer<typeof NormalizedGoalEventSchema>;

export const NormalizedAssistEventSchema = z.object({
  playerId: z.number().int().nullable(),
  playerName: z.string().min(1),
  teamSide: z.enum(["home", "away"]),
  minute: z.number().int().nullable(),
  isRegulation: z.boolean(),
});
export type NormalizedAssistEvent = z.infer<
  typeof NormalizedAssistEventSchema
>;

export const NormalizedFixtureEventsSchema = z.object({
  fixtureStatus: NormalizedFixtureStatusSchema,
  // true SÓ quando o fetch teve sucesso num fixture finalizado. settlement de
  // scorer só liquida com isto true; false/undefined → pending (prefer-skip).
  eventsAvailable: z.boolean(),
  // Gols/assistências de 90' (regulation). Own goals presentes mas marcados
  // (não creditam). A regra de settlement filtra por isRegulation + isOwnGoal.
  goals: z.array(NormalizedGoalEventSchema),
  assists: z.array(NormalizedAssistEventSchema),
});
export type NormalizedFixtureEvents = z.infer<
  typeof NormalizedFixtureEventsSchema
>;

export const NormalizedStandingSplitSchema = z.object({
  played: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  draws: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  goalsFor: z.number().int().nonnegative(),
  goalsAgainst: z.number().int().nonnegative(),
});
export type NormalizedStandingSplit = z.infer<
  typeof NormalizedStandingSplitSchema
>;

export const NormalizedStandingTeamSchema = z.object({
  position: z.number().int().positive(),
  team: z.string().min(1),
  played: z.number().int().nonnegative(),
  won: z.number().int().nonnegative(),
  draw: z.number().int().nonnegative(),
  lost: z.number().int().nonnegative(),
  goalsFor: z.number().int().nonnegative(),
  goalsAgainst: z.number().int().nonnegative(),
  points: z.number().int().nonnegative(),
  homeSplit: NormalizedStandingSplitSchema.optional(),
  awaySplit: NormalizedStandingSplitSchema.optional(),
});
export type NormalizedStandingTeam = z.infer<
  typeof NormalizedStandingTeamSchema
>;

export const NormalizedStandingSchema = z.object({
  league: SupportedLeagueSchema,
  season: z.number().int().nullable(),
  // Preserves group structure: CL group stage returns one table per group;
  // league competitions return a single table without a group label.
  tables: z.array(
    z.object({
      group: z.string().optional(),
      teams: z.array(NormalizedStandingTeamSchema),
    }),
  ),
});
export type NormalizedStanding = z.infer<typeof NormalizedStandingSchema>;

// Proveniência (ADR 0026, #226): seam oficial-primeiro. `source` distingue dado
// estruturado oficial de fallback não-oficial; `confidence`/`capturedAt` ficam pro
// fallback do #227 popular. TODOS opcionais (additive — não quebra os ~13
// consumidores/construtores de NormalizedInjury). Hoje só a API-Football produz
// injuries e marca `source:"official"`.
export const NormalizedInjurySchema = z.object({
  player: z.object({ name: z.string().min(1) }),
  type: z.enum(["injury", "suspension"]),
  reason: z.string().optional(),
  status: z.enum(["injured", "suspended", "doubtful"]),
  source: z.enum(["official", "unofficial"]).optional(),
  confidence: z.number().min(0).max(100).optional(),
  capturedAt: z.string().datetime().optional(),
});
export type NormalizedInjury = z.infer<typeof NormalizedInjurySchema>;

export const NormalizedLineupPlayerSchema = z.object({
  name: z.string().min(1),
  shirtNumber: z.number().int().nullable().optional(),
  position: z.string().optional(),
});
export type NormalizedLineupPlayer = z.infer<
  typeof NormalizedLineupPlayerSchema
>;

export const NormalizedTeamLineupSchema = z.object({
  team: z.string().min(1),
  formation: z.string().optional(),
  starters: z.array(NormalizedLineupPlayerSchema),
  bench: z.array(NormalizedLineupPlayerSchema).optional(),
});
export type NormalizedTeamLineup = z.infer<typeof NormalizedTeamLineupSchema>;

export const NormalizedLineupSchema = z.object({
  fixtureId: z.string().min(1),
  home: NormalizedTeamLineupSchema,
  away: NormalizedTeamLineupSchema,
});
export type NormalizedLineup = z.infer<typeof NormalizedLineupSchema>;

export const NormalizedFormSchema = z.object({
  team: z.string().min(1),
  matches: z.array(NormalizedFixtureSchema),
});
export type NormalizedForm = z.infer<typeof NormalizedFormSchema>;

export const FixtureRefSchema = z.object({
  league: SupportedLeagueSchema,
  kickoffAt: z.string().datetime(),
  homeTeam: z.string().min(1),
  awayTeam: z.string().min(1),
});
export type FixtureRef = z.infer<typeof FixtureRefSchema>;

/**
 * Builds the composite key for a fixture. Same logical fixture has the same
 * id across providers, so cache reads/writes are consistent.
 */
export function compositeFixtureKey(ref: FixtureRef): string {
  return `${ref.league}:${ref.kickoffAt}:${ref.homeTeam}:${ref.awayTeam}`;
}

// ─── Capabilities ───────────────────────────────────────────────────────────

export type ProviderCapabilities = {
  readonly name: string;
  readonly supportsInjuries: boolean;
  readonly supportsLineups: boolean;
  readonly supportedLeagues: ReadonlySet<SupportedLeague>;
  // Eventos de fixture (gols/assistências) pra settlement de scorer/assist
  // (#290). OPCIONAL: os 9 literais de capability existentes compilam sem
  // mudança (ausente ⇒ falsy); o FallbackProvider lê `=== true` no gate. Só a
  // api-football a declara true (football-data-org não expõe eventos por jogador
  // no tier grátis).
  readonly supportsFixtureEvents?: boolean;
  // Desfalques estruturados (lesões/suspensões) — gate da AbsencesProvider
  // (ADR 0026 D3, #227). OPCIONAL (additive). api-football=true (BR/CL);
  // football-data-org=false; o adapter SportMonks computa true só com token.
  readonly supportsAbsences?: boolean;
};

// ─── SportsDataProvider interface ────────────────────────────────────────────

export interface SportsDataProvider {
  readonly capabilities: ProviderCapabilities;
  getFixturesByDate(
    date: string,
    league: SupportedLeague,
  ): Promise<NormalizedFixture[]>;
  /**
   * Fetches the ENTIRE competition+season in a single provider call, rather than
   * iterating day by day like {@link getFixturesByDate}. When `season` is
   * omitted, the adapter resolves the current season for the league (per
   * `currentSeason` in leagues.ts). Returns every fixture the provider has for
   * that competition+season, normalized into provider-agnostic fixtures.
   */
  getFixturesBySeason(
    league: SupportedLeague,
    season?: number,
  ): Promise<NormalizedFixture[]>;
  getFixtureByMatch(ref: FixtureRef): Promise<NormalizedFixture | undefined>;
  // Fetches the settlement result (status + 90' regulation score) for a
  // fixture. Returns undefined when the fixture can't be found at the provider.
  getFixtureResult(
    ref: FixtureRef,
  ): Promise<NormalizedFixtureResult | undefined>;
  // Eventos de 90' (gols/assistências por jogador) pra settlement de scorer/
  // assist (#290). Retorna undefined quando o fixture não é encontrado no
  // provider. Providers sem a capability lançam SportsDataUnsupportedError.
  getFixtureEvents(
    ref: FixtureRef,
  ): Promise<NormalizedFixtureEvents | undefined>;
  getH2H(
    homeTeam: string,
    awayTeam: string,
    league: SupportedLeague,
    last?: number,
  ): Promise<NormalizedH2H[]>;
  getStandings(
    league: SupportedLeague,
    season?: number,
  ): Promise<NormalizedStanding | undefined>;
  getInjuriesByFixture(
    ref: FixtureRef,
  ): Promise<{ home: NormalizedInjury[]; away: NormalizedInjury[] }>;
  getInjuriesByTeam(
    team: string,
    league: SupportedLeague,
  ): Promise<NormalizedInjury[]>;
  getLineups(ref: FixtureRef): Promise<NormalizedLineup | undefined>;
  getTeamForm(
    team: string,
    league: SupportedLeague,
    last: number,
  ): Promise<NormalizedFixture[]>;
}

// ─── Error hierarchy (cascade contract for FallbackProvider) ────────────────

export class SportsDataError extends Error {
  readonly providerName: string;
  readonly method: string;
  readonly context: Record<string, unknown>;
  constructor(
    message: string,
    providerName: string,
    method: string,
    context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SportsDataError";
    this.providerName = providerName;
    this.method = method;
    this.context = context;
  }
}

// Transient: 5xx after retries, 429 after retries, network error, timeout,
// schema mismatch from a malformed provider response. FallbackProvider
// cascades to the next adapter when this is thrown.
export class SportsDataTransientError extends SportsDataError {
  readonly originalError: unknown;
  constructor(
    message: string,
    providerName: string,
    method: string,
    originalError: unknown,
    context: Record<string, unknown> = {},
  ) {
    super(message, providerName, method, context);
    this.name = "SportsDataTransientError";
    this.originalError = originalError;
  }
}

// Non-transient: 4xx (except 429), entity not found. FallbackProvider does
// NOT cascade — the error bubbles up to the caller.
export class SportsDataNotFoundError extends SportsDataError {
  constructor(
    message: string,
    providerName: string,
    method: string,
    context: Record<string, unknown> = {},
  ) {
    super(message, providerName, method, context);
    this.name = "SportsDataNotFoundError";
  }
}

// Capability missing: provider doesn't support the requested operation.
// FallbackProvider tries the next adapter if it has the capability;
// otherwise re-throws.
export class SportsDataUnsupportedError extends SportsDataError {
  constructor(
    message: string,
    providerName: string,
    method: string,
    context: Record<string, unknown> = {},
  ) {
    super(message, providerName, method, context);
    this.name = "SportsDataUnsupportedError";
  }
}
