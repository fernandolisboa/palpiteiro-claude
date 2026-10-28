import {
  and,
  asc,
  desc,
  eq,
  exists,
  gte,
  inArray,
  lt,
  lte,
  notExists,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { matches, predictions } from "@/db/schema";
import { db } from "@/lib/db";
import { IN_PROGRESS_WINDOW_MS } from "@/lib/view/date-range";
import { compositeFixtureKey } from "@/lib/providers/sports-data/types";
import { isNeutralFinalFixture } from "@/lib/providers/sports-data/neutral-venue";
import type {
  NormalizedFixture,
  NormalizedFixtureStatus,
} from "@/lib/providers/sports-data/types";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

export type DbMatch = typeof matches.$inferSelect;

const STATUS_MAP: Record<NormalizedFixtureStatus, DbMatch["status"]> = {
  scheduled: "scheduled",
  live: "live",
  finished: "finished",
  postponed: "postponed",
  cancelled: "cancelled",
  other: "scheduled",
};

/**
 * Termo da busca da lista de jogos (#643), já resolvido em TS
 * (lib/view/match-search.ts): `text` casa pelo time (nomes CANÔNICOS) ou pela
 * competição; os de data comparam o kickoff no fuso do usuário (`day` =
 * "2026-10-25", `dayMonth` = "25/10" de qualquer ano, `weekday` ISO 1–7).
 */
export type MatchSearchTerm =
  | { kind: "text"; teams: readonly string[]; leagues: readonly SupportedLeague[] }
  | { kind: "day"; day: string }
  | { kind: "dayMonth"; dayMonth: string }
  | { kind: "weekday"; isoDow: number };

/** Um time no catálogo do período (escolha por escudo e casamento da busca, #643). */
export type TeamCatalogEntry = {
  name: string;
  league: SupportedLeague;
  crestUrl: string | null;
};

type RangeWhere = {
  from: Date | null; // null = unbounded past
  to: Date | null; // null = unbounded future
  league?: SupportedLeague;
  // Conjunto de ligas (ex.: aba "Todos" = ligas ativas). Vazio/ausente = sem filtro,
  // mesma convenção de `statuses`. Compõe com `league` via AND.
  leagues?: readonly SupportedLeague[];
  statuses?: DbMatch["status"][]; // default: all statuses (no status filter)
};

// Condições do range, soltas: quem chama junta no próprio and() (um nível só).
function rangeConditions(opts: RangeWhere): (SQL | undefined)[] {
  return [
    opts.from ? gte(matches.kickoffAt, opts.from) : undefined,
    opts.to ? lte(matches.kickoffAt, opts.to) : undefined,
    opts.league ? eq(matches.league, opts.league) : undefined,
    opts.leagues && opts.leagues.length
      ? inArray(matches.league, [...opts.leagues])
      : undefined,
    opts.statuses && opts.statuses.length
      ? inArray(matches.status, opts.statuses)
      : undefined,
  ];
}

// Jogo em que um dos dois times está na lista.
function eitherTeamIn(teams: readonly string[]): SQL | undefined {
  if (teams.length === 0) return undefined;
  return or(
    inArray(matches.homeTeam, [...teams]),
    inArray(matches.awayTeam, [...teams]),
  );
}

// Um termo da busca em SQL. `timeZone` já validado (resolveTimeZone) e sempre como
// parâmetro, nunca interpolado no texto da query.
function searchTermWhere(term: MatchSearchTerm, timeZone: string): SQL {
  const localKickoff = sql`(${matches.kickoffAt} AT TIME ZONE ${timeZone})`;
  switch (term.kind) {
    case "text":
      // Termo que não casou nada: nenhum jogo (OR vazio seria "sem filtro").
      return (
        or(
          eitherTeamIn(term.teams),
          term.leagues.length ? inArray(matches.league, [...term.leagues]) : undefined,
        ) ?? sql`false`
      );
    case "day":
      return sql`to_char(${localKickoff}, 'YYYY-MM-DD') = ${term.day}`;
    case "dayMonth":
      return sql`to_char(${localKickoff}, 'DD/MM') = ${term.dayMonth}`;
    case "weekday":
      return sql`extract(isodow from ${localKickoff}) = ${term.isoDow}`;
  }
}

/**
 * Range query flexível sobre `matches`. `from`/`to` null = lado ilimitado.
 * Predicado todo-undefined (sem filtros) retorna TODAS as rows — drizzle dropa
 * operandos undefined dentro de `and(...)`, então não vira `WHERE false`.
 *
 * Filtros da lista de jogos (#643), todos opcionais e em AND com o range:
 * `teams` (um dos dois times na lista; o escudo escolhido), `search` (cada termo
 * precisa casar; datas no `timeZone`) e `analyzedBy` (o usuário tem, ou não tem,
 * predição do jogo, o mesmo critério do selo "analisado").
 */
export async function getMatchesInRange(
  opts: RangeWhere & {
    teams?: readonly string[];
    search?: readonly MatchSearchTerm[];
    timeZone?: string;
    analyzedBy?: { userId: string; analyzed: boolean };
    order?: "asc" | "desc"; // default: "asc"
    limit?: number; // safety cap for unbounded ranges
  },
): Promise<DbMatch[]> {
  const timeZone = opts.timeZone ?? "UTC";
  const predictedByUser = opts.analyzedBy
    ? db
        .select({ one: sql`1` })
        .from(predictions)
        .where(
          and(
            eq(predictions.matchId, matches.id),
            eq(predictions.userId, opts.analyzedBy.userId),
          ),
        )
    : undefined;
  const whereClause = and(
    ...rangeConditions(opts),
    opts.teams && opts.teams.length ? eitherTeamIn(opts.teams) : undefined,
    ...(opts.search ?? []).map((term) => searchTermWhere(term, timeZone)),
    predictedByUser
      ? opts.analyzedBy?.analyzed
        ? exists(predictedByUser)
        : notExists(predictedByUser)
      : undefined,
  );
  const ordered = db
    .select()
    .from(matches)
    .where(whereClause)
    .orderBy(
      opts.order === "desc" ? desc(matches.kickoffAt) : asc(matches.kickoffAt),
    );
  return opts.limit !== undefined ? ordered.limit(opts.limit) : ordered;
}

/**
 * Times com jogo no range (#643): o catálogo da escolha por escudo e do casamento de
 * time da busca. Um por (time, liga), com o escudo mais recente gravado. Ordem livre:
 * quem exibe ordena pelo nome de exibição.
 */
export async function getTeamsInRange(opts: RangeWhere): Promise<TeamCatalogEntry[]> {
  const where = and(...rangeConditions(opts));
  const side = (team: "home" | "away") => {
    const name = team === "home" ? matches.homeTeam : matches.awayTeam;
    const crest = team === "home" ? matches.homeTeamCrestUrl : matches.awayTeamCrestUrl;
    return db
      .select({
        name: sql<string>`${name}`,
        league: matches.league,
        crestUrl: sql<string | null>`max(${crest})`,
      })
      .from(matches)
      .where(where)
      .groupBy(name, matches.league);
  };
  const [home, away] = await Promise.all([
    side("home"),
    side("away"),
  ]);
  const byKey = new Map<string, TeamCatalogEntry>();
  for (const row of [...home, ...away]) {
    const key = `${row.league}|${row.name}`;
    const seen = byKey.get(key);
    if (!seen || (!seen.crestUrl && row.crestUrl)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

/**
 * Histórico de um time (#408): duas fatias ordenadas e capadas — NÃO um range
 * contíguo. O time é identificado pela string CANÔNICA (= `matches.homeTeam`/
 * `awayTeam`, mesma fonte que `t.team` da classificação); não há team-id/teams
 * table. PAST = jogos já apitados E encerrados (`status='finished'` — só esses têm
 * placar confiável), mais recentes primeiro; FUTURE = `kickoff >= now` E ainda
 * `scheduled`/`live`, mais próximos primeiro. GAP CONSCIENTE: um jogo `live` já
 * apitado (kickoff no passado, ainda não `finished`) cai FORA das duas fatias até o
 * cron settlar pra `finished` — PAST exige placar confiável, FUTURE exige kickoff
 * futuro. Bounded (reaparece ao encerrar); o destaque "ao vivo" do /jogos
 * (windowedQueryFrom, #385) é outra superfície. `now` é capturado uma vez pra as
 * duas fatias particionarem contra o mesmo instante.
 */
export async function getMatchesByTeam(
  team: string,
  opts: {
    league?: SupportedLeague;
    pastLimit?: number;
    futureLimit?: number;
  } = {},
): Promise<{ past: DbMatch[]; future: DbMatch[] }> {
  const now = new Date();
  // Filtro de time: o canonical aparece como mandante OU visitante. Mesma string
  // dos dois lados (canonicalizeOrPassthrough na ingestão), então `or(eq,eq)` casa.
  const teamFilter = or(eq(matches.homeTeam, team), eq(matches.awayTeam, team));
  const leagueFilter = opts.league
    ? eq(matches.league, opts.league)
    : undefined;

  const past = db
    .select()
    .from(matches)
    .where(
      and(
        teamFilter,
        leagueFilter,
        lt(matches.kickoffAt, now),
        eq(matches.status, "finished"),
      ),
    )
    .orderBy(desc(matches.kickoffAt))
    .limit(opts.pastLimit ?? 5);

  const future = db
    .select()
    .from(matches)
    .where(
      and(
        teamFilter,
        leagueFilter,
        gte(matches.kickoffAt, now),
        inArray(matches.status, ["scheduled", "live"]),
      ),
    )
    .orderBy(asc(matches.kickoffAt))
    .limit(opts.futureLimit ?? 10);

  const [pastRows, futureRows] = await Promise.all([past, future]);
  return { past: pastRows, future: futureRows };
}

/**
 * Próximos jogos numa janela à frente. O bound INFERIOR recua IN_PROGRESS_WINDOW_MS
 * (não `now`) pela MESMA razão que `windowedQueryFrom` recua o /jogos (#385/#418):
 * um jogo que JÁ apitou fica DB-`scheduled` stale até o cron de fixtures (6h) virá-lo
 * pra `live`/`finished`; com `from: now`, o `gte(kickoffAt, now)` o dropava ANTES do
 * filtro de status, sumindo o jogo recém-apitado. Recuar o bound + manter `live` no
 * filtro admite essa cauda de ~3h. Lê a MESMA constante da badge/`isInProgress` (nunca
 * um `3h` inline) pra pertinência-na-lista ⟺ elegibilidade-da-badge não dessincronizarem
 * — a derivação de `isInProgress` em si é DOWNSTREAM (view layer, sobre o DbMatch[] que
 * este helper retorna), então consumidores conseguem derivá-la de forma consistente.
 */
export async function getUpcomingMatches(opts: {
  windowHours?: number;
  league?: SupportedLeague;
} = {}): Promise<DbMatch[]> {
  const windowHours = opts.windowHours ?? 48;
  const now = new Date();
  const horizon = new Date(now.getTime() + windowHours * 60 * 60 * 1000);
  return getMatchesInRange({
    from: new Date(now.getTime() - IN_PROGRESS_WINDOW_MS),
    to: horizon,
    league: opts.league,
    statuses: ["scheduled", "live"],
  });
}

export async function getMatchById(id: string): Promise<DbMatch | null> {
  const rows = await db
    .select()
    .from(matches)
    .where(eq(matches.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getMatchesByIds(ids: string[]): Promise<DbMatch[]> {
  if (ids.length === 0) return [];
  return db.select().from(matches).where(inArray(matches.id, ids));
}

export async function getMatchesInLeagueWindow(args: {
  league: SupportedLeague;
  fromMs?: number;
  windowHours?: number;
}): Promise<DbMatch[]> {
  const from = new Date(args.fromMs ?? Date.now());
  const horizon = new Date(
    from.getTime() + (args.windowHours ?? 7 * 24) * 60 * 60 * 1000,
  );
  return db
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.league, args.league),
        gte(matches.kickoffAt, from),
        lte(matches.kickoffAt, horizon),
      ),
    )
    .orderBy(asc(matches.kickoffAt));
}

/**
 * Upsert de fixtures normalizadas vindas do SportsDataProvider. Usa o
 * compositeFixtureKey como external_id (chave estável e agnóstica de provider).
 * Não toca em odds — odds são responsabilidade de lib/odds/fetch-and-snapshot.
 */
export async function upsertMatchesFromProvider(
  fixtures: NormalizedFixture[],
): Promise<void> {
  if (fixtures.length === 0) return;
  const rows = fixtures.map((f) => ({
    externalId: compositeFixtureKey({
      league: f.league,
      kickoffAt: f.kickoffAt,
      homeTeam: f.homeTeam,
      awayTeam: f.awayTeam,
    }),
    league: f.league,
    homeTeam: f.homeTeam,
    awayTeam: f.awayTeam,
    kickoffAt: new Date(f.kickoffTimestampMs),
    status: STATUS_MAP[f.status],
    homeScore: f.score.home,
    awayScore: f.score.away,
    neutralVenue: isNeutralFinalFixture(f),
    homeTeamCrestUrl: f.homeCrestUrl ?? null,
    awayTeamCrestUrl: f.awayCrestUrl ?? null,
    updatedAt: new Date(),
  }));
  await db
    .insert(matches)
    .values(rows)
    .onConflictDoUpdate({
      target: matches.externalId,
      set: {
        league: sql`excluded.league`,
        homeTeam: sql`excluded.home_team`,
        awayTeam: sql`excluded.away_team`,
        kickoffAt: sql`excluded.kickoff_at`,
        status: sql`excluded.status`,
        homeScore: sql`excluded.home_score`,
        awayScore: sql`excluded.away_score`,
        neutralVenue: sql`excluded.neutral_venue`,
        // Escudo (#578): nunca apaga o que já existe quando o provider da vez não
        // mandou (fallback sem crest, cache antigo). Sem `excluded.` = linha existente.
        homeTeamCrestUrl: sql`coalesce(excluded.home_team_crest_url, ${matches.homeTeamCrestUrl})`,
        awayTeamCrestUrl: sql`coalesce(excluded.away_team_crest_url, ${matches.awayTeamCrestUrl})`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

/**
 * Rows das ligas a partir de `since` (kickoff), pro casamento de jogo remarcado
 * (lib/sync/rescheduled-fixtures.ts). Todas as fases: a chave de uma row encerrada
 * também ocupa o lugar.
 */
export async function getReschedulableMatches(args: {
  leagues: readonly SupportedLeague[];
  since: Date;
}): Promise<
  Pick<
    DbMatch,
    "id" | "externalId" | "league" | "homeTeam" | "awayTeam" | "kickoffAt" | "status"
  >[]
> {
  if (args.leagues.length === 0) return [];
  return db
    .select({
      id: matches.id,
      externalId: matches.externalId,
      league: matches.league,
      homeTeam: matches.homeTeam,
      awayTeam: matches.awayTeam,
      kickoffAt: matches.kickoffAt,
      status: matches.status,
    })
    .from(matches)
    .where(
      and(
        inArray(matches.league, [...args.leagues]),
        gte(matches.kickoffAt, args.since),
      ),
    );
}

/** Jogo remarcado: a row segue sendo o mesmo jogo, com a chave e o horário novos. */
export async function rekeyMatch(args: {
  id: string;
  externalId: string;
  kickoffAt: Date;
}): Promise<void> {
  await db
    .update(matches)
    .set({
      externalId: args.externalId,
      kickoffAt: args.kickoffAt,
      updatedAt: new Date(),
    })
    .where(eq(matches.id, args.id));
}

/**
 * Cópia velha de um jogo remarcado cuja row nova já existe: `postponed` (fora do "ao
 * vivo", sem análise). Só mexe em row ainda aberta.
 */
export async function markMatchesSuperseded(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(matches)
    .set({ status: "postponed", updatedAt: new Date() })
    .where(
      and(
        inArray(matches.id, [...ids]),
        inArray(matches.status, ["scheduled", "live"]),
      ),
    );
}

export async function getMatchIdsWithPredictionsByUser(args: {
  matchIds: string[];
  userId: string;
}): Promise<Set<string>> {
  if (args.matchIds.length === 0) return new Set();
  const { predictions } = await import("@/db/schema");
  const rows = await db
    .selectDistinct({ matchId: predictions.matchId })
    .from(predictions)
    .where(
      and(
        inArray(predictions.matchId, args.matchIds),
        eq(predictions.userId, args.userId),
      ),
    );
  return new Set(rows.map((r) => r.matchId));
}

export type { NormalizedFixture };

// Re-export desc/asc for callers that want to compose further (test seam).
export { desc, asc };
