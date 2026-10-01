import type { SupportedLeague } from "./leagues";

// Campo neutro (#529). A Copa do Mundo é neutra o torneio inteiro (sedes fixas,
// ninguém joga "em casa" no sentido do modelo). Nas copas de clube com final em
// jogo único (Libertadores e Sul-Americana desde 2019, Champions sempre) só a
// final é neutra: o resto do mata-mata é ida e volta no estádio de cada um.
// A detecção sai do dado do fixture (round da API-Football, stage do
// football-data.org), não de data fixa: vale pra toda edição sem manutenção.
const SINGLE_MATCH_FINAL_LEAGUES: ReadonlySet<SupportedLeague> =
  new Set<SupportedLeague>([
    "copa_libertadores",
    "copa_sudamericana",
    "champions_league",
  ]);

/**
 * O fixture é a final em jogo único de uma copa com sede neutra?
 *
 * `round` vem cru do provider: API-Football escreve "Final" (e "Semi-finals",
 * "Quarter-finals", "Round of 16"…); football-data.org escreve "FINAL" (e
 * "SEMI_FINALS"…). Só o rótulo exato "final" conta, pra semifinal não casar.
 */
export function isNeutralFinalFixture(fixture: {
  league: SupportedLeague;
  round?: string | null;
}): boolean {
  if (!SINGLE_MATCH_FINAL_LEAGUES.has(fixture.league)) return false;
  return fixture.round?.trim().toLowerCase() === "final";
}

/**
 * O jogo deve ser modelado sem vantagem de casa? Lê o `neutral_venue` gravado
 * no sync de fixtures; a Copa do Mundo é neutra por liga.
 */
export function isNeutralVenue(match: {
  league: SupportedLeague;
  neutralVenue: boolean;
}): boolean {
  return match.league === "world_cup" || match.neutralVenue === true;
}
