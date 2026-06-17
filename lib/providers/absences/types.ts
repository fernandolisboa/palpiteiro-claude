import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type {
  FixtureRef,
  NormalizedInjury,
  ProviderCapabilities,
} from "@/lib/providers/sports-data/types";

// Interface ESTREITA de desfalques (ADR 0026 D2, #227): só absences (lesões/
// suspensões), separada da SportsDataProvider gorda (9 métodos). predict.ts step 3
// orquestra a partir daqui. Reusa `ProviderCapabilities` (com `supportsAbsences`),
// `NormalizedInjury` e — de propósito (D4) — as MESMAS classes de erro de
// sports-data (`SportsDataTransientError`/`NotFoundError`/`UnsupportedError`): o
// contrato de cascata é idêntico e o predict.ts já as captura. Métodos com nomes
// agnósticos a "injury" pra acomodar fontes futuras.
export interface AbsencesProvider {
  readonly capabilities: ProviderCapabilities;
  getAbsencesByFixture(
    ref: FixtureRef,
  ): Promise<{ home: NormalizedInjury[]; away: NormalizedInjury[] }>;
  getAbsencesByTeam(
    team: string,
    league: SupportedLeague,
  ): Promise<NormalizedInjury[]>;
}
