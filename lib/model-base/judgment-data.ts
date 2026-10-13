import type { MatchJudgmentData } from "@/lib/ai/engine/judgment-input";
import { FORM_LAST } from "@/lib/ai/predict";
import type { DbMatch } from "@/lib/db/queries/matches";
import { getAbsencesProvider } from "@/lib/providers/absences";
import {
  SportsDataTransientError,
  SportsDataUnsupportedError,
  type FixtureRef,
  type NormalizedInjury,
  type NormalizedStanding,
  type SportsDataProvider,
} from "@/lib/providers/sports-data/types";

// Dados do state JEV pra base do modelo por jogo (#555). Espelha o passo 3 do predict
// (mesmo FORM_LAST, mesma degradação de desfalques Unsupported/Transient → listas
// vazias), pra o state e o stateHash saírem iguais nas duas pontas e o reuso funcionar
// nos dois sentidos. Forma ou escalação que falham → lança: o caller pula o JEV do
// jogo (um state "remendado" ficaria diferente do predict e o reuso erraria).
export async function fetchMatchJudgmentData(args: {
  match: DbMatch;
  provider: SportsDataProvider;
  standings: NormalizedStanding | undefined;
}): Promise<Omit<MatchJudgmentData, "previousLineups">> {
  const { match, provider } = args;
  const ref: FixtureRef = {
    league: match.league,
    kickoffAt: match.kickoffAt.toISOString(),
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
  };
  const [homeForm, awayForm, injuries, lineups] = await Promise.all([
    provider.getTeamForm(match.homeTeam, match.league, FORM_LAST),
    provider.getTeamForm(match.awayTeam, match.league, FORM_LAST),
    getAbsencesProvider()
      .getAbsencesByFixture(ref)
      .catch((err: unknown) => {
        if (
          err instanceof SportsDataUnsupportedError ||
          err instanceof SportsDataTransientError
        ) {
          return {
            home: [] as NormalizedInjury[],
            away: [] as NormalizedInjury[],
          };
        }
        throw err;
      }),
    provider.getLineups(ref),
  ]);
  return {
    league: match.league,
    kickoffAt: match.kickoffAt,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    injuries,
    lineups,
    homeForm,
    awayForm,
    standings: args.standings,
  };
}
