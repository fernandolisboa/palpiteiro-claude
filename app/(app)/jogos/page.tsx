import Link from "next/link";
import { redirect } from "next/navigation";
import { Inbox } from "lucide-react";

import { Card } from "@/components/ui/card";
import { FilterScrollRow } from "@/components/filter-scroll-row";
import { LeaguePicker } from "@/components/league-picker";
import { RecentPredCard } from "@/components/recent-pred-card";
import { SectionLabel } from "@/components/section-label";
import { UpcomingMatchesDesktop } from "@/components/upcoming-matches-desktop";
import { UpcomingMatchesMobile } from "@/components/upcoming-matches-mobile";
import { auth } from "@/auth";
import { resolveHomeLeagueFilter } from "@/lib/config/active-leagues";
import { keyToLeague, leagueToKey } from "@/lib/format";
import { getActiveLeaguesForRequest } from "@/lib/db/queries/league-settings";
import { getRequestTimeZone } from "@/lib/server/request-timezone";
import { getMatchIdsWithPredictionsByUser } from "@/lib/db/queries/matches";
import { getLatestMatchModelSnapshotsForMatches } from "@/lib/db/queries/match-model-snapshots";
import { loadRangeMatches } from "@/lib/db/queries/load-range-matches";
import type { MatchModelSnapshot } from "@/lib/model-base/types";
import { loadListInPlayStates } from "@/lib/live/list-states";
import {
  getLatestOverUnderSnapshotsForMatches,
  getLatestSelectionOddsSnapshotsForMatches,
} from "@/lib/db/queries/odds-snapshots";
import { getRecentPredictedMatchesByUser } from "@/lib/db/queries/predictions";
import { DateRangeTabs } from "@/components/date-range-tabs";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { GuidedTour } from "@/components/tour/guided-tour";
import { getTourState } from "@/lib/db/queries/users";
import { TOUR_FORCE_PARAM } from "@/lib/tour/steps";
import {
  parseRangeParams,
  windowedQueryFrom,
  type ResolvedRange,
} from "@/lib/view/date-range";
import {
  buildLeagueHref,
  rangeEmptyMessage,
  rangeLabel,
} from "@/lib/view/range-href";
import { toMatchListRowView } from "@/lib/view/match";
import { toRecentMatchViews } from "@/lib/view/recent-prediction";
import type {
  LeagueFilter,
  LeagueKey,
  MatchListRowView,
  RecentMatchView,
} from "@/lib/view/types";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";

// Render dinâmico explícito: a rota lê o cookie de fuso (#1) por-request via
// getRequestTimeZone(); auth() já a tornava dinâmica, mas o explícito blinda a
// correção de fuso de um eventual passe estático (PPR/Cache Components futuros).
export const dynamic = "force-dynamic";

// "Suas predições recentes": os últimos 5 jogos analisados, um cartão por jogo
// (ADR 0058).
const RECENT_MATCH_LIMIT = 5;

// Teto da lista padrão (de agora em diante, sem data final): "Carregar mais" revela
// 15 por vez no cliente, e as duas listas (celular e desktop) vão no payload, então
// 100 cobre semanas de jogo sem pesar a página. Pra ir além, Escolher datas.
const UPCOMING_LIMIT = 100;
// Teto de um intervalo escolhido (pode ser longo, inclusive no passado).
const RANGE_LIMIT = 200;

type PageProps = {
  searchParams: Promise<{
    league?: string;
    preset?: string;
    from?: string;
    to?: string;
    // "rever o tour" (/como-usar) — força o tour guiado mesmo já concluído/pulado.
    [TOUR_FORCE_PARAM]?: string;
  }>;
};

// "Todos" = só as ligas ATIVAS (nunca o histórico de uma liga inativa, ex.: a
// Copa encerrada aparecendo num intervalo de Escolher datas).
function filterToLeagues(
  filter: LeagueFilter,
  activeLeagues: readonly SupportedLeague[],
): readonly SupportedLeague[] {
  return filter === "all" ? activeLeagues : [keyToLeague(filter)];
}

export default async function JogosPage({ searchParams }: PageProps) {
  const {
    league: leagueParam,
    preset: presetParam,
    from: fromParam,
    to: toParam,
    [TOUR_FORCE_PARAM]: tourParam,
  } = await searchParams;
  // Ligas ativas por request (league_settings, ADR 0050 — toggle no admin vale sem
  // deploy; nunca vazia, cai no fallback em código) e sessão em paralelo: as duas
  // são idas ao banco independentes. A ordem dos redirects abaixo não muda.
  const [activeLeagues, session] = await Promise.all([
    getActiveLeaguesForRequest(),
    auth(),
  ]);
  const activeKeys = activeLeagues.map(leagueToKey);
  // Liga inativa (ex.: `?league=wc` bookmarkado da Copa) → redirect pra home limpa,
  // que resolve pro default (sempre ativo → sem loop). Aponta pra /jogos (a home
  // authed), nunca pra `/` (landing pública).
  const league = resolveHomeLeagueFilter(leagueParam, activeKeys);
  if (league === null) redirect("/jogos");

  // Instante ÚNICO do request: alimenta o resolver de range (bound da query) E
  // todo toMatchListRowView (elegibilidade da badge). Dois `new Date()` separados
  // dessincronizariam pertinência-na-lista × badge na borda de 3h (race). Fuso de
  // exibição (#1) é separado — só formata strings, não decide instantes.
  const now = new Date();

  // Fuso de exibição do usuário (#1): formata kickoff/datas e define os dias civis
  // do intervalo `custom`, os mesmos dos títulos da lista agrupada por dia.
  const timeZone = await getRequestTimeZone();

  // Próximos jogos (default) ou o intervalo do Escolher datas. Nunca lança — input
  // inválido cai no default.
  const range = parseRangeParams(
    {
      preset: presetParam,
      from: fromParam,
      to: toParam,
    },
    now,
    timeZone,
  );

  // Middleware garante sessão; redirect defensivo caso o matcher mude.
  if (!session?.user?.id) redirect("/signin");
  const userId = session.user.id;

  const limit = range.preset === "upcoming" ? UPCOMING_LIMIT : RANGE_LIMIT;
  const matchesQuery = {
    // Bound inferior recuado em 3h só nas presets de janela (#385): admite os
    // jogos já apitados que matches.ts gte() de outra forma dropava ANTES do
    // filtro de status. Concern de query — range.from segue intocado.
    from: windowedQueryFrom(range),
    to: range.to,
    leagues: filterToLeagues(league, activeLeagues),
    statuses: range.statuses,
    order: range.order,
    limit,
  };

  // Predições recentes e estado do tour só dependem do usuário: correm junto da
  // query de jogos em vez de esperar por ela.
  const [dbMatches, recentRaw, tourState] = await Promise.all([
    loadRangeMatches(matchesQuery),
    getRecentPredictedMatchesByUser(userId, RECENT_MATCH_LIMIT),
    getTourState(userId),
  ]);

  const matchIds = dbMatches.map((m) => m.id);
  // Chip N-vias (#173): além do over/under legado (tabela velha), lê 1X2 da tabela
  // genérica (best-effort, batch). A home NÃO busca odds (só lê) → 1X2 só aparece
  // de visitas anteriores à match page que aqueceram a janela da liga (mesma
  // semântica latest-not-fresh do chip over/under). Ambos batch, sem N+1.
  // Base do modelo por jogo (#555): uma leitura batch, sem chamada externa. Opcional:
  // falha de leitura só tira a linha "Modelo" da lista, nunca derruba a página.
  // Placar ao vivo (#580): só as rows já gravadas, nunca o provider (lib/live/list-states).
  const [
    snapshotByMatch,
    matchResultByMatch,
    predictedMatchIds,
    modelByMatch,
    inPlayByMatch,
  ] =
    await Promise.all([
      getLatestOverUnderSnapshotsForMatches(matchIds),
      getLatestSelectionOddsSnapshotsForMatches(matchIds, "match_result"),
      getMatchIdsWithPredictionsByUser({
        matchIds,
        userId,
      }),
      getLatestMatchModelSnapshotsForMatches(matchIds).catch((err: unknown) => {
        console.error(
          JSON.stringify({
            scope: "jogos-page",
            error: "model_snapshots_read_failed",
            message: err instanceof Error ? err.message : String(err),
          }),
        );
        return new Map<string, MatchModelSnapshot>();
      }),
      loadListInPlayStates(dbMatches, now),
    ]);

  // Linha com o dia e a hora no fuso do usuário (#577): a lista agrupa por dia.
  const matches: MatchListRowView[] = dbMatches.map((m) => {
    const snapshot = snapshotByMatch.get(m.id);
    const matchResult = matchResultByMatch.get(m.id);
    return toMatchListRowView({
      match: {
        id: m.id,
        league: m.league,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        kickoffAt: m.kickoffAt,
        status: m.status,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        updatedAt: m.updatedAt,
        homeTeamCrestUrl: m.homeTeamCrestUrl,
        awayTeamCrestUrl: m.awayTeamCrestUrl,
      },
      odds: snapshot
        ? {
            bookmaker: snapshot.bookmaker,
            overOdd: snapshot.overOdd,
            underOdd: snapshot.underOdd,
            capturedAt: snapshot.capturedAt,
          }
        : null,
      // Prioridade resolvida no mapper: 1X2 quando há captura, senão over/under,
      // senão "sem odd" (ambos ausentes → odds null).
      matchResultOdds: matchResult ?? null,
      hasPrediction: predictedMatchIds.has(m.id),
      now,
      timeZone,
      modelSnapshot: modelByMatch.get(m.id) ?? null,
      inPlay: inPlayByMatch.get(m.id) ?? null,
    });
  });

  const recents: RecentMatchView[] = toRecentMatchViews(recentRaw, now, timeZone);
  const countLabel = matchCountLabel(matches.length, dbMatches.length >= limit);

  return (
    <>
      <GuidedTour
        chapter="jogos"
        userId={userId}
        serverState={tourState}
        forceStart={tourParam === "1"}
      />
      <div className="lg:hidden">
        <MobileHome
          matches={matches}
          recents={recents}
          league={league}
          activeKeys={activeKeys}
          range={range}
          countLabel={countLabel}
        />
      </div>
      <div className="hidden lg:block">
        <DesktopHome
          matches={matches}
          recents={recents}
          league={league}
          activeKeys={activeKeys}
          range={range}
          countLabel={countLabel}
        />
      </div>
    </>
  );
}

type HomeContentProps = {
  matches: MatchListRowView[];
  recents: RecentMatchView[];
  league: LeagueFilter;
  activeKeys: readonly LeagueKey[];
  range: ResolvedRange;
  countLabel: string;
};

// Props compartilhadas pra preservar o range ao trocar de liga no seletor.
function rangeNavProps(range: ResolvedRange) {
  // custom: os dias da URL. `from`/`to` são instantes no fuso do usuário e o
  // toISOString deles daria o dia UTC (ex.: 26/10 para o fim de 25/10 em BRT).
  if (range.days) {
    return { preset: range.preset, from: range.days.from, to: range.days.to };
  }
  const from = range.from
    ? range.from.toISOString().slice(0, 10)
    : undefined;
  const to = range.to ? range.to.toISOString().slice(0, 10) : undefined;
  return { preset: range.preset, from, to };
}

// "{n} jogos": a liga e o período ficam nos chips, não no meta (#577). No teto da
// query há mais jogos além dos carregados: "100+ jogos".
function matchCountLabel(n: number, capped: boolean): string {
  if (capped) return `${n}+ jogos`;
  return n === 1 ? "1 jogo" : `${n} jogos`;
}

// Linha única de filtros (#577): liga (select em chip) | Escolher datas. Rolável na horizontal quando não cabe, e rola sozinha
// até o chip selecionado (FilterScrollRow); os alvos do tour ficam dentro dela (o
// scrollIntoView do tour rola o contêiner até o alvo).
function FilterRow({
  league,
  activeKeys,
  range,
  surface,
  className,
}: {
  league: LeagueFilter;
  activeKeys: readonly LeagueKey[];
  range: ResolvedRange;
  surface: "sheet" | "popover";
  className?: string;
}) {
  const navProps = rangeNavProps(range);
  return (
    <FilterScrollRow
      activeKey={`${league}-${range.preset}-${navProps.from ?? ""}-${navProps.to ?? ""}`}
      className={className}
    >
      <div data-tour="league-picker" className="shrink-0">
        <LeaguePicker value={league} activeKeys={activeKeys} range={navProps} />
      </div>
      <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
      <div data-tour="date-range" className="shrink-0">
        <DateRangeTabs
          league={league}
          preset={range.preset}
          from={navProps.from}
          to={navProps.to}
          customLabel={range.preset === "custom" ? rangeLabel(range) : undefined}
          surface={surface}
        />
      </div>
    </FilterScrollRow>
  );
}

function MobileHome({
  matches,
  recents,
  league,
  activeKeys,
  range,
  countLabel,
}: HomeContentProps) {
  const empty = rangeEmptyMessage(range);
  const navProps = rangeNavProps(range);
  // URL filtrada atual da lista — propagada aos links de jogo pra preservar o
  // estado de busca (liga + date range) ao abrir um jogo e voltar.
  const listHref = buildLeagueHref(navProps, league);
  // Remonta a lista ao trocar de filtro (liga/range) pra resetar o reveal.
  const listKey = `${league}-${range.preset}-${navProps.from ?? ""}-${navProps.to ?? ""}`;
  return (
    <div className="overflow-x-clip bg-background text-foreground">
      <div className="px-5 pt-6">
        <PageHeader
          title="Próximos jogos"
          meta={countLabel}
          className="pb-4"
        />
      </div>

      <FilterRow
        league={league}
        activeKeys={activeKeys}
        range={range}
        surface="sheet"
        className="px-5 pb-3"
      />

      {matches.length === 0 ? (
        <Card className="mx-5">
          <EmptyState
            className="py-6"
            icon={<Inbox aria-hidden="true" className="size-10" strokeWidth={1.25} />}
            title={empty.title}
            description={empty.detail}
          />
        </Card>
      ) : (
        <UpcomingMatchesMobile key={listKey} matches={matches} listHref={listHref} />
      )}

      <div className="pt-7" />
      <div data-tour="recent-predictions">
        <SectionLabel
          action={
            <Link
              href="/dashboard"
              className="text-meta uppercase tracking-eyebrow text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-sm"
            >
              ver todas →
            </Link>
          }
        >
          Suas predições recentes
        </SectionLabel>
        <div className="overflow-x-auto px-5 pb-6">
          {recents.length === 0 ? (
            <div className="text-body-sm text-muted-foreground tracking-tight">
              Nenhuma predição ainda.
            </div>
          ) : (
            <div className="flex gap-2">
              {recents.map((p) => (
                <RecentPredCard key={p.matchId} p={p} listHref={listHref} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DesktopHome({
  matches,
  recents,
  league,
  activeKeys,
  range,
  countLabel,
}: HomeContentProps) {
  const empty = rangeEmptyMessage(range);
  const navProps = rangeNavProps(range);
  // URL filtrada atual da lista — propagada aos links de jogo (preserva busca ao voltar).
  const listHref = buildLeagueHref(navProps, league);
  // Remonta a grade ao trocar de filtro (liga/range) pra resetar o reveal.
  const listKey = `${league}-${range.preset}-${navProps.from ?? ""}-${navProps.to ?? ""}`;
  return (
    <>
      <PageContainer width="content">
        <PageHeader
          title="Próximos jogos"
          meta={countLabel}
          className="lg:pb-5"
        />
        {/* Os chips numa linha própria abaixo do título: a linha não cabe à direita. */}
        <FilterRow
          league={league}
          activeKeys={activeKeys}
          range={range}
          surface="popover"
          className="pb-5"
        />

        {matches.length === 0 ? (
          <Card className="px-8 py-16 text-center">
            <EmptyState
              className="py-6"
              icon={<Inbox aria-hidden="true" className="size-10" strokeWidth={1.25} />}
              title={empty.title}
              description={empty.detail}
            />
          </Card>
        ) : (
          <UpcomingMatchesDesktop key={listKey} matches={matches} listHref={listHref} />
        )}

        <div className="mt-12" data-tour="recent-predictions">
          <SectionLabel
            action={
              <Link
                href="/dashboard"
                className="text-meta uppercase tracking-eyebrow text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-sm"
              >
                ver todas →
              </Link>
            }
          >
            Suas predições recentes
          </SectionLabel>
          {recents.length === 0 ? (
            <div className="text-body-sm text-muted-foreground tracking-tight">
              Nenhuma predição ainda.
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-3">
              {recents.map((p) => (
                <RecentPredCard key={p.matchId} p={p} listHref={listHref} />
              ))}
            </div>
          )}
        </div>
      </PageContainer>
    </>
  );
}
