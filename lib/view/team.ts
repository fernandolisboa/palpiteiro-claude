import { displayTeamName } from "@/lib/view/team-labels";
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

const SHORT_BY_CANONICAL: Record<string, string> = {
  "Botafogo FR": "BOT",
  "CA Mineiro": "CAM",
  "CA Paranaense": "CAP",
  "CR Flamengo": "FLA",
  "CR Vasco da Gama": "VAS",
  "Chapecoense AF": "CHA",
  "Clube do Remo": "REM",
  "Coritiba FBC": "CFC",
  "Cruzeiro EC": "CRU",
  "EC Bahia": "BAH",
  "EC Vitória": "VIT",
  "Fluminense FC": "FLU",
  "Grêmio FBPA": "GRE",
  "Mirassol FC": "MIR",
  "RB Bragantino": "BRA",
  "SC Corinthians Paulista": "COR",
  "SC Internacional": "INT",
  "SE Palmeiras": "PAL",
  "Santos FC": "SAN",
  "São Paulo FC": "SAO",

  "AFC Ajax": "AJA",
  "AS Monaco FC": "MON",
  "Arsenal FC": "ARS",
  "Atalanta BC": "ATA",
  "Athletic Club": "ATH",
  "Bayer 04 Leverkusen": "LEV",
  "Borussia Dortmund": "BVB",
  "Chelsea FC": "CHE",
  "Club Atlético de Madrid": "ATM",
  "Club Brugge KV": "BRU",
  "Eintracht Frankfurt": "EIN",
  "FC Barcelona": "BAR",
  "FC Bayern München": "BAY",
  "FC Internazionale Milano": "INT",
  "FC København": "KOP",
  "FK Bodø/Glimt": "BOD",
  "FK Kairat": "KAI",
  "Galatasaray SK": "GAL",
  "Juventus FC": "JUV",
  "Liverpool FC": "LIV",
  "Manchester City FC": "MCI",
  "Newcastle United FC": "NEW",
  "Olympique de Marseille": "MAR",
  "PAE Olympiakos SFP": "OLY",
  "PSV": "PSV",
  "Paphos FC": "PAP",
  "Paris Saint-Germain FC": "PSG",
  "Qarabağ Ağdam FK": "QAR",
  "Real Madrid CF": "RMA",
  "Royale Union Saint-Gilloise": "USG",
  "SK Slavia Praha": "SLA",
  "SSC Napoli": "NAP",
  "Sport Lisboa e Benfica": "BEN",
  "Sporting Clube de Portugal": "SCP",
  "Tottenham Hotspur FC": "TOT",
  "Villarreal CF": "VIL",
};

function hashHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

function deriveShort(name: string): string {
  const tokens = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[\s\-/]+/)
    .filter((t) => t.length > 0 && !/^(FC|CF|AC|SC|CR|CA|EC|FK|SE|KV|BC|RB|SSC|PAE|PFC|FBPA|FBC|SFP|AF|AFC|CLUBE|CLUB)$/.test(t));
  if (tokens.length === 0) {
    return name.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase();
  }
  if (tokens.length === 1) {
    return tokens[0].replace(/[^A-Z0-9]/g, "").slice(0, 3);
  }
  return tokens
    .map((t) => t.replace(/[^A-Z0-9]/g, "")[0])
    .filter(Boolean)
    .slice(0, 3)
    .join("");
}

export function teamToTeam(canonicalName: string, league: LeagueKey): Team {
  return {
    // Tradução display-only por liga (#340): só a Copa ('wc') vira PT-BR; o
    // canonical EN segue intocado em short/hue e em todo o matching downstream.
    name: displayTeamName(canonicalName, league),
    short: SHORT_BY_CANONICAL[canonicalName] ?? deriveShort(canonicalName),
    hue: HUE_BY_CANONICAL[canonicalName] ?? hashHue(canonicalName),
  };
}
