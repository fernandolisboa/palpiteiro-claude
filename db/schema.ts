import type { AdapterAccountType } from "next-auth/adapters";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
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
  // Preferência pessoal de modelo (ADR 0013). `null` = sem preferência → cai no
  // default global. Text simples validado contra MODEL_REGISTRY na query layer
  // (espelha aiConfig.defaultModelId) — evita migration a cada mudança no
  // registry. O filtro de audiência (admin-only nunca roda pra usuário comum)
  // mora em predict, não aqui.
  preferredModelId: text(),
  // Colunas exigidas pelo adapter do Auth.js v5 (@auth/drizzle-adapter).
  // Aditivas e nullable — não afetam os FKs existentes.
  emailVerified: timestamp({ withTimezone: true, mode: "date" }),
  image: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Whitelist em DB (ADR 0009, emenda o 0007). O DrizzleAdapter só cria uma row em
// `users` no primeiro login, então `users.allowed` não cobre convidados que
// ainda NÃO logaram — `pending_invites` guarda esses e-mails autorizados. O
// e-mail é a PK (de-dup natural; sempre gravado trimmed+lowercased na query
// layer). `invitedByUserId` é set null no delete do inviter pro convite
// sobreviver; `note` é livre pra futura UI de convites (#52).
export const pendingInvites = pgTable("pending_invites", {
  email: text().primaryKey(),
  invitedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
  note: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// ─── Tabelas do adapter Auth.js v5 ───────────────────────────────────────────
// Criadas para satisfazer o contrato do DrizzleAdapter. Com session.strategy
// "jwt", `sessions`/`accounts` ficam inativas (prontas pra futuro OAuth /
// DB-sessions); `verification_tokens` é usada no fluxo de magic link.

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text().$type<AdapterAccountType>().notNull(),
    provider: text().notNull(),
    providerAccountId: text().notNull(),
    refresh_token: text(),
    access_token: text(),
    expires_at: integer(),
    token_type: text(),
    scope: text(),
    id_token: text(),
    session_state: text(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerAccountId] }),
  ],
);

export const sessions = pgTable("sessions", {
  sessionToken: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp({ withTimezone: true, mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text().notNull(),
    token: text().notNull(),
    expires: timestamp({ withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

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
    // Par de odds congelado no momento da análise (ADR 0012, decisões 3-4),
    // gravado pra TODA recomendação, inclusive pass — daí "AtPrediction", não
    // "AtRecommendation" (em pass não existe recomendação). Nullable: rows
    // históricas ficam null (sem backfill, decisão 5). Sem FK pra
    // match_odds_snapshots: o fallback do predict() (Odds API direta) não
    // persiste snapshot — cópia congelada, como oddAtRecommendation.
    overOddAtPrediction: numeric({ precision: 6, scale: 3 }),
    underOddAtPrediction: numeric({ precision: 6, scale: 3 }),
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

// Config global single-row (PK fixa em 1; a query layer faz upsert em id=1).
// `defaultModelId` é text simples (validado contra MODEL_REGISTRY na query
// layer, espelhando aiCalls.model / predictions.modelVersion) — evita uma
// migration toda vez que o registry de modelos muda.
export const aiConfig = pgTable("ai_config", {
  id: integer().primaryKey().default(1),
  defaultModelId: text().notNull(),
  // Parâmetros de geração calibráveis em /admin/settings (ADR 0008, emenda 2).
  // Defaults espelham lib/ai/generation-params.ts (GENERATION_PARAM_DEFAULTS);
  // consumo MODEL-AWARE no request-builder (maxTokens p/ todos, effort só
  // adaptive, temperature só temperature-mode). Validados na query layer.
  maxTokens: integer().notNull().default(16000),
  effort: text().notNull().default("high"),
  temperature: numeric({ precision: 3, scale: 2 }).notNull().default("0.30"),
  updatedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
