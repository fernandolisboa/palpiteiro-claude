import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["admin", "user"]);

export const leagueEnum = pgEnum("league", [
  "brasileirao_a",
  "champions_league",
  "world_cup",
]);

export const matchStatusEnum = pgEnum("match_status", [
  "scheduled",
  "live",
  "finished",
  "postponed",
  "cancelled",
]);

export const marketEnum = pgEnum("market", ["over_under_2_5"]);

export const recommendationEnum = pgEnum("recommendation", [
  "over",
  "under",
  "pass",
]);

export const outcomeResultEnum = pgEnum("outcome_result", [
  "won",
  "lost",
  "void",
]);

export const aiProviderEnum = pgEnum("ai_provider", ["anthropic"]);

export const aiCallStatusEnum = pgEnum("ai_call_status", [
  "ok",
  "invalid_output",
  "provider_error",
  "timeout",
  "tool_missing",
  "rate_limited",
]);

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  name: text(),
  role: userRoleEnum().notNull().default("user"),
  allowed: boolean().notNull().default(false),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const matches = pgTable(
  "matches",
  {
    id: uuid().primaryKey().defaultRandom(),
    externalId: text().notNull().unique(),
    league: leagueEnum().notNull(),
    homeTeam: text().notNull(),
    awayTeam: text().notNull(),
    kickoffAt: timestamp({ withTimezone: true }).notNull(),
    status: matchStatusEnum().notNull().default("scheduled"),
    homeScore: integer(),
    awayScore: integer(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("matches_kickoff_at_idx").on(t.kickoffAt)],
);

export const matchOddsSnapshots = pgTable(
  "match_odds_snapshots",
  {
    id: uuid().primaryKey().defaultRandom(),
    matchId: uuid()
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    bookmaker: text().notNull(),
    market: marketEnum().notNull().default("over_under_2_5"),
    line: numeric({ precision: 4, scale: 2 }).notNull().default("2.5"),
    overOdd: numeric({ precision: 6, scale: 3 }).notNull(),
    underOdd: numeric({ precision: 6, scale: 3 }).notNull(),
    overroundPct: numeric({ precision: 5, scale: 2 }).notNull(),
    capturedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("match_odds_snapshots_match_id_idx").on(t.matchId)],
);

export const aiCalls = pgTable(
  "ai_calls",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    matchId: uuid()
      .notNull()
      .references(() => matches.id, { onDelete: "restrict" }),
    provider: aiProviderEnum().notNull().default("anthropic"),
    model: text().notNull(),
    promptVersion: text().notNull(),
    inputPayload: jsonb().notNull(),
    outputPayload: jsonb().notNull(),
    inputTokens: integer().notNull(),
    outputTokens: integer().notNull(),
    latencyMs: integer().notNull(),
    costUsd: numeric({ precision: 10, scale: 6 }).notNull(),
    status: aiCallStatusEnum().notNull().default("ok"),
    errorMessage: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_calls_created_at_idx").on(t.createdAt),
    index("ai_calls_user_id_idx").on(t.userId),
  ],
);

export const predictions = pgTable(
  "predictions",
  {
    id: uuid().primaryKey().defaultRandom(),
    matchId: uuid()
      .notNull()
      .references(() => matches.id, { onDelete: "restrict" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    aiCallId: uuid()
      .notNull()
      .references(() => aiCalls.id, { onDelete: "restrict" }),
    market: marketEnum().notNull().default("over_under_2_5"),
    recommendation: recommendationEnum().notNull(),
    confidencePct: numeric({ precision: 5, scale: 2 }).notNull(),
    rationale: text().notNull(),
    keyFactors: text().array().notNull(),
    minimumOdd: numeric({ precision: 6, scale: 3 }),
    oddAtRecommendation: numeric({ precision: 6, scale: 3 }),
    bookmaker: text(),
    impliedProbPct: numeric({ precision: 5, scale: 2 }),
    edgePct: numeric({ precision: 5, scale: 2 }),
    stakeUnits: numeric({ precision: 6, scale: 2 }).notNull().default("1"),
    modelVersion: text().notNull(),
    promptVersion: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("predictions_match_id_idx").on(t.matchId),
    index("predictions_user_id_idx").on(t.userId),
    index("predictions_created_at_idx").on(t.createdAt),
  ],
);

export const predictionOutcomes = pgTable("prediction_outcomes", {
  id: uuid().primaryKey().defaultRandom(),
  predictionId: uuid()
    .notNull()
    .unique()
    .references(() => predictions.id, { onDelete: "cascade" }),
  totalGoals: integer().notNull(),
  result: outcomeResultEnum().notNull(),
  profitUnits: numeric({ precision: 8, scale: 2 }).notNull(),
  overrideByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
  settledAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
