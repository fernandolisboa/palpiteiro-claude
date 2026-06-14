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
  unique,
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
  // Seleções 1X2 (match_result) — adicionadas ao enum legado/expand no #173 (ADR
  // 0015 D3/D4). O enum permanece a coluna legada de `recommendation` (= a key da
  // seleção escolhida; "pass" continua no-bet). A fonte de verdade do mercado é
  // `markets`/`market_selections`; este enum só carrega as keys das seleções pra
  // a coluna legada compilar. Migration isolada (0013) por higiene (espelha 0011).
  "home",
  "draw",
  "away",
]);

export const outcomeResultEnum = pgEnum("outcome_result", [
  "won",
  "lost",
  "void",
  // push = aposta resolvida que devolve o stake (profit 0): seleção empata com a
  // linha (ADR 0016 D5). Adicionado PROATIVAMENTE ao domínio — os mercados do MVP
  // (linhas de meio-gol, seleções discretas) nunca dão push; nenhum caminho de
  // código EMITE ou torna push selecionável na Fase 1 (settlement plugável + UI =
  // Fase 2/3, #166/#171). Migration isolada (0011) por higiene (ver PR).
  "push",
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

// ─── Catálogo de mercados (ADR 0015, decisão 3) ──────────────────────────────
// Mercados e seleções como TABELAS DE REFERÊNCIA (seed + FK), não enums: leva ao
// limite a convenção do repo "text + validação na app" (defaultModelId/preferred)
// e evita um `ALTER TYPE ADD VALUE` a cada mercado novo. Na Fase 1 são puramente
// aditivas — `predictions`/snapshots começam a referenciar `market_id`/`selection_id`
// em #160/#161, e o enum `market` legado coexiste até o contract (Fase 5).
// `settlement_rule_key` resolve a regra pura do registry de settlement (ADR 0016);
// p/ over/under a string COMMITTED é `over_under` (a Fase 2 #166 resolve por ela).
// `is_active`/`is_graduated` são o feature-flag por mercado (D9) — nada lê na Fase 1;
// a graduação dos mercados novos é mantida pelo #171.
export const markets = pgTable("markets", {
  id: uuid().primaryKey().defaultRandom(),
  key: text().notNull().unique(),
  label: text().notNull(),
  settlementRuleKey: text().notNull(),
  isActive: boolean().notNull().default(false),
  isGraduated: boolean().notNull().default(false),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const marketSelections = pgTable(
  "market_selections",
  {
    id: uuid().primaryKey().defaultRandom(),
    marketId: uuid()
      .notNull()
      .references(() => markets.id, { onDelete: "cascade" }),
    key: text().notNull(),
    label: text().notNull(),
    sortOrder: integer().notNull().default(0),
  },
  (t) => [
    unique("market_selections_market_id_key_unique").on(t.marketId, t.key),
  ],
);

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
    // NULLABLE no expand multi-mercado (#173): mercados novos gravam `market=null`
    // (a fonte de verdade vira `marketId`/`selectionId`); só over/under continua
    // preenchendo o enum legado via legacy-write guard. Default removido pelo mesmo
    // motivo — uma row de mercado novo não deve herdar 'over_under_2_5'. O enum
    // `market` permanece single-value até o contract (Fase 5).
    market: marketEnum(),
    // Generalização multi-mercado do enum `market` legado (ADR 0015 D3/D4), todas
    // NULLABLE no expand — predict.ts só passa a preencher na Fase 2 (#165); o
    // histórico over/under é backfillado deterministicamente em #162. `selectionId`
    // é NULL em `pass` (não há seleção). `marketParams` carrega a forma do mercado
    // (ex.: { line: 2.5 }), validada por Zod no boundary quando surgir um reader.
    marketId: uuid().references(() => markets.id, { onDelete: "restrict" }),
    selectionId: uuid().references(() => marketSelections.id, {
      onDelete: "restrict",
    }),
    marketParams: jsonb().$type<{ line: number }>(),
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
    index("predictions_market_id_idx").on(t.marketId),
    index("predictions_selection_id_idx").on(t.selectionId),
  ],
);

// Odds CONGELADAS por seleção no momento da análise — a generalização N-vias do
// par binário over/under_odd_at_prediction (ADR 0012, decisões 3-4). Guarda o
// CANDIDATE SET: uma row por seleção do mercado avaliada na análise, congelada,
// INCLUSIVE em `pass` (mesma semântica do par legado) e INDEPENDENTE de
// predictions.selection_id (o lado escolhido, NULL em pass). NÃO é "a odd da
// aposta" — é o leque de odds visto na hora. O par legado permanece até o
// contract (Fase 5). predict.ts só grava na Fase 2 (#165); histórico em #162.
// UNIQUE(prediction_id, selection_id) ancora o upsert idempotente do backfill.
export const predictionSelectionOdds = pgTable(
  "prediction_selection_odds",
  {
    id: uuid().primaryKey().defaultRandom(),
    predictionId: uuid()
      .notNull()
      .references(() => predictions.id, { onDelete: "cascade" }),
    selectionId: uuid()
      .notNull()
      .references(() => marketSelections.id, { onDelete: "restrict" }),
    odd: numeric({ precision: 6, scale: 3 }).notNull(),
    // Probabilidade do MODELO (LLM) pra esta seleção, 0–100 (#173, decisão B).
    // Alimenta a grade N-vias (edge por seleção) ao reabrir uma predição passada.
    // NULLABLE: o backfill histórico (#162) e o over/under pré-#173 não a gravam;
    // só a Fase 4 (predict.ts) passa a preencher. Mesma precisão/escala das demais
    // colunas de percentual (impliedProbPct/edgePct/confidencePct).
    modelProbPct: numeric({ precision: 5, scale: 2 }),
  },
  (t) => [
    index("prediction_selection_odds_prediction_id_idx").on(t.predictionId),
    unique("prediction_selection_odds_prediction_id_selection_id_unique").on(
      t.predictionId,
      t.selectionId,
    ),
  ],
);

export const predictionOutcomes = pgTable("prediction_outcomes", {
  id: uuid().primaryKey().defaultRandom(),
  predictionId: uuid()
    .notNull()
    .unique()
    .references(() => predictions.id, { onDelete: "cascade" }),
  totalGoals: integer().notNull(),
  // Fato do jogo coletado 1x por jogo (ADR 0016 D2), NULLABLE no expand. MVP:
  // { homeScore, awayScore, totalGoals } (camelCase — segue #161/#162; supersede a
  // ilustração snake_case da ADR 0016 D2; validado por Zod no boundary do settlement
  // na Fase 2 #166). homeScore/awayScore degradam a null em rows do histórico onde o
  // split de 90' não for confiável; totalGoals carrega o escalar settled (verbatim).
  // O escalar legado total_goals permanece (vira derivado) até o contract (Fase 5).
  resultData: jsonb().$type<{
    homeScore: number | null;
    awayScore: number | null;
    totalGoals: number;
  }>(),
  result: outcomeResultEnum().notNull(),
  profitUnits: numeric({ precision: 8, scale: 2 }).notNull(),
  overrideByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
  settledAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Snapshots de odds AO VIVO por seleção — a generalização N-vias de
// match_odds_snapshots (par fixo over/under), que permanece até o contract (Fase 5).
// Uma row por (seleção, bookmaker, captura); overround_pct é do MERCADO COMPLETO.
// UNIQUE(match_id, market_id, selection_id, captured_at, bookmaker) ancora a
// idempotência do backfill (#162) E serve de índice de leitura "última por
// (match, market, selection)" (prefixo + backward scan no captured_at) — espelha o
// DISTINCT ON de lib/db/queries/odds-snapshots.ts. ensure/insert ao vivo entram na
// Fase 2 (#164); o backfill copia o histórico binário (1 snapshot → 2 rows) em #162.
export const selectionOddsSnapshots = pgTable(
  "selection_odds_snapshots",
  {
    id: uuid().primaryKey().defaultRandom(),
    matchId: uuid()
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    marketId: uuid()
      .notNull()
      .references(() => markets.id, { onDelete: "restrict" }),
    selectionId: uuid()
      .notNull()
      .references(() => marketSelections.id, { onDelete: "restrict" }),
    bookmaker: text().notNull(),
    marketParams: jsonb().$type<{ line: number }>(),
    odd: numeric({ precision: 6, scale: 3 }).notNull(),
    overroundPct: numeric({ precision: 5, scale: 2 }).notNull(),
    capturedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("selection_odds_snapshots_dedup_key").on(
      t.matchId,
      t.marketId,
      t.selectionId,
      t.capturedAt,
      t.bookmaker,
    ),
  ],
);

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
