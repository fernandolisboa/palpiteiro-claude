import { z } from "zod";

import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

// ─── Normalized DTOs + Zod schemas ───────────────────────────────────────────
// Provider-neutral odds DTO (#288, ADR 0025). Field names hide the wire
// snake_case; the structure mirrors the provider event payload 1:1 so the
// bookmaker→market→outcome selection logic (select-bookmaker.ts) is byte-
// identical after the rename. The Odds API wire types (OddsApiEventOdds/
// OddsApiOutcome) are now PRIVATE to the the-odds-api adapter — no consumer
// imports them. Parallels lib/providers/sports-data/types.ts (NormalizedFixture).

export const NormalizedOddsOutcomeSchema = z.object({
  name: z.string(), // "Over"/"Under", time/draw, "Yes"/"No", "{home} or Draw"…
  price: z.number(), // odd decimal (verbatim do provider)
  point: z.number().optional(), // 2.5 em totals; ausente em h2h/btts/dupla chance
});
export type NormalizedOddsOutcome = z.infer<typeof NormalizedOddsOutcomeSchema>;

export const NormalizedOddsMarketSchema = z.object({
  // Chave do mercado no provider (providerMarketKey: "totals"/"h2h"/…). O adapter
  // a repassa VERBATIM — select-bookmaker casa contra descriptor.providerMarketKey.
  key: z.string(),
  lastUpdate: z.string(), // ISO (wire market.last_update) — vira MarketOddsBundle.lastUpdate
  outcomes: z.array(NormalizedOddsOutcomeSchema),
});
export type NormalizedOddsMarket = z.infer<typeof NormalizedOddsMarketSchema>;

export const NormalizedOddsBookmakerSchema = z.object({
  key: z.string(),
  title: z.string(), // PERSISTIDO (coluna bookmaker)
  markets: z.array(NormalizedOddsMarketSchema),
});
export type NormalizedOddsBookmaker = z.infer<
  typeof NormalizedOddsBookmakerSchema
>;

export const NormalizedOddsEventSchema = z.object({
  id: z.string(),
  commenceTime: z.string(), // ISO 8601 (wire commence_time)
  homeTeam: z.string(),
  awayTeam: z.string(),
  bookmakers: z.array(NormalizedOddsBookmakerSchema),
});
export type NormalizedOddsEvent = z.infer<typeof NormalizedOddsEventSchema>;

// Item da lista GRATUITA de eventos (/sports/{sport}/events) — sem bookmakers.
// Resolve o eventId antes de um fetch *additional* por evento (espelha o wire
// EventListItemSchema, que NÃO carrega bookmakers).
export const NormalizedOddsEventListItemSchema = z.object({
  id: z.string(),
  commenceTime: z.string(),
  homeTeam: z.string(),
  awayTeam: z.string(),
});
export type NormalizedOddsEventListItem = z.infer<
  typeof NormalizedOddsEventListItemSchema
>;

// ─── Capabilities (paralelo a ProviderCapabilities do sports-data) ────────────
export type OddsProviderCapabilities = {
  readonly name: string;
  readonly supportedLeagues: ReadonlySet<SupportedLeague>;
};

// ─── Option bags (provider-neutras; subconjunto do que o cliente aceita) ──────
export type GetOddsForSportOptions = {
  regions?: readonly string[];
  markets?: readonly string[]; // providerMarketKeys
  commenceTimeFrom?: string; // ISO 8601
  commenceTimeTo?: string; // ISO 8601
};

export type GetOddsForEventOptions = {
  regions?: readonly string[];
  markets?: readonly string[]; // providerMarketKeys
};

export type GetEventsForSportOptions = {
  commenceTimeFrom?: string; // ISO 8601
  commenceTimeTo?: string; // ISO 8601
};

// ─── OddsProvider interface ───────────────────────────────────────────────────
// Espelha SportsDataProvider (ADR 0005). #288 tem 1 adapter (The Odds API); o 2º
// provider + OddsFallbackProvider + a hierarquia de erro/cascade são do #289
// (ADR 0025). A hierarquia de erro NÃO está aqui de propósito: em #288 o adapter
// propaga OddsApiError sem alterar (byte-idêntico).
export interface OddsProvider {
  readonly capabilities: OddsProviderCapabilities;

  // Capacidade data-driven por (sportKey, providerMarketKey). O OddsFallbackProvider
  // (#289) roteia por ISTO, nunca por nome de provider. Adapters cobre-tudo (The Odds
  // API) retornam true amplamente; adapters de cauda (api-football) só pra seu key+liga.
  supportsMarket(args: { sportKey: string; providerMarketKey: string }): boolean;

  // Odds em batch da liga (mercados featured: totals/h2h). `markets` =
  // providerMarketKeys.
  getOddsForSport(
    sportKey: string,
    options?: GetOddsForSportOptions,
  ): Promise<NormalizedOddsEvent[]>;

  // Odds por evento (mercados additional: alternate_totals/btts/double_chance).
  getOddsForEvent(
    sportKey: string,
    eventId: string,
    options?: GetOddsForEventOptions,
  ): Promise<NormalizedOddsEvent>;

  // Lista GRATUITA de eventos (0 créditos) — resolve o eventId antes de um fetch
  // por evento.
  getEventsForSport(
    sportKey: string,
    options?: GetEventsForSportOptions,
  ): Promise<NormalizedOddsEventListItem[]>;
}
