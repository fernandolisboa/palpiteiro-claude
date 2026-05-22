import { FormSection } from "@/components/form-section";
import { H2HSection } from "@/components/h2h-section";
import { MatchCollapsible } from "@/components/match-collapsible";
import { StandingsSection } from "@/components/standings-section";
import { LEAGUE_LABEL } from "@/lib/format";
import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type {
  FixtureRef,
  NormalizedFixture,
  NormalizedH2H,
  NormalizedStanding,
} from "@/lib/providers/sports-data/types";
import { toFormView, toH2HView, toStandingsView } from "@/lib/view/sections";
import type { LeagueKey } from "@/lib/view/types";

const FORM_LAST = 5;
const H2H_LAST = 5;

type Props = {
  fixtureRef: FixtureRef;
  leagueKey: LeagueKey;
};

async function safeFixtures(
  fn: () => Promise<NormalizedFixture[]>,
): Promise<NormalizedFixture[]> {
  try {
    return await fn();
  } catch (err) {
    logSectionError(err);
    return [];
  }
}

async function safeH2H(
  fn: () => Promise<NormalizedH2H[]>,
): Promise<NormalizedH2H[]> {
  try {
    return await fn();
  } catch (err) {
    logSectionError(err);
    return [];
  }
}

async function safeStandings(
  fn: () => Promise<NormalizedStanding | undefined>,
): Promise<NormalizedStanding | undefined> {
  try {
    return await fn();
  } catch (err) {
    logSectionError(err);
    return undefined;
  }
}

function logSectionError(err: unknown) {
  console.error(
    JSON.stringify({
      scope: "match-sections",
      error: "section_fetch_failed",
      message: err instanceof Error ? err.message : String(err),
    }),
  );
}

export async function MatchSections({ fixtureRef, leagueKey }: Props) {
  const provider = getSportsDataProvider();

  // Promise.all em 4 fetches; cada um isolado em catch pra que falha parcial
  // (ex.: time ausente no map de IDs) degrade a seção, não derrube a boundary.
  const [homeForm, awayForm, h2h, standing] = await Promise.all([
    safeFixtures(() =>
      provider.getTeamForm(fixtureRef.homeTeam, fixtureRef.league, FORM_LAST),
    ),
    safeFixtures(() =>
      provider.getTeamForm(fixtureRef.awayTeam, fixtureRef.league, FORM_LAST),
    ),
    safeH2H(() =>
      provider.getH2H(
        fixtureRef.homeTeam,
        fixtureRef.awayTeam,
        fixtureRef.league,
        H2H_LAST,
      ),
    ),
    safeStandings(() => provider.getStandings(fixtureRef.league)),
  ]);

  const formView = toFormView({
    homeTeam: fixtureRef.homeTeam,
    awayTeam: fixtureRef.awayTeam,
    homeForm,
    awayForm,
    limit: FORM_LAST,
  });
  const h2hView = toH2HView(h2h, H2H_LAST);
  const standingsView = toStandingsView({
    standing,
    homeTeam: fixtureRef.homeTeam,
    awayTeam: fixtureRef.awayTeam,
  });

  return (
    <>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <MatchCollapsible title="Forma recente" meta="últimos 5" defaultOpen>
          <FormSection view={formView} />
        </MatchCollapsible>
        <MatchCollapsible
          title="Confrontos diretos (H2H)"
          meta={`${h2hView.rows.length || "0"} jogos`}
          defaultOpen
        >
          <H2HSection view={h2hView} />
        </MatchCollapsible>
      </div>
      <div className="pt-3">
        <MatchCollapsible
          title={`Classificação · ${LEAGUE_LABEL[leagueKey]}`}
          meta={standingsView.round}
          defaultOpen
        >
          <StandingsSection view={standingsView} />
        </MatchCollapsible>
      </div>
    </>
  );
}
