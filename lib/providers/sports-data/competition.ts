import type { SupportedLeague } from "@/lib/providers/sports-data/leagues";
import type { NormalizedFixture } from "@/lib/providers/sports-data/types";

// Forma recente por competição (#618). A forma vem de todas as competições do time;
// estes predicados separam o que entra nas linhas de forma (sem amistoso) e o que
// merece rótulo (jogo de outra competição). O descanso usa a lista crua: amistoso
// também cansa e conta como último jogo.

export type FixtureCompetition = NonNullable<NormalizedFixture["competition"]>;

export function isFriendly(f: NormalizedFixture): boolean {
  return f.competition?.friendly === true;
}

export function withoutFriendlies<T extends NormalizedFixture>(
  fixtures: readonly T[]
): T[] {
  return fixtures.filter((f) => !isFriendly(f));
}

// Competição do jogo quando NÃO é a liga analisada (nem amistoso). Sem o campo
// (cache antigo, football-data.org) → null: sem rótulo, como antes.
export function otherCompetition(
  f: NormalizedFixture,
  league: SupportedLeague
): FixtureCompetition | null {
  const c = f.competition;
  if (!c || c.friendly || c.league === league) return null;
  return c;
}
