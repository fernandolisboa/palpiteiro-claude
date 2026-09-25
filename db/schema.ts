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
  "serie_a",
  "bundesliga",
  "ligue_1",
  "copa_libertadores",
  "copa_sudamericana",
  "premier_league",
  "la_liga",
]);

export const matchStatusEnum = pgEnum("match_status", [
  "scheduled",
  "live",
  "finished",
  "postponed",
  "cancelled",
]);

// Os enums legados `market` e `recommendation` foram removidos no contract da
// Fase 5 (#179): `market` (single-value "over_under_2_5") e `recommendation` (que
// carregava as keys das seleções) viraram colunas `text` mercado-agnósticas. A
// fonte de verdade é `markets`/`market_selections` (marketId/selectionId).

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

// `provider` migrou de pgEnum pra `text` validado-na-app (ADR 0027 / #231) — mesma
// convenção de `model`/`defaultModelId` (ver :62-64), pra um provider novo virar
// edição de registry sem ALTER TYPE. Validado por isAIProvider() no boundary de escrita.

export const aiCallStatusEnum = pgEnum("ai_call_status", [
  "ok",
  "invalid_output",
  "provider_error",
  "timeout",
  "tool_missing",
  "rate_limited",
  // #380 — uma síntese de palpite que PASSOU Zod + firewall mas cuja manchete
  // CONTRADIZ um fato pré-contado do #379 (validação de fidelidade). NÃO é erro de
  // provider/Zod/firewall: é uma row de AUDITORIA da chamada paga descartada por
  // divergência factual — o sinal de frequência que a kill-switch (enableFidelityValidation)
  // precisa pra decidir. Logada via persistAiCallError; NUNCA uma chamada nova de LLM.
  "fidelity_divergence",
]);

// Tipos de palpite de ENGAJAMENTO (ADR 0028). Enum controlado (não tabela de
// catálogo): um tipo é só um rótulo fechado sem atributos próprios — diferente de
// `markets`, que carrega settlement_rule_key/seleções (FK). `exact_score` é o
// ÚNICO settleable na v1 (liquida por placar de 90'); os demais são "fun-only"
// (settleable=false, NUNCA entram no cron — ADR 0028 §3). Tipo novo = ALTER TYPE
// ADD VALUE numa migration (raro). `settleable` mora na linha `palpites`, não aqui.
export const palpiteTypeEnum = pgEnum("palpite_type", [
  "exact_score",
  "red_card",
  "corners",
  // #354 — tipos goal-derived settleable (liquidam do placar de 90'/intervalo/
  // eventos, sem provider novo). Acrescentados ao FINAL (ordem do enum é cosmética;
  // append evita ruído no snapshot). O gate settleable mora em SETTLEABLE_PALPITE_TYPES.
  "margin",
  "clean_sheet",
  "first_half_score",
  "first_to_score",
  // #419 — cards (fun-only, v8): temperatura de cartões → linha FIXA de amarelos.
  // FORA de SETTLEABLE_PALPITE_TYPES → settleable=false; o #394 liquida (total>=line).
  "cards",
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
  // Self-provision aberto (ADR 0023 §35, #257): novo usuário entra ATIVO. O floor
  // do env (ALLOWED_EMAILS) segue sendo o admin permanente; `allowed=false` é
  // bloqueio explícito feito por admin. Rows antigas com `allowed=false` (default
  // anterior) continuam bloqueadas — desbloquear via UI admin ou re-entram pelo
  // env-floor. Migration 0024: ALTER COLUMN allowed SET DEFAULT true.
  allowed: boolean().notNull().default(true),
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
  // Aceite de maioridade (auto-declaração 18+) carimbado no PRIMEIRO login via
  // `events.createUser` em auth.ts (#282, ADR/ops 05). Nullable de propósito:
  // o gate é a UI do /signin (checkbox obrigatório que destrava os 3 métodos),
  // a row só nasce DEPOIS de passar por ela. Rows pré-existentes não passaram
  // pelo gate — ficam null, NÃO reescrever (ADD COLUMN nullable é metadata-only).
  // Não é controle de segurança/enforcement server-side: é o registro de
  // auditoria do consentimento.
  acceptedTermsAt: timestamp({ withTimezone: true, mode: "date" }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// ─── Tabelas do adapter Auth.js v5 ───────────────────────────────────────────
// Criadas para satisfazer o contrato do DrizzleAdapter. `accounts` é usada pelo
// OAuth Google (grava a row provider="google", linkada ao mesmo `users` via
// allowDangerousEmailAccountLinking — ADR 0023); `verification_tokens` é usada no
// fluxo de magic link. Com session.strategy "jwt", só `sessions` fica inativa
// (a sessão é o JWT, não uma row de DB).

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

// Credenciais WebAuthn/passkey (ADR 0023): tabela do DrizzleAdapter, usada pelo
// provider WebAuthn (login + registro) que vive SÓ no `auth.ts` (Node). As colunas
// casam EXATAMENTE o contrato do adapter (@auth/drizzle-adapter/lib/pg.{js,d.ts}):
// nomes camelCase no Drizzle → snake_case no DB via o `casing` global. Travas
// load-bearing: `userId` é uuid (não text) pra fechar o FK→users.id (uuid); o
// `.d.ts` aceita PgUUID em userId. `credentialID` é text (o adapter consulta por
// ele sozinho em getAuthenticator/updateAuthenticatorCounter, então o `.unique()`
// é load-bearing) E parte da PK composta [userId, credentialID]. Passkey é
// método OPCIONAL: Google primário, magic link fallback.
export const authenticators = pgTable(
  "authenticators",
  {
    credentialID: text().notNull().unique(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerAccountId: text().notNull(),
    credentialPublicKey: text().notNull(),
    counter: integer().notNull(),
    credentialDeviceType: text().notNull(),
    credentialBackedUp: boolean().notNull(),
    transports: text(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.credentialID] })],
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

// A tabela legada binária `match_odds_snapshots` foi removida no contract da Fase 5
// (#179): substituída por `selection_odds_snapshots` (N seleções), com o card/chip
// over/under ao vivo adaptando a captura de linha 2.5 de volta pra forma binária.

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
    provider: text().notNull().default("anthropic"),
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
    // Coluna LEGADA (text livre, ex-enum single-value "over_under_2_5"): mantida só
    // pro fallback histórico do dashboard (rows pré-backfill com marketId null).
    // predict() NÃO escreve mais (Fase 5); a fonte de verdade é
    // `marketId`/`selectionId`/`marketParams`. Virou text no contract (#179).
    market: text(),
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
    // = a key da seleção escolhida (ou "pass"). Coluna text mercado-agnóstica
    // (ex-enum `recommendation`, removido no contract #179) — alimenta o recToken
    // do dashboard. `selectionId` é a fonte normalizada do lado escolhido.
    recommendation: text().notNull(),
    confidencePct: numeric({ precision: 5, scale: 2 }).notNull(),
    rationale: text().notNull(),
    keyFactors: text().array().notNull(),
    minimumOdd: numeric({ precision: 6, scale: 3 }),
    oddAtRecommendation: numeric({ precision: 6, scale: 3 }),
    bookmaker: text(),
    impliedProbPct: numeric({ precision: 5, scale: 2 }),
    edgePct: numeric({ precision: 5, scale: 2 }),
    // O par binário congelado over/under_odd_at_prediction (ADR 0012) foi removido
    // no contract da Fase 5 (#179) — generalizado por `prediction_selection_odds`
    // (uma row de odd congelada por seleção, N-vias, inclusive em pass).
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
  // Fato do jogo coletado 1x por jogo (ADR 0016 D2). MVP:
  // { homeScore, awayScore, totalGoals } (camelCase — segue #161/#162; supersede a
  // ilustração snake_case da ADR 0016 D2; validado por Zod no boundary do settlement
  // na Fase 2 #166). homeScore/awayScore degradam a null em rows do histórico onde o
  // split de 90' não for confiável; totalGoals carrega o escalar settled (verbatim).
  // O escalar legado `total_goals` (coluna) foi REMOVIDO no contract da Fase 5 (#179)
  // — `resultData.totalGoals` é a fonte única agora.
  resultData: jsonb().$type<{
    homeScore: number | null;
    awayScore: number | null;
    totalGoals: number;
    // ADITIVO (#290, sem DDL — jsonb): artilheiros/assistentes de 90' +
    // eventsAvailable pra settlement de scorer/assist (independent_binary).
    // OPCIONAIS: rows partition existentes seguem byte-idênticas.
    scorers?: { playerId: number | null; canonicalName: string }[];
    assisters?: { playerId: number | null; canonicalName: string }[];
    eventsAvailable?: boolean;
  }>(),
  result: outcomeResultEnum().notNull(),
  profitUnits: numeric({ precision: 8, scale: 2 }).notNull(),
  overrideByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
  settledAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// ─── Palpites de engajamento (ADR 0028) ──────────────────────────────────────
// Domínio SEPARADO das recomendações de valor: palpite é uma PREDIÇÃO de
// engajamento (placar exato, cartão vermelho, escanteios…), NUNCA carrega
// edge/implied/stake/Yield (ADR 0028 §1 — contaminaria o motor de valor). Um
// `palpite_set` = um evento de geração por (match, user); imutável. As linhas
// individuais ficam em `palpites`. Liquidação só de `exact_score` (ADR 0028 §3).

// Um EVENTO de geração de palpites por (match, user). Espelha as FKs de
// `predictions` (matchId/userId notNull restrict) EXCETO `aiCallId`, que é
// NULLABLE: a auto-geração (#315) é fire-and-forget e pode falhar silenciosamente,
// então um set pode existir sem ai_call (`predictions.aiCallId` é notNull).
// `modelVersion`/`promptVersion` notNull = proveniência de cartucho (ADR 0017 +
// ADR 0028 §5); como aiCallId é nullable, ai_calls não pode ser a única casa da
// versão. Imutável: revisão = novo set (mesma disciplina de predictions).
// A MANCHETE do palpite-first (ADR 0030 / #353): veredito + confiança qualitativa +
// narrativa + mercados citados + proveniência (as predictions que a alimentaram).
// ZERO número de valor (edge/EV/stake/Yield) — firewall de apresentação. O placar
// provável NÃO mora aqui: vira a linha `palpites` exact_score settleable (o badge).
export type PalpiteHeadline = {
  verdict: string;
  confidence: "baixa" | "media" | "alta";
  narrative: string;
  citedMarkets: string[];
  sourcePredictionIds: string[];
  // ADR 0032 / #377 — fontes de notícia REAIS (título+URL) capturadas via web search
  // da Claude que alimentaram o palpite. CAPTURADAS, NUNCA inventadas (são tool output,
  // não prosa do LLM). Opcional: sets pré-#377 e o caso "sem notícia" não carregam.
  // jsonb é schema-less no DB → mudança SÓ de tipo TS, SEM migration/DDL.
  sources?: Array<{ title: string; url: string }>;
};

export const palpiteSets = pgTable(
  "palpite_sets",
  {
    id: uuid().primaryKey().defaultRandom(),
    matchId: uuid()
      .notNull()
      .references(() => matches.id, { onDelete: "restrict" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    aiCallId: uuid().references(() => aiCalls.id, { onDelete: "restrict" }),
    modelVersion: text().notNull(),
    promptVersion: text().notNull(),
    // ADITIVA NULLABLE (ADR 0030 §4): a manchete sintetizada. Null em sets antigos
    // (pré-#353, do gerador MIX). Auto-flui pra $inferSelect.
    headline: jsonb().$type<PalpiteHeadline>(),
    // ADR 0035 §7 (#383): gesto opt-in de compartilhar (LGPD). NULL = privado (default,
    // sem backfill); set = snapshot público resolvível em /p/[id]; clear = kill-switch.
    sharedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("palpite_sets_match_id_idx").on(t.matchId),
    index("palpite_sets_user_id_idx").on(t.userId),
    index("palpite_sets_created_at_idx").on(t.createdAt),
  ],
);

// Uma LINHA de palpite dentro de um set. `type` (enum controlado), `text` (a
// frase humana renderizada na UI), `params` jsonb OPCIONAL (forma estruturada,
// p.ex. {home, away} no exact_score; null em tipos sem params), `settleable`
// (bit: só exact_score=true na v1). NUNCA edge/stake/Yield (ADR 0028 §1).
// settleable=false NUNCA gera outcome nem entra no cron (ADR 0028 §3).
export const palpites = pgTable(
  "palpites",
  {
    id: uuid().primaryKey().defaultRandom(),
    palpiteSetId: uuid()
      .notNull()
      .references(() => palpiteSets.id, { onDelete: "cascade" }),
    type: palpiteTypeEnum().notNull(),
    text: text().notNull(),
    // OPCIONAL: forma estruturada do palpite. Union LARGA por tipo (#354):
    // exact_score/first_half_score → {home, away}; margin → {side, minMargin};
    // clean_sheet → {side}; first_to_score → {firstToScore}; cards → {line, scope}
    // (#419, fun-only — o #394 lê pra liquidar total de amarelos >= line). O `$type` é
    // só largo o bastante pros call-sites de ESCRITA — o read path NÃO confia nele: cada
    // regra de settlement faz `safeParse` do seu próprio schema (defense-in-depth, igual
    // ao exact_score). Validada por Zod no boundary de escrita (#315) e no compare de
    // settlement. Tipos fun-only podem deixar null.
    params: jsonb().$type<
      | { home: number; away: number } // exact_score, first_half_score
      | { side: "home" | "away"; minMargin: number } // margin
      | { side: "home" | "away" } // clean_sheet
      | { firstToScore: "home" | "away" | "none" } // first_to_score
      | { line: number; scope: "total" } // cards (#419, fun-only; #394 lê p/ liquidar total>=line)
    >(),
    // Só exact_score=true na v1. O cron de placar filtra por (type='exact_score'
    // AND settleable=true) — defense-in-depth contra um seed errado.
    settleable: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("palpites_palpite_set_id_idx").on(t.palpiteSetId),
    // Suporta o pending-set do cron (WHERE type='exact_score' AND settleable).
    index("palpites_type_idx").on(t.type),
  ],
);

// Forma ESTREITA do resultData de palpite — NOMEADA (não a ResultData rica de
// prediction_outcomes). Só {homeScore, awayScore, totalGoals}; SEM
// scorers?/assisters?/eventsAvailable? (que ficariam inertes e ambíguos). É
// produzida internamente por resultDataFromRegulationScore (já validada por Zod
// upstream), não por output de LLM — sem validador Zod no read path.
export type PalpiteResultData = {
  homeScore: number | null;
  awayScore: number | null;
  totalGoals: number;
  // #354: split do 1º tempo (first_half_score). undefined em rows antigas e quando
  // o provider não entrega halftime → a regra deixa PENDING (prefer-skip).
  halftimeHomeScore?: number | null;
  halftimeAwayScore?: number | null;
  // #354: quem marcou 1º por eventos de regulação (first_to_score). undefined quando
  // eventsAvailable !== true → a regra deixa PENDING. "none" = 0 gols de regulação.
  firstToScore?: "home" | "away" | "none";
  eventsAvailable?: boolean;
  // #394: total de cartões AMARELOS do jogo (ambos os times), via extração web-grounded
  // (NÃO goal-derived — setado pelo ORQUESTRADOR settle-palpites.ts no caminho A≡B
  // reconciliado, nunca pelo builder palpite-result-data.ts). undefined → a regra `cards`
  // deixa PENDING (prefer-skip). NOME ÚNICO em todo o caminho (schema/setter/rule/test);
  // um typo aqui leria undefined → PENDENTE eterno disfarçado de inerte. jsonb $type
  // only — sem coluna nova (mesma forma aditiva do firstToScore/#354).
  yellowCardsTotal?: number;
};

// Outcome de um palpite SETTLEABLE. Espelha `prediction_outcomes` MAS sem
// `profitUnits` (palpite não tem stake/profit — ADR 0028 §1) e referenciando
// `palpites.id`. `palpiteId` UNIQUE → 1:1 idempotente (mesmo contrato de
// `prediction_outcomes.predictionId`). `resultData` usa a forma estreita
// `PalpiteResultData`. `result` reusa `outcomeResultEnum` restrito a won/lost no
// app (void/push não se aplicam a placar — ADR 0028; ver PLAN §1.4).
export const palpiteOutcomes = pgTable("palpite_outcomes", {
  id: uuid().primaryKey().defaultRandom(),
  palpiteId: uuid()
    .notNull()
    .unique()
    .references(() => palpites.id, { onDelete: "cascade" }),
  resultData: jsonb().$type<PalpiteResultData>(),
  result: outcomeResultEnum().notNull(),
  overrideByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
  settledAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Sidecar de CONTAGEM DE TENTATIVAS de liquidação web-grounded (#394, ADR 0033 addendum).
// O cron de cartões é all-or-nothing + re-tentado pelo Vercel SEM transação; sem um
// limite cross-tick uma row que repete A≠B (ou conta nula) seria re-extraída pra sempre,
// queimando 2 web-searches por tick indefinidamente. PK = palpiteId (1:1, FK cascade) —
// o incremento dispara ANTES da chamada paga (settle-palpites.ts), e o fan-out só roda
// com `attempts < CAP`. KV foi REJEITADO: o TTL zera o contador silenciosamente → re-gasto.
// Esgotou o cap → a row fica PENDENTE até um override manual. `lastAttemptAt` é
// observabilidade (qual a última tentativa), nullable até o 1º incremento.
export const palpiteSettlementAttempts = pgTable("palpite_settlement_attempts", {
  palpiteId: uuid()
    .primaryKey()
    .references(() => palpites.id, { onDelete: "cascade" }),
  attempts: integer().notNull().default(0),
  lastAttemptAt: timestamp({ withTimezone: true }),
});

// ─── Aposta livre (ADR 0036) ─────────────────────────────────────────────────
// Registro de "apostas do usuário" em linguagem natural: slip (cabeçalho) → legs
// (pernas tipadas) → outcomes (liquidação). Espelha a FORMA de palpite_sets/
// palpites/palpite_outcomes, mas em tabelas PRÓPRIAS (partição ADR 0028: aposta do
// usuário é registro Análise — NUNCA polui as métricas/auditoria de palpite). A
// Fase 1 (#471, tracer) exercita SÓ exact_score (Caminho B / modelo de placar); os
// enums nascem COMPLETOS (Decisão 5) pra evitar ALTER TYPE nas fases seguintes.

// União COMPLETA da Decisão 2 (kinds de mercado + props de placar). Só exact_score
// é gradeado/liquidado no tracer; os demais entram no enum agora (ALTER TYPE ADD
// VALUE depois seria migration extra). `settleable` deriva do kind no código
// (deriveBetLegSettleable), NUNCA do LLM.
export const betLegKindEnum = pgEnum("bet_leg_kind", [
  "over_under",
  "match_result",
  "btts",
  "double_chance",
  "exact_score",
  "margin",
  "clean_sheet",
  "first_half_score",
  "first_half_over_under",
  "first_to_score",
  "cards",
  "corners",
]);

// Fonte do número da perna (Decisão 3): cartridge = core cache-first do #412;
// scoreline_model = double-Poisson determinístico (lib/quant); none = sem número
// (cards/corners aceitas-não-gradeadas, ou grade que faltou). Rótulo "modelo
// simplificado" na UI/dado ⟺ scoreline_model.
export const gradeSourceEnum = pgEnum("grade_source", [
  "cartridge",
  "scoreline_model",
  "none",
]);

// Estado por-perna do grade (Decisões 5/10). O PAR (gradeSource, gradeStatus)
// determina a view: graded = número congelado; not_covered/no_data/rate_limited =
// sem número (gradeSource='none'); degraded_no_snapshot = número + EV normais, só
// edge='—' (Caminho A, Fase 2). No tracer só graded/no_data são alcançáveis.
export const gradeStatusEnum = pgEnum("grade_status", [
  "graded",
  "not_covered",
  "no_data",
  "rate_limited",
  "degraded_no_snapshot",
]);

// Params estruturais da perna, narrowed por Zod no boundary (reusa os schemas das
// regras de settlement — guard anti-drift Decisão 2b). $type largo o bastante pros
// call-sites de ESCRITA; o read path re-valida por kind (defense-in-depth). União da
// Decisão 2 (Fase 2). O `line` de qualquer total é k+0.5 (o boundary do parse veta
// linha inteira/quarto).
export type BetLegParams =
  | { home: number; away: number } // exact_score, first_half_score
  | { side: "home" | "away"; minMargin: number } // margin
  | { side: "home" | "away" } // clean_sheet
  | { firstToScore: "home" | "away" | "none" } // first_to_score
  | { selection: "over" | "under"; line: number } // over_under, first_half_over_under, cards, corners
  | { selection: "home" | "draw" | "away" } // match_result
  | { selection: "yes" | "no" } // btts
  | { selection: "home_draw" | "home_away" | "draw_away" }; // double_chance

// Cabeçalho da aposta do usuário. rawInput (NL cru, capado ~280 chars) e
// parseAiCallId são NULLABLE (slip editor-only não tem parse). comboUserOdd/
// jointProbPct entram já na migration da Fase 1 (consumidas na Fase 3: nullable e
// baratas, evitam churn). FKs restrict pra users/matches (espelha palpite_sets).
export const betSlips = pgTable(
  "bet_slips",
  {
    id: uuid().primaryKey().defaultRandom(),
    matchId: uuid()
      .notNull()
      .references(() => matches.id, { onDelete: "restrict" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    rawInput: text(),
    parseAiCallId: uuid().references(() => aiCalls.id, { onDelete: "set null" }),
    comboUserOdd: numeric({ precision: 6, scale: 3 }),
    jointProbPct: numeric({ precision: 5, scale: 2 }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // (userId, createdAt) serve o histórico "Minhas apostas" (ORDER BY createdAt
    // desc — postgres varre pra trás). E o (matchId) pro read pós-confirm.
    index("bet_slips_user_id_created_at_idx").on(t.userId, t.createdAt),
    index("bet_slips_match_id_idx").on(t.matchId),
  ],
);

// Uma perna tipada dentro de um slip. params jsonb narrowed por Zod; userOdd/
// modelProbPct CONGELADOS no confirm (Number()'dos na fronteira de view, nunca
// recomputados). gradeSource/gradeStatus = o par de estado. settleable derivado DO
// KIND. pinnedPredictionId = perna gradeada por cartucho (Caminho A, Fase 2); null
// no tracer (exact_score é sempre Caminho B).
export const betLegs = pgTable(
  "bet_legs",
  {
    id: uuid().primaryKey().defaultRandom(),
    slipId: uuid()
      .notNull()
      .references(() => betSlips.id, { onDelete: "cascade" }),
    kind: betLegKindEnum().notNull(),
    params: jsonb().$type<BetLegParams>().notNull(),
    userOdd: numeric({ precision: 6, scale: 3 }),
    modelProbPct: numeric({ precision: 5, scale: 2 }),
    gradeSource: gradeSourceEnum().notNull(),
    gradeStatus: gradeStatusEnum().notNull(),
    pinnedPredictionId: uuid().references(() => predictions.id, {
      onDelete: "set null",
    }),
    settleable: boolean().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bet_legs_slip_id_idx").on(t.slipId)],
);

// Outcome de uma perna SETTLEABLE — espelho FIEL de palpite_outcomes: won/lost via
// outcomeResultEnum (void/push não se aplicam — linha garantida k+0.5, placar é
// binário), legId UNIQUE → 1:1 idempotente, overrideByUserId pro override manual
// que o CLAUDE.md exige. resultData usa a MESMA forma estreita PalpiteResultData.
export const betLegOutcomes = pgTable("bet_leg_outcomes", {
  id: uuid().primaryKey().defaultRandom(),
  legId: uuid()
    .notNull()
    .unique()
    .references(() => betLegs.id, { onDelete: "cascade" }),
  result: outcomeResultEnum().notNull(),
  resultData: jsonb().$type<PalpiteResultData>(),
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
    // Dedup inclui marketParams (#175): over/under multi-linha grava 1.5/2.5/3.5 da
    // MESMA seleção no MESMO captured_at/bookmaker — sem a linha na chave, as três
    // colidiriam e só uma sobreviveria. `nullsNotDistinct` preserva o dedup de btts/
    // dupla chance (marketParams NULL): NULL = NULL → dedup; {line:X} ≠ {line:Y} → coexistem.
    unique("selection_odds_snapshots_dedup_key")
      .on(
        t.matchId,
        t.marketId,
        t.selectionId,
        t.capturedAt,
        t.bookmaker,
        t.marketParams,
      )
      .nullsNotDistinct(),
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
  // Feature-flag (#175): liga as linhas EXTRAS de over/under (1.5/3.5 via o cartucho
  // multi-linha over_under_v3.0 / alternate_totals). Default OFF = caminho de hoje
  // (featured 2.5, byte-idêntico). Flip data-driven (sem deploy): true → todos os
  // usuários recebem a análise multi-linha onde há cobertura (world_cup).
  enableOverUnderExtraLines: boolean().notNull().default(false),
  // Feature-flag (#178): liga o modo "melhor aposta do jogo" — o fan-out cross-mercado
  // EM CÓDIGO (N análises por jogo, uma por mercado candidato, ranqueadas por edge).
  // Default OFF = só o analyze single-market de hoje. Flip data-driven (sem deploy):
  // true → a CTA "Analisar todos os mercados" aparece pra TODOS os usuários onde há
  // ≥2 mercados candidatos. Reversível (SET ... = false). Independente do flag acima.
  enableBestBetFanOut: boolean().notNull().default(false),
  // Feature-flag (#180): liga a CAPTURA da closing line (snapshot pré-kickoff que
  // alimenta o CLV — companheira do Yield). Default OFF = zero gasto de quota; a
  // EXIBIÇÃO do CLV no dashboard/detail é sempre on (mostra null até haver dado).
  // Flip data-driven (sem deploy): true → o cron /api/cron/capture-closing-odds
  // passa a capturar odds perto do KO SÓ pra jogos com predição non-pass. Sem toggle
  // de UI (consistente com as flags acima — DB-flip only). Reversível (SET = false).
  enableClvCapture: boolean().notNull().default(false),
  // Feature-flag (#380): liga a VALIDAÇÃO DE FIDELIDADE pós-síntese — um validador
  // DETERMINÍSTICO (regras, sem juiz LLM) que checa se contagens citadas na manchete
  // (confrontos H2H / gols marcados-sofridos) CONTRADIZEM os fatos pré-contados do #379.
  // Default ON (kill-switch dormente, padrão sem-gates do dono): em divergência o palpite
  // DEGRADA (palpite:null) em vez de embarcar uma manchete factualmente errada. Flip
  // data-driven (SET ... = false, sem deploy): validação pulada → comportamento de hoje,
  // ZERO custo extra. Custo quando ON: validação limpa (caso comum) = ZERO (regex +
  // compare de inteiros, sem LLM); divergência com MAX_FIDELITY_ATTEMPTS=1 = degrada sem
  // pagar 2ª síntese (custo-neutro). Reversível.
  enableFidelityValidation: boolean().notNull().default(true),
  // Kill-switch (#503, ADR 0039 D3): staking quarter-Kelly no lugar das bandas do ADR
  // 0019. Default ON (padrão sem-gates do dono) mas DORMENTE: o predict só usa Kelly
  // quando o gate do Kelly (/admin/calibration — CLV ≥ 50 apostas com IC > 0 + guarda
  // de skill) está "pronto". Até lá, bandas. SET ... = false → bandas sempre.
  enableKellyStaking: boolean().notNull().default(true),
  updatedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Ligas ATIVAS (ADR 0050, #508): uma row por liga ligada/desligada no /admin/leagues.
// Fonte de verdade do que o sync de fixtures itera, o prewarm de odds aquece e a home
// lista — sem deploy. Liga sem row = desligada. Ler SEMPRE via
// lib/db/queries/league-settings.ts (tem fallback em código se a tabela vier vazia).
export const leagueSettings = pgTable("league_settings", {
  league: leagueEnum().primaryKey(),
  active: boolean().notNull().default(false),
  updatedByUserId: uuid().references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// Último saldo mensal visto de um provider com cota (#509): hoje só a The Odds API
// (headers x-requests-used / x-requests-remaining). Gravado no fim do prewarm de odds e
// da captura de closing line, SEM call extra; lido pelo /admin/leagues. Uma row por
// provider; só sobrescreve com leitura mais nova. Ler/escrever via
// lib/db/queries/provider-quota.ts.
export const providerQuota = pgTable("provider_quota", {
  provider: text().primaryKey(),
  monthlyUsed: integer(),
  monthlyRemaining: integer(),
  observedAt: timestamp({ withTimezone: true }).notNull(),
});
