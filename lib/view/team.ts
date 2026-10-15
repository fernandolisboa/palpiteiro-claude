import { flagCodeForTeam } from "@/lib/view/country-codes";
import {
  alternateCode,
  displayTeamName,
  hasCuratedCode,
  officialTeamName,
  teamCode,
} from "@/lib/view/team-labels";
import type { LeagueKey, Team } from "@/lib/view/types";

const HUE_BY_CANONICAL: Record<string, number> = {
  // Brasileirão — seed dos hues que apareciam em lib/fixtures.ts do preview #33.
  "Botafogo FR": 0,
  "CA Mineiro": 0,
  "CA Paranaense": 0,
  "CR Flamengo": 25,
  "CR Vasco da Gama": 0,
  "Chapecoense AF": 145,
  "Clube do Remo": 280,
  "Coritiba FBC": 145,
  "Cruzeiro EC": 240,
  "EC Bahia": 240,
  "EC Vitória": 25,
  "Fluminense FC": 350,
  "Grêmio FBPA": 220,
  "Mirassol FC": 60,
  "RB Bragantino": 0,
  "SC Corinthians Paulista": 0,
  "SC Internacional": 25,
  "SE Palmeiras": 145,
  "Santos FC": 0,
  "São Paulo FC": 0,

  // Champions
  "AFC Ajax": 0,
  "AS Monaco FC": 0,
  "Arsenal FC": 0,
  "Atalanta BC": 220,
  "Athletic Club": 0,
  "Bayer 04 Leverkusen": 0,
  "Borussia Dortmund": 50,
  "Chelsea FC": 220,
  "Club Atlético de Madrid": 0,
  "Club Brugge KV": 30,
  "Eintracht Frankfurt": 0,
  "FC Barcelona": 240,
  "FC Bayern München": 25,
  "FC Internazionale Milano": 220,
  "FC København": 220,
  "FK Bodø/Glimt": 50,
  "FK Kairat": 50,
  "Galatasaray SK": 25,
  "Juventus FC": 0,
  "Liverpool FC": 0,
  "Manchester City FC": 200,
  "Newcastle United FC": 0,
  "Olympique de Marseille": 200,
  "PAE Olympiakos SFP": 0,
  "PSV": 25,
  "Paphos FC": 0,
  "Paris Saint-Germain FC": 230,
  "Qarabağ Ağdam FK": 0,
  "Real Madrid CF": 240,
  "Royale Union Saint-Gilloise": 0,
  "SK Slavia Praha": 0,
  "SSC Napoli": 200,
  "Sport Lisboa e Benfica": 0,
  "Sporting Clube de Portugal": 145,
  "Tottenham Hotspur FC": 240,
  "Villarreal CF": 50,
};

function hashHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

export function teamToTeam(
  canonicalName: string,
  league: LeagueKey,
  crestUrl?: string | null,
): Team {
  const flagCode = flagCodeForTeam(canonicalName, league);
  return {
    // Nome curto de exibição (#578; Copa em PT-BR, #340) e nome oficial pro
    // `title`. O canonical segue intocado em short/hue e em todo o matching
    // downstream: isto é só a borda de view.
    name: displayTeamName(canonicalName, league),
    fullName: officialTeamName(canonicalName, league),
    // Sigla de 3 letras (curada ou derivada), igual em qualquer liga.
    short: teamCode(canonicalName),
    hue: HUE_BY_CANONICAL[canonicalName] ?? hashHue(canonicalName),
    // Bandeira só na Copa (#341); undefined em clubes → avatar cai nas iniciais.
    flagCode,
    // Escudo do provider (#578), só fora da Copa: a bandeira tem prioridade.
    ...(crestUrl && !flagCode ? { crestUrl } : {}),
  };
}

/**
 * Os dois times de um jogo, com siglas distintas (#578). Use onde as siglas
 * aparecem lado a lado (chip de odds, linha do modelo, tabela, recentes, OG).
 * Se empatarem, troca a do lado DERIVADO (fora do mapa curado); se os dois forem
 * do mesmo tipo, a do visitante. A sigla curada nunca muda.
 */
export function teamPair(
  homeCanonical: string,
  awayCanonical: string,
  league: LeagueKey,
  crests?: { home?: string | null; away?: string | null },
): { home: Team; away: Team } {
  const home = teamToTeam(homeCanonical, league, crests?.home);
  const away = teamToTeam(awayCanonical, league, crests?.away);
  if (home.short !== away.short) return { home, away };
  const homeCurated = hasCuratedCode(homeCanonical);
  const awayCurated = hasCuratedCode(awayCanonical);
  if (homeCurated === awayCurated || homeCurated) {
    return { home, away: { ...away, short: alternateCode(awayCanonical, home.short) } };
  }
  return { home: { ...home, short: alternateCode(homeCanonical, away.short) }, away };
}

/**
 * Nomes curtos de exibição dos dois times de um jogo (#578), para telas que só
 * mostram o nome (sem sigla): "Palmeiras × Corinthians". Display-only.
 */
export function displayMatchTeams(
  homeCanonical: string,
  awayCanonical: string,
  league: LeagueKey,
): { home: string; away: string } {
  return {
    home: displayTeamName(homeCanonical, league),
    away: displayTeamName(awayCanonical, league),
  };
}
