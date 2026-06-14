import { z } from "zod";

// ─── /v4/sports ──────────────────────────────────────────────────────────────

export const SportSchema = z.object({
  key: z.string(),
  group: z.string(),
  title: z.string(),
  description: z.string(),
  active: z.boolean(),
  has_outrights: z.boolean(),
});

export type OddsApiSport = z.infer<typeof SportSchema>;
export const SportsResponseSchema = z.array(SportSchema);

// ─── /v4/sports/{sport}/odds & /events/{eventId}/odds ────────────────────────

export const OutcomeSchema = z.object({
  name: z.string(), // "Over" | "Under" para totals; nome do time/h2h em outros
  price: z.number(), // odd no formato configurado (decimal por padrão aqui)
  point: z.number().optional(), // 2.5 para totals; ausente em h2h
  description: z.string().optional(),
});

export const MarketSchema = z.object({
  key: z.string(), // "totals" | "h2h" | "spreads" | ...
  last_update: z.string(), // ISO timestamp
  outcomes: z.array(OutcomeSchema),
});

export const BookmakerSchema = z.object({
  key: z.string(), // ex.: "betfair_ex_eu", "pinnacle", "betano"
  title: z.string(),
  last_update: z.string(), // ISO
  markets: z.array(MarketSchema),
});

export const EventOddsSchema = z.object({
  id: z.string(),
  sport_key: z.string(),
  sport_title: z.string().optional(),
  commence_time: z.string(), // ISO 8601
  home_team: z.string(),
  away_team: z.string(),
  bookmakers: z.array(BookmakerSchema),
});

export type OddsApiOutcome = z.infer<typeof OutcomeSchema>;
export type OddsApiMarket = z.infer<typeof MarketSchema>;
export type OddsApiBookmaker = z.infer<typeof BookmakerSchema>;
export type OddsApiEventOdds = z.infer<typeof EventOddsSchema>;

export const SportOddsResponseSchema = z.array(EventOddsSchema);

// ─── /v4/sports/{sport}/events ───────────────────────────────────────────────
// Lista de eventos SEM odds — endpoint gratuito (0 créditos), sem regions/markets.
// Usado pra resolver o eventId de um match antes de um fetch *additional* por
// evento (btts), sem gastar quota. NÃO carrega `bookmakers` (por isso NÃO reusa
// EventOddsSchema, que os exige).
export const EventListItemSchema = z.object({
  id: z.string(),
  sport_key: z.string(),
  sport_title: z.string().optional(),
  commence_time: z.string(), // ISO 8601
  home_team: z.string(),
  away_team: z.string(),
});

export type OddsApiEventListItem = z.infer<typeof EventListItemSchema>;
export const EventsListResponseSchema = z.array(EventListItemSchema);
