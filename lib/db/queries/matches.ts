import { and, asc, desc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";

import { matches } from "@/db/schema";
import { db } from "@/lib/db";
import { IN_PROGRESS_WINDOW_MS } from "@/lib/view/date-range";
import { compositeFixtureKey } from "@/lib/providers/sports-data/types";
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
 * Range query flexível sobre `matches`. `from`/`to` null = lado ilimitado.
 * Predicado todo-undefined (sem filtros) retorna TODAS as rows — drizzle dropa
 * operandos undefined dentro de `and(...)`, então não vira `WHERE false`.
 */
export async function getMatchesInRange(opts: {
  from: Date | null; // null = unbounded past
  to: Date | null; // null = unbounded future
  league?: SupportedLeague;
  // Conjunto de ligas (ex.: aba "Todos" = ligas ativas). Vazio/ausente = sem filtro,
  // mesma convenção de `statuses`. Compõe com `league` via AND.
  leagues?: readonly SupportedLeague[];
  statuses?: DbMatch["status"][]; // default: all statuses (no status filter)
  order?: "asc" | "desc"; // default: "asc"
  limit?: number; // safety cap for unbounded ranges
}): Promise<DbMatch[]> {
  const whereClause = and(
    opts.from ? gte(matches.kickoffAt, opts.from) : undefined,
    opts.to ? lte(matches.kickoffAt, opts.to) : undefined,
    opts.league ? eq(matches.league, opts.league) : undefined,
    opts.leagues && opts.leagues.length
      ? inArray(matches.league, [...opts.leagues])
      : undefined,
    opts.statuses && opts.statuses.length
      ? inArray(matches.status, opts.statuses)
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
        updatedAt: sql`excluded.updated_at`,
      },
    });
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
