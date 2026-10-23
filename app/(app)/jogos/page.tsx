import type { Metadata } from "next";
import { IntentLink } from "@/components/intent-link";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { FilterScrollRow } from "@/components/filter-scroll-row";
import { buttonVariants } from "@/components/ui/button";
import { AnalyzedPicker } from "@/components/match-list/analyzed-picker";
import { MatchSearchInput } from "@/components/match-list/match-search-input";
import { TeamFilter } from "@/components/match-list/team-filter";
import { LeaguePicker } from "@/components/league-picker";
import { RecentPredCard } from "@/components/recent-pred-card";
import { RecentPredsEmpty } from "@/components/recent-preds-empty";
import { SectionLabel } from "@/components/section-label";
import { UpcomingMatchesDesktop } from "@/components/upcoming-matches-desktop";
import { UpcomingMatchesMobile } from "@/components/upcoming-matches-mobile";
import { auth } from "@/auth";
import { resolveHomeLeagueFilter } from "@/lib/config/active-leagues";
import { dayKeyOf, keyToLeague, leagueToKey } from "@/lib/format";
import { getActiveLeaguesForRequest } from "@/lib/db/queries/league-settings";
import { getRequestTimeZone } from "@/lib/server/request-timezone";
import {
  getMatchIdsWithPredictionsByUser,
  getTeamsInRange,
} from "@/lib/db/queries/matches";
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
  buildFiltersHref,
  buildLeagueHref,
  rangeEmptyMessage,
  rangeLabel,
  type RangeNavState,
} from "@/lib/view/range-href";
import {
  buildSearchTerms,
  filteredEmptyMessage,
  hasActiveFilters,
  parseListFilters,
  selectedTeamOption,
  teamOptionGroups,
  type ListFilters,
  type TeamOption,
  type TeamOptionGroup,
} from "@/lib/view/match-search";
import { toMatchListRowView } from "@/lib/view/match";
import { toRecentMatchViews } from "@/lib/view/recent-prediction";
import type {
  LeagueFilter,
  LeagueKey,
  MatchListRowView,
  RecentMatchView,
} from "@/lib/view/types";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import { RevisitRefresh } from "@/components/revisit-refresh";

// Render dinâmico explícito: a rota lê o cookie de fuso (#1) por-request via
// getRequestTimeZone(); auth() já a tornava dinâmica, mas o explícito blinda a
// correção de fuso de um eventual passe estático (PPR/Cache Components futuros).
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Jogos" };

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
    // Busca e filtros da lista (#643): texto, time (escudo) e analisados.
    q?: string;
    team?: string;
    analyzed?: string;
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
    q: qParam,
    team: teamParam,
    analyzed: analyzedParam,
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

  // Busca, time e analisados (#643). Nunca lança: valor inválido = sem filtro.
  const filters = parseListFilters({
    q: qParam,
    team: teamParam,
    analyzed: analyzedParam,
  });

  const limit = range.preset === "upcoming" ? UPCOMING_LIMIT : RANGE_LIMIT;
  const leagues = filterToLeagues(league, activeLeagues);
  const rangeWhere = {
    // Bound inferior recuado em 3h só na lista padrão (#385): admite os
    // jogos já apitados que matches.ts gte() de outra forma dropava ANTES do
    // filtro de status. Concern de query — range.from segue intocado.
    from: windowedQueryFrom(range),
    to: range.to,
    leagues,
    statuses: range.statuses,
  };
  // Times com jogo no período (sem a busca nem os outros filtros): a grade de
  // escudos e o casamento de time da busca. Com busca, a query de jogos espera por
  // ele; sem, corre junto.
  const catalogPromise = getTeamsInRange(rangeWhere);
  // Predições recentes e estado do tour só dependem do usuário: saem já, sem esperar
  // o catálogo nem a query de jogos.
  const recentPromise = getRecentPredictedMatchesByUser(userId, RECENT_MATCH_LIMIT);
  const tourPromise = getTourState(userId);
  // Podem falhar enquanto a busca espera o catálogo, antes do Promise.all abaixo: o
  // catch vazio só evita o aviso de rejeição sem handler (o Promise.all ainda lança).
  recentPromise.catch(() => {});
  tourPromise.catch(() => {});
  const search = filters.q
    ? buildSearchTerms({
        q: filters.q,
        catalog: await catalogPromise,
        leagues,
        todayKey: dayKeyOf(now, timeZone),
      })
    : undefined;
  const matchesQuery = {
    ...rangeWhere,
    teams: filters.team ? [filters.team] : undefined,
    search,
    timeZone,
    analyzedBy:
      filters.analyzed === "yes" || filters.analyzed === "no"
        ? { userId, analyzed: filters.analyzed === "yes" }
        : undefined,
    order: range.order,
    // Uma linha a mais só pra saber se a lista foi cortada no teto.
    limit: limit + 1,
  };

  const [queried, recentRaw, tourState, catalog] = await Promise.all([
    loadRangeMatches(matchesQuery),
    recentPromise,
    tourPromise,
    catalogPromise,
  ]);
  const truncated = queried.length > limit;
  const dbMatches = truncated ? queried.slice(0, limit) : queried;

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
  const teamGroups = teamOptionGroups(catalog, activeKeys);
  const selectedTeam = selectedTeamOption(
    catalog,
    filters.team,
    league === "all" ? activeKeys[0] : league,
  );
  const countLabel = matchCountLabel(matches.length, truncated);
  // Fim da lista cortada no teto: diz como ver o resto (o "Carregar mais" some ali).
  const endNote = !truncated
    ? undefined
    : range.preset === "upcoming"
      ? `Esses são os próximos ${limit} jogos. Pra ver além, use Escolher datas.`
      : `Esses são os primeiros ${limit} jogos do período. Pra ver o resto, escolha um intervalo menor.`;

  return (
    <>
      <RevisitRefresh />
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
          filters={filters}
          teamGroups={teamGroups}
          selectedTeam={selectedTeam}
          countLabel={countLabel}
          endNote={endNote}
        />
      </div>
      <div className="hidden lg:block">
        <DesktopHome
          matches={matches}
          recents={recents}
          league={league}
          activeKeys={activeKeys}
          range={range}
          filters={filters}
          teamGroups={teamGroups}
          selectedTeam={selectedTeam}
          countLabel={countLabel}
          endNote={endNote}
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
  filters: ListFilters;
  teamGroups: TeamOptionGroup[];
  selectedTeam?: TeamOption;
  countLabel: string;
  endNote?: string;
};

// Atalho do estado vazio das predições recentes (#446): o primeiro jogo da lista que
// ainda aceita análise (a lista pode abrir com jogos já em andamento).
function firstAnalyzableId(matches: MatchListRowView[]): string | null {
  return matches.find((m) => m.analyzable)?.id ?? null;
}

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

// Estado de navegação completo da lista: liga, período e busca/filtros (#643).
function navState(
  league: LeagueFilter,
  range: ResolvedRange,
  filters: ListFilters,
): RangeNavState {
  return { league, ...rangeNavProps(range), filters };
}

// Linha única de filtros (#577): liga (select em chip) | Escolher datas | Time |
// análise (#643). Rolável na horizontal quando não cabe, e rola sozinha
// até o chip selecionado (FilterScrollRow); os alvos do tour ficam dentro dela (o
// scrollIntoView do tour rola o contêiner até o alvo).
function FilterRow({
  league,
  activeKeys,
  range,
  filters,
  teamGroups,
  selectedTeam,
  surface,
  className,
}: {
  league: LeagueFilter;
  activeKeys: readonly LeagueKey[];
  range: ResolvedRange;
  filters: ListFilters;
  teamGroups: TeamOptionGroup[];
  selectedTeam?: TeamOption;
  surface: "sheet" | "popover";
  className?: string;
}) {
  const navProps = rangeNavProps(range);
  const nav = navState(league, range, filters);
  return (
    // Sem o texto da busca na chave: cada busca digitada não rola a linha de chips.
    <FilterScrollRow
      activeKey={buildFiltersHref(nav, { q: undefined })}
      className={className}
    >
      <div data-tour="league-picker" className="shrink-0">
        <LeaguePicker
          value={league}
          activeKeys={activeKeys}
          range={{ ...navProps, filters }}
        />
      </div>
      <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
      <div data-tour="date-range" className="shrink-0">
        <DateRangeTabs
          league={league}
          filters={filters}
          preset={range.preset}
          from={navProps.from}
          to={navProps.to}
          customLabel={range.preset === "custom" ? rangeLabel(range) : undefined}
          surface={surface}
        />
      </div>
      <TeamFilter
        nav={nav}
        groups={teamGroups}
        selected={selectedTeam}
        surface={surface}
      />
      <AnalyzedPicker nav={nav} />
    </FilterScrollRow>
  );
}

// Lista vazia: com busca/filtro ativo, diz o que foi buscado e oferece limpar só os
// filtros (liga e datas ficam); sem, a mensagem do período.
function EmptyMatches({
  nav,
  range,
  selectedTeam,
}: {
  nav: RangeNavState;
  range: ResolvedRange;
  selectedTeam?: TeamOption;
}) {
  const filters = nav.filters ?? {};
  if (!hasActiveFilters(filters)) {
    const empty = rangeEmptyMessage(range);
    return (
      <EmptyState className="py-6" mascot title={empty.title} description={empty.detail} />
    );
  }
  const empty = filteredEmptyMessage(filters, selectedTeam?.team.name);
  return (
    <EmptyState
      className="py-6"
      mascot
      title={empty.title}
      description={empty.detail}
      action={
        <IntentLink
          href={buildFiltersHref(nav, { q: undefined, team: undefined, analyzed: "all" })}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Limpar filtros
        </IntentLink>
      }
    />
  );
}

function MobileHome({
  matches,
  recents,
  league,
  activeKeys,
  range,
  filters,
  teamGroups,
  selectedTeam,
  countLabel,
  endNote,
}: HomeContentProps) {
  const nav = navState(league, range, filters);
  // URL filtrada atual da lista — propagada aos links de jogo pra preservar o
  // estado de busca (liga + date range + busca/filtros) ao abrir um jogo e voltar.
  // Também é a chave que remonta a lista ao trocar de filtro (reseta o reveal).
  const listHref = buildLeagueHref(nav, league);
  const nextMatchId = firstAnalyzableId(matches);
  return (
    <div className="overflow-x-clip bg-background text-foreground">
      <div className="px-5 pt-6">
        <PageHeader
          title="Próximos jogos"
          meta={countLabel}
          className="pb-4"
        />
      </div>

      <div data-tour="match-search" className="px-5 pb-2">
        <MatchSearchInput nav={nav} />
      </div>

      <FilterRow
        league={league}
        activeKeys={activeKeys}
        range={range}
        filters={filters}
        teamGroups={teamGroups}
        selectedTeam={selectedTeam}
        surface="sheet"
        className="px-5 pb-3"
      />

      {matches.length === 0 ? (
        <Card className="mx-5">
          <EmptyMatches nav={nav} range={range} selectedTeam={selectedTeam} />
        </Card>
      ) : (
        <UpcomingMatchesMobile
          key={listHref}
          matches={matches}
          listHref={listHref}
          endNote={endNote}
        />
      )}

      <div className="pt-7" />
      <div data-tour="recent-predictions">
        <SectionLabel
          action={
            <IntentLink
              href="/dashboard"
              className="text-meta uppercase tracking-eyebrow text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-sm"
            >
              ver todas →
            </IntentLink>
          }
        >
          Suas predições recentes
        </SectionLabel>
        <div className="overflow-x-auto px-5 pb-6">
          {recents.length === 0 ? (
            <RecentPredsEmpty nextMatchId={nextMatchId} listHref={listHref} />
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
  filters,
  teamGroups,
  selectedTeam,
  countLabel,
  endNote,
}: HomeContentProps) {
  const nav = navState(league, range, filters);
  // URL filtrada atual da lista — propagada aos links de jogo (preserva busca ao
  // voltar) e chave que remonta a grade ao trocar de filtro (reseta o reveal).
  const listHref = buildLeagueHref(nav, league);
  const nextMatchId = firstAnalyzableId(matches);
  return (
    <>
      <PageContainer width="content">
        <PageHeader
          title="Próximos jogos"
          meta={countLabel}
          className="lg:pb-5"
        />
        {/* Busca e chips numa linha própria abaixo do título: não cabem à direita. */}
        <div className="flex items-center gap-3 pb-5">
          <div data-tour="match-search" className="w-72 shrink-0">
            <MatchSearchInput nav={nav} />
          </div>
          <FilterRow
            league={league}
            activeKeys={activeKeys}
            range={range}
            filters={filters}
            teamGroups={teamGroups}
            selectedTeam={selectedTeam}
            surface="popover"
            className="min-w-0 flex-1"
          />
        </div>

        {matches.length === 0 ? (
          <Card className="px-8 py-16 text-center">
            <EmptyMatches nav={nav} range={range} selectedTeam={selectedTeam} />
          </Card>
        ) : (
          <UpcomingMatchesDesktop
            key={listHref}
            matches={matches}
            listHref={listHref}
            endNote={endNote}
          />
        )}

        <div className="mt-12" data-tour="recent-predictions">
          <SectionLabel
            action={
              <IntentLink
                href="/dashboard"
                className="text-meta uppercase tracking-eyebrow text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 rounded-sm"
              >
                ver todas →
              </IntentLink>
            }
          >
            Suas predições recentes
          </SectionLabel>
          {recents.length === 0 ? (
            <RecentPredsEmpty nextMatchId={nextMatchId} listHref={listHref} />
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
