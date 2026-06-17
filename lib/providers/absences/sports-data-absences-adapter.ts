import { getSportsDataProvider } from "@/lib/providers/sports-data";
import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type {
  FixtureRef,
  NormalizedInjury,
  ProviderCapabilities,
  SportsDataProvider,
} from "@/lib/providers/sports-data/types";

import type { AbsencesProvider } from "./types";

// Adapta a SportsDataProvider EXISTENTE (cascata api-football→football-data, que já
// marca source:"official" no #226) como AbsencesProvider PRIMÁRIO — reuso TOTAL da
// lógica de injuries, ZERO duplicação. É o que mantém o #227 zero-behavior-change:
// sem o SportMonks, o cascade de absences = só este wrapper = caminho de hoje.
//
// Resolve o SportsDataProvider de forma LAZY (por chamada), não no construtor — pra
// respeitar `__setSportsDataProviderForTesting`. Unit tests injetam um `resolve` fake.
export class SportsDataAbsencesAdapter implements AbsencesProvider {
  constructor(
    private readonly resolve: () => SportsDataProvider = getSportsDataProvider,
  ) {}

  get capabilities(): ProviderCapabilities {
    return this.resolve().capabilities;
  }

  getAbsencesByFixture(
    ref: FixtureRef,
  ): Promise<{ home: NormalizedInjury[]; away: NormalizedInjury[] }> {
    return this.resolve().getInjuriesByFixture(ref);
  }

  getAbsencesByTeam(
    team: string,
    league: SupportedLeague,
  ): Promise<NormalizedInjury[]> {
    return this.resolve().getInjuriesByTeam(team, league);
  }
}
