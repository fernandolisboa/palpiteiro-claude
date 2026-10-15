import type { LeagueKey } from "@/lib/view/types";

// Nomes de EXIBIÇÃO dos times: nome curto, nome oficial e sigla de 3 letras.
//
// PRINCÍPIO INEGOCIÁVEL: o nome canonical ("SE Palmeiras", "Mexico") é CHAVE DE
// MATCHING em todo o sistema — odds, prompts de IA, H2H, settlement, DB, rota
// /time/[team]. Tudo aqui vive SÓ na borda de view e nunca altera o canonical.
// Nenhum módulo de lib/ai, lib/odds, lib/settlement, lib/providers, lib/sync etc.
// importa este arquivo (teste de fronteira em
// lib/view/__tests__/team-display-boundary.test.ts, #578).
//
// - Copa ('wc'): nome da seleção em PT-BR (#340); sigla = código FIFA.
// - Clubes: nome curto curado (como a TV chama o time, até 18 caracteres), com
//   derivação determinística para o time fora do mapa (clube de mata-mata da
//   Libertadores que passa direto com o nome da API-Football, promovido novo).
//
// Mapas cobrem CANONICAL_TEAMS; um teste garante completude, formato e siglas
// únicas dentro de cada liga.
const WC_TEAM_LABELS_PT: Record<string, string> = {
  Algeria: "Argélia",
  Argentina: "Argentina",
  Australia: "Austrália",
  Austria: "Áustria",
  Belgium: "Bélgica",
  "Bosnia & Herzegovina": "Bósnia e Herzegovina",
  Brazil: "Brasil",
  Canada: "Canadá",
  "Cape Verde Islands": "Cabo Verde",
  Colombia: "Colômbia",
  "Congo DR": "RD Congo",
  Croatia: "Croácia",
  Curaçao: "Curaçao",
  "Czech Republic": "República Tcheca",
  Ecuador: "Equador",
  Egypt: "Egito",
  England: "Inglaterra",
  France: "França",
  Germany: "Alemanha",
  Ghana: "Gana",
  Haiti: "Haiti",
  Iran: "Irã",
  Iraq: "Iraque",
  "Ivory Coast": "Costa do Marfim",
  Japan: "Japão",
  Jordan: "Jordânia",
  Mexico: "México",
  Morocco: "Marrocos",
  // "Holanda" (uso corrente no Brasil) em vez de "Países Baixos" — flip de 1 linha.
  Netherlands: "Holanda",
  "New Zealand": "Nova Zelândia",
  Norway: "Noruega",
  Panama: "Panamá",
  Paraguay: "Paraguai",
  Portugal: "Portugal",
  Qatar: "Catar",
  "Saudi Arabia": "Arábia Saudita",
  Scotland: "Escócia",
  Senegal: "Senegal",
  "South Africa": "África do Sul",
  "South Korea": "Coreia do Sul",
  Spain: "Espanha",
  Sweden: "Suécia",
  Switzerland: "Suíça",
  Tunisia: "Tunísia",
  Türkiye: "Turquia",
  USA: "Estados Unidos",
  Uruguay: "Uruguai",
  Uzbekistan: "Uzbequistão",
};

// Nome curto de clube (canonical → exibição). Copa fica no mapa acima.
const CLUB_SHORT_NAMES: Record<string, string> = {
  // Brasileirão
  "Botafogo FR": "Botafogo",
  "CA Mineiro": "Atlético-MG",
  "CA Paranaense": "Athletico-PR",
  "CR Flamengo": "Flamengo",
  "CR Vasco da Gama": "Vasco",
  "Chapecoense AF": "Chapecoense",
  "Clube do Remo": "Remo",
  "Coritiba FBC": "Coritiba",
  "Cruzeiro EC": "Cruzeiro",
  "EC Bahia": "Bahia",
  "EC Vitória": "Vitória",
  "Fluminense FC": "Fluminense",
  "Grêmio FBPA": "Grêmio",
  "Mirassol FC": "Mirassol",
  "RB Bragantino": "Bragantino",
  "SC Corinthians Paulista": "Corinthians",
  "SC Internacional": "Internacional",
  "SE Palmeiras": "Palmeiras",
  "Santos FC": "Santos",
  "São Paulo FC": "São Paulo",

  // Champions
  "AFC Ajax": "Ajax",
  "AS Monaco FC": "Monaco",
  "Arsenal FC": "Arsenal",
  "Atalanta BC": "Atalanta",
  "Athletic Club": "Athletic Bilbao",
  "Bayer 04 Leverkusen": "Leverkusen",
  "Borussia Dortmund": "Dortmund",
  "Chelsea FC": "Chelsea",
  "Club Atlético de Madrid": "Atlético de Madrid",
  "Club Brugge KV": "Club Brugge",
  "Eintracht Frankfurt": "Eintracht",
  "FC Barcelona": "Barcelona",
  "FC Bayern München": "Bayern",
  "FC Internazionale Milano": "Inter de Milão",
  "FC København": "Copenhague",
  "FK Bodø/Glimt": "Bodø/Glimt",
  "FK Kairat": "Kairat",
  "Galatasaray SK": "Galatasaray",
  "Juventus FC": "Juventus",
  "Liverpool FC": "Liverpool",
  "Manchester City FC": "Manchester City",
  "Newcastle United FC": "Newcastle",
  "Olympique de Marseille": "Marselha",
  "PAE Olympiakos SFP": "Olympiacos",
  "PSV": "PSV",
  "Paphos FC": "Pafos",
  "Paris Saint-Germain FC": "PSG",
  "Qarabağ Ağdam FK": "Qarabağ",
  "Real Madrid CF": "Real Madrid",
  "Royale Union Saint-Gilloise": "Union SG",
  "SK Slavia Praha": "Slavia Praga",
  "SSC Napoli": "Napoli",
  "Sport Lisboa e Benfica": "Benfica",
  "Sporting Clube de Portugal": "Sporting",
  "Tottenham Hotspur FC": "Tottenham",
  "Villarreal CF": "Villarreal",

  // Premier League (além dos que já estão na Champions)
  "AFC Bournemouth": "Bournemouth",
  "Aston Villa FC": "Aston Villa",
  "Brentford FC": "Brentford",
  "Brighton & Hove Albion FC": "Brighton",
  "Coventry City FC": "Coventry",
  "Crystal Palace FC": "Crystal Palace",
  "Everton FC": "Everton",
  "Fulham FC": "Fulham",
  "Hull City AFC": "Hull City",
  "Ipswich Town FC": "Ipswich",
  "Leeds United FC": "Leeds",
  "Manchester United FC": "Manchester United",
  "Nottingham Forest FC": "Nottingham Forest",
  "Sunderland AFC": "Sunderland",

  // La Liga (além dos que já estão na Champions)
  "CA Osasuna": "Osasuna",
  "Deportivo Alavés": "Alavés",
  "Elche CF": "Elche",
  "Getafe CF": "Getafe",
  "Levante UD": "Levante",
  "Málaga CF": "Málaga",
  "RC Celta de Vigo": "Celta",
  "RC Deportivo La Coruña": "La Coruña",
  "RCD Espanyol": "Espanyol",
  "Racing Santander": "Racing Santander",
  "Rayo Vallecano": "Rayo Vallecano",
  "Real Betis Balompié": "Betis",
  "Real Sociedad de Fútbol": "Real Sociedad",
  "Sevilla FC": "Sevilla",
  "Valencia CF": "Valencia",

  // Libertadores (os fixos de CANONICAL_TEAMS.copa_libertadores)
  "Estudiantes de La Plata": "Estudiantes",
  Flamengo: "Flamengo",
  Fluminense: "Fluminense",
  Palmeiras: "Palmeiras",
};

// Sigla de 3 letras por canonical. Não depende da liga: o mesmo time tem a mesma
// sigla em qualquer competição. Repetir entre ligas é aceito (INT, MAR, ESP, BRA);
// dentro do mesmo jogo o teamPair desempata.
const TEAM_CODES: Record<string, string> = {
  // Brasileirão
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

  // Champions
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

  // Premier League
  "AFC Bournemouth": "BOU",
  "Aston Villa FC": "AVL",
  "Brentford FC": "BRE",
  "Brighton & Hove Albion FC": "BHA",
  "Coventry City FC": "COV",
  "Crystal Palace FC": "CRY",
  "Everton FC": "EVE",
  "Fulham FC": "FUL",
  "Hull City AFC": "HUL",
  "Ipswich Town FC": "IPS",
  "Leeds United FC": "LEE",
  "Manchester United FC": "MUN",
  "Nottingham Forest FC": "NFO",
  "Sunderland AFC": "SUN",

  // La Liga
  "CA Osasuna": "OSA",
  "Deportivo Alavés": "ALA",
  "Elche CF": "ELC",
  "Getafe CF": "GET",
  // LEV já é o Leverkusen: ligas diferentes, mas evitar de graça.
  "Levante UD": "LVT",
  "Málaga CF": "MAL",
  "RC Celta de Vigo": "CEL",
  "RC Deportivo La Coruña": "DEP",
  "RCD Espanyol": "ESP",
  "Racing Santander": "RAC",
  "Rayo Vallecano": "RAY",
  "Real Betis Balompié": "BET",
  "Real Sociedad de Fútbol": "RSO",
  "Sevilla FC": "SEV",
  "Valencia CF": "VAL",

  // Libertadores
  "Estudiantes de La Plata": "EST",
  Flamengo: "FLA",
  Fluminense: "FLU",
  Palmeiras: "PAL",

  // Copa (código FIFA)
  Algeria: "ALG",
  Argentina: "ARG",
  Australia: "AUS",
  Austria: "AUT",
  Belgium: "BEL",
  "Bosnia & Herzegovina": "BIH",
  Brazil: "BRA",
  Canada: "CAN",
  "Cape Verde Islands": "CPV",
  Colombia: "COL",
  "Congo DR": "COD",
  Croatia: "CRO",
  Curaçao: "CUW",
  "Czech Republic": "CZE",
  Ecuador: "ECU",
  Egypt: "EGY",
  England: "ENG",
  France: "FRA",
  Germany: "GER",
  Ghana: "GHA",
  Haiti: "HAI",
  Iran: "IRN",
  Iraq: "IRQ",
  "Ivory Coast": "CIV",
  Japan: "JPN",
  Jordan: "JOR",
  Mexico: "MEX",
  Morocco: "MAR",
  Netherlands: "NED",
  "New Zealand": "NZL",
  Norway: "NOR",
  Panama: "PAN",
  Paraguay: "PAR",
  Portugal: "POR",
  Qatar: "QAT",
  "Saudi Arabia": "KSA",
  Scotland: "SCO",
  Senegal: "SEN",
  "South Africa": "RSA",
  "South Korea": "KOR",
  Spain: "ESP",
  Sweden: "SWE",
  Switzerland: "SUI",
  Tunisia: "TUN",
  Türkiye: "TUR",
  USA: "USA",
  Uruguay: "URU",
  Uzbekistan: "UZB",
};

// Afixos de clube (sociedade/forma jurídica) que não fazem parte do nome falado.
const AFFIX_TOKENS = new Set([
  "FC", "CF", "SC", "AC", "CR", "CA", "EC", "SE", "FK", "SK", "KV", "BC", "SSC",
  "PAE", "SFP", "AFC", "AF", "FBPA", "FBC", "UD", "CD", "CLUB", "CLUBE",
]);
// Partículas que não entram na sigla ("LDU de Quito" → LDU).
const PARTICLE_TOKENS = new Set(["DE", "DO", "DA", "DEL", "LA", "E"]);
// Primeiro token genérico: a sigla usa a inicial dele + 2 letras do seguinte
// ("Independiente del Valle" → IVA, "Atletico-MG" → AMG).
const GENERIC_FIRST_TOKENS = new Set([
  "ATLETICO", "INDEPENDIENTE", "UNIVERSIDAD", "DEPORTIVO", "DEPORTES",
  "SPORTING", "REAL",
]);

// Lookup só em chave própria (um "constructor" não pode cair no protótipo).
function own(map: Record<string, string>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

function foldUpper(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

function letterCount(s: string): number {
  return (s.match(/\p{L}|\p{N}/gu) ?? []).length;
}

/**
 * Nome curto derivado para clube fora do mapa: tira afixos (FC, SC, Club…) só
 * nas pontas, preservando o miolo ("Club Atlético de Madrid" → "Atlético de
 * Madrid"). Se sobrar menos de 3 letras, devolve o canonical. Nunca vazio.
 */
export function deriveDisplayName(canonicalName: string): string {
  const tokens = canonicalName.trim().split(/\s+/).filter(Boolean);
  const isAffix = (t: string) => AFFIX_TOKENS.has(foldUpper(t));
  let start = 0;
  let end = tokens.length;
  while (start < end && isAffix(tokens[start])) start++;
  while (end > start && isAffix(tokens[end - 1])) end--;
  const name = tokens.slice(start, end).join(" ");
  return letterCount(name) >= 3 ? name : canonicalName;
}

// Tokens significativos para a sigla: sem acento, maiúsculos, sem afixo/partícula.
function codeTokens(canonicalName: string): string[] {
  const tokens = foldUpper(canonicalName)
    .replace(/(\d)\.(?=\S)/g, "$1 ")
    .split(/[\s\-/&]+/)
    .map((t) => t.replace(/[^A-Z0-9]/g, ""))
    .filter(
      (t) => t.length > 0 && !AFFIX_TOKENS.has(t) && !PARTICLE_TOKENS.has(t),
    );
  // Número puro (1899 Hoffenheim, 1. FC Köln) não vira sigla quando sobra palavra.
  const words = tokens.filter((t) => !/^\d+$/.test(t));
  return words.length > 0 ? words : tokens;
}

function padCode(candidate: string, fill: string): string {
  return (candidate + fill + "XXX").slice(0, 3);
}

/**
 * Sigla derivada (sempre 3 caracteres `[A-Z0-9]`) para time fora do mapa.
 * Imita a TV (RIV, BOC, PEN), não as iniciais.
 */
export function deriveCode(canonicalName: string): string {
  const tokens = codeTokens(canonicalName);
  if (tokens.length === 0) {
    return padCode(foldUpper(canonicalName).replace(/[^A-Z0-9]/g, ""), "");
  }
  const [first, ...rest] = tokens;
  if (GENERIC_FIRST_TOKENS.has(first) && rest.length > 0) {
    return padCode(first[0] + rest[0].slice(0, 2), rest[0].slice(2) + rest.slice(1).join(""));
  }
  return padCode(first.slice(0, 3), rest.join(""));
}

/**
 * Sigla alternativa quando as duas siglas de um jogo empatam (só o teamPair usa).
 * Tenta: 3 primeiras letras do último token; primeira letra + 2 consoantes
 * seguintes do primeiro token; 2 primeiras letras da sigla + "2".
 */
export function alternateCode(canonicalName: string, taken: string): string {
  const code = teamCode(canonicalName);
  const tokens = codeTokens(canonicalName);
  const candidates: string[] = [];
  if (tokens.length > 0) {
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    candidates.push(padCode(last.slice(0, 3), ""));
    const consonants = first.slice(1).replace(/[AEIOU0-9]/g, "");
    if (consonants.length >= 2) candidates.push(first[0] + consonants.slice(0, 2));
  }
  candidates.push(code.slice(0, 2) + "2", code.slice(0, 2) + "3");
  return candidates.find((c) => c !== taken) ?? code;
}

/** True se a sigla do time vem do mapa curado (o teamPair nunca troca essa). */
export function hasCuratedCode(canonicalName: string): boolean {
  return own(TEAM_CODES, canonicalName) !== undefined;
}

/** Sigla de 3 letras do time. Display-only — nunca usar como chave. */
export function teamCode(canonicalName: string): string {
  return own(TEAM_CODES, canonicalName) ?? deriveCode(canonicalName);
}

/**
 * Nome curto de exibição. Copa ('wc') → seleção em PT-BR; clube → nome curto
 * curado ou derivado. Display-only — nunca usar como chave de matching.
 */
export function displayTeamName(
  canonicalName: string,
  league: LeagueKey,
): string {
  if (league === "wc") return own(WC_TEAM_LABELS_PT, canonicalName) ?? canonicalName;
  return own(CLUB_SHORT_NAMES, canonicalName) ?? deriveDisplayName(canonicalName);
}

/**
 * Nome oficial, para `title`/tooltip. Copa → seleção em PT-BR; clube → o
 * canonical. Display-only.
 */
export function officialTeamName(
  canonicalName: string,
  league: LeagueKey,
): string {
  if (league !== "wc") return canonicalName;
  return own(WC_TEAM_LABELS_PT, canonicalName) ?? canonicalName;
}

// Exportados só para os testes de completude.
export { CLUB_SHORT_NAMES, TEAM_CODES, WC_TEAM_LABELS_PT };
