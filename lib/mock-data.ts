export type Team = { name: string; short: string; color: string };

export type Recommendation = "over" | "under" | "pass";

export type Odds = {
  over: number;
  under: number;
  impliedOver: number;
  impliedUnder: number;
  overround: number;
  bookmaker: string;
};

export type PredictionSummary = {
  rec: Recommendation;
  confidence: number;
  edge: number;
};

export type Match = {
  id: string;
  league: "BSA" | "UCL";
  leagueFull: string;
  timeRel: string;
  soon: boolean;
  kickoffFull: string;
  kickoffRel?: string;
  kickoffWithin24h?: boolean;
  venue: string;
  home: Team;
  away: Team;
  odds: Odds;
  prediction: PredictionSummary | null;
};

export type FormRow = {
  date: string;
  side: "vs" | "@";
  opp: string;
  gf: number;
  ga: number;
  result: "W" | "D" | "L";
};

export type H2HRow = {
  date: string;
  home: string;
  gh: number;
  ga: number;
  away: string;
};

export type Standing = {
  pos: number;
  pts: number;
  played: number;
  gf: number;
  ga: number;
};

export type Absence = { player: string; role: string; status: string };

export type MatchDetail = {
  forms: {
    home: FormRow[];
    away: FormRow[];
    homeSummary: ("W" | "D" | "L")[];
    awaySummary: ("W" | "D" | "L")[];
  };
  h2h: H2HRow[];
  standings?: { home: Standing; away: Standing };
  absences: {
    home: Absence[] | "unknown";
    away: Absence[] | "unknown";
  };
};

export type AnalysisMeta = {
  prompt: string;
  model: string;
  cost: number;
  timestamp: string;
  bookmaker: string;
};

export type Analysis = {
  rec: Recommendation;
  confidence: number;
  edge: number;
  minimumOdd?: number;
  rationale: string;
  factors: string[];
  meta: AnalysisMeta;
};

export const matches: Match[] = [
  {
    id: "m1",
    league: "BSA",
    leagueFull: "Brasileirão Série A",
    timeRel: "em 3h",
    soon: true,
    kickoffFull: "Hoje, 14 mai · 21:30",
    kickoffRel: "em 3h 12min",
    kickoffWithin24h: true,
    venue: "Allianz Parque · São Paulo",
    home: { name: "Palmeiras", short: "PAL", color: "#1A5639" },
    away: { name: "Flamengo", short: "FLA", color: "#C5002F" },
    odds: {
      over: 1.92,
      under: 1.88,
      impliedOver: 50.7,
      impliedUnder: 49.3,
      overround: 2.6,
      bookmaker: "bet365",
    },
    prediction: { rec: "over", confidence: 58, edge: 7.3 },
  },
  {
    id: "m2",
    league: "UCL",
    leagueFull: "UEFA Champions League · Quartas",
    timeRel: "em 1h",
    soon: true,
    kickoffFull: "Hoje, 14 mai · 19:00",
    kickoffRel: "em 47min",
    kickoffWithin24h: true,
    venue: "Santiago Bernabéu · Madrid",
    home: { name: "Real Madrid", short: "RMA", color: "#FCBF00" },
    away: { name: "Manchester City", short: "MCI", color: "#6CABDD" },
    odds: {
      over: 2.1,
      under: 1.75,
      impliedOver: 44.0,
      impliedUnder: 56.0,
      overround: 3.6,
      bookmaker: "bet365",
    },
    prediction: { rec: "under", confidence: 56, edge: 6.7 },
  },
  {
    id: "m3",
    league: "BSA",
    leagueFull: "Brasileirão Série A",
    timeRel: "em 5h",
    soon: false,
    kickoffFull: "Hoje, 14 mai · 23:30",
    kickoffRel: "em 5h 14min",
    kickoffWithin24h: true,
    venue: "MorumBis · São Paulo",
    home: { name: "São Paulo", short: "SAO", color: "#C12127" },
    away: { name: "Atlético-MG", short: "CAM", color: "#1A1A1A" },
    odds: {
      over: 2.02,
      under: 1.87,
      impliedOver: 47.3,
      impliedUnder: 52.7,
      overround: 3.0,
      bookmaker: "bet365",
    },
    prediction: { rec: "pass", confidence: 51, edge: 2.1 },
  },
  {
    id: "m4",
    league: "BSA",
    leagueFull: "Brasileirão Série A",
    timeRel: "amanhã, 16:00",
    soon: false,
    kickoffFull: "Amanhã, 15 mai · 16:00",
    venue: "Maracanã · Rio de Janeiro",
    home: { name: "Fluminense", short: "FLU", color: "#7E1430" },
    away: { name: "Grêmio", short: "GRE", color: "#0066A6" },
    odds: {
      over: 2.14,
      under: 1.78,
      impliedOver: 45.0,
      impliedUnder: 55.0,
      overround: 3.3,
      bookmaker: "bet365",
    },
    prediction: null,
  },
  {
    id: "m5",
    league: "UCL",
    leagueFull: "UEFA Champions League · Quartas",
    timeRel: "amanhã, 16:00",
    soon: false,
    kickoffFull: "Amanhã, 15 mai · 16:00",
    venue: "Emirates Stadium · Londres",
    home: { name: "Arsenal", short: "ARS", color: "#EF0107" },
    away: { name: "PSG", short: "PSG", color: "#004170" },
    odds: {
      over: 1.72,
      under: 2.15,
      impliedOver: 56.4,
      impliedUnder: 43.6,
      overround: 3.1,
      bookmaker: "bet365",
    },
    prediction: null,
  },
];

export const matchDetail: Record<string, MatchDetail> = {
  m1: {
    forms: {
      home: [
        { date: "08 mai", side: "vs", opp: "Internacional", gf: 2, ga: 1, result: "W" },
        { date: "04 mai", side: "@", opp: "Vasco", gf: 1, ga: 1, result: "D" },
        { date: "29 abr", side: "vs", opp: "Cuiabá", gf: 3, ga: 0, result: "W" },
        { date: "25 abr", side: "@", opp: "Bahia", gf: 2, ga: 2, result: "D" },
        { date: "20 abr", side: "vs", opp: "Athletico-PR", gf: 3, ga: 1, result: "W" },
      ],
      away: [
        { date: "10 mai", side: "vs", opp: "Botafogo", gf: 2, ga: 2, result: "D" },
        { date: "05 mai", side: "@", opp: "Cruzeiro", gf: 1, ga: 0, result: "W" },
        { date: "01 mai", side: "vs", opp: "Athletico-PR", gf: 4, ga: 1, result: "W" },
        { date: "26 abr", side: "@", opp: "Fortaleza", gf: 0, ga: 2, result: "L" },
        { date: "21 abr", side: "vs", opp: "Internacional", gf: 3, ga: 2, result: "W" },
      ],
      homeSummary: ["W", "D", "W", "D", "W"],
      awaySummary: ["D", "W", "W", "L", "W"],
    },
    h2h: [
      { date: "02 mar", home: "Flamengo", gh: 2, ga: 2, away: "Palmeiras" },
      { date: "21 jan", home: "Palmeiras", gh: 1, ga: 3, away: "Flamengo" },
      { date: "05 out", home: "Flamengo", gh: 3, ga: 0, away: "Palmeiras" },
      { date: "20 jul", home: "Palmeiras", gh: 2, ga: 1, away: "Flamengo" },
      { date: "12 mai", home: "Palmeiras", gh: 0, ga: 0, away: "Flamengo" },
    ],
    standings: {
      home: { pos: 3, pts: 24, played: 11, gf: 19, ga: 9 },
      away: { pos: 1, pts: 28, played: 11, gf: 24, ga: 10 },
    },
    absences: {
      home: [
        { player: "Piquerez", role: "lateral", status: "lesão" },
        { player: "Murilo", role: "zagueiro", status: "dúvida" },
      ],
      away: "unknown",
    },
  },
  m2: {
    forms: {
      home: [
        { date: "07 mai", side: "vs", opp: "Mallorca", gf: 1, ga: 0, result: "W" },
        { date: "03 mai", side: "@", opp: "Atletico", gf: 0, ga: 1, result: "L" },
        { date: "27 abr", side: "vs", opp: "Cádiz", gf: 2, ga: 0, result: "W" },
        { date: "23 abr", side: "vs", opp: "Sevilla", gf: 2, ga: 1, result: "W" },
        { date: "19 abr", side: "@", opp: "Valencia", gf: 1, ga: 1, result: "D" },
      ],
      away: [
        { date: "08 mai", side: "vs", opp: "Wolves", gf: 1, ga: 0, result: "W" },
        { date: "04 mai", side: "@", opp: "Crystal Palace", gf: 1, ga: 4, result: "L" },
        { date: "27 abr", side: "vs", opp: "Nott'm Forest", gf: 1, ga: 0, result: "W" },
        { date: "23 abr", side: "@", opp: "Brighton", gf: 0, ga: 0, result: "D" },
        { date: "13 abr", side: "@", opp: "Luton", gf: 1, ga: 1, result: "D" },
      ],
      homeSummary: ["W", "L", "W", "W", "D"],
      awaySummary: ["W", "L", "W", "D", "D"],
    },
    h2h: [
      { date: "09 mai", home: "Real Madrid", gh: 3, ga: 3, away: "Manchester City" },
      { date: "17 abr", home: "Manchester City", gh: 1, ga: 1, away: "Real Madrid" },
      { date: "10 mai", home: "Manchester City", gh: 4, ga: 0, away: "Real Madrid" },
      { date: "09 mai", home: "Real Madrid", gh: 1, ga: 1, away: "Manchester City" },
    ],
    absences: {
      home: [
        { player: "Vinícius Jr.", role: "atacante", status: "lesão" },
        { player: "Bellingham", role: "meia", status: "lesão" },
      ],
      away: [{ player: "Walker", role: "zagueiro", status: "dúvida" }],
    },
  },
};

export const analyses: Record<string, Analysis> = {
  m1_over: {
    rec: "over",
    confidence: 58,
    edge: 7.3,
    minimumOdd: 1.75,
    rationale:
      "Ambos os times têm média de 1,8 gols marcados nos últimos 5 jogos e defesas vazadas com frequência. H2H histórico mostra 7 dos últimos 10 confrontos com 3+ gols. Sem lesões relevantes em atacantes titulares.",
    factors: [
      "Média ofensiva alta de ambos os lados (1,8 gol/jogo nos últimos 5).",
      "H2H tende a jogos com gols: 7 de 10 acima de 2,5.",
      "Sem ausências críticas no ataque (ambos titulares).",
      "Mando neutro em estádio historicamente de placar elevado.",
    ],
    meta: {
      prompt: "over_under_v1.1",
      model: "sonnet-4.5",
      cost: 0.0083,
      timestamp: "14 mai · 19:42",
      bookmaker: "bet365",
    },
  },
  m1_pass: {
    rec: "pass",
    confidence: 51,
    edge: 0.3,
    rationale:
      "Probabilidade estimada de over (51%) está próxima demais da implícita do mercado (50,7%). Sem edge significativo após considerar margem de erro. Time visitante chega com baixa rotatividade ofensiva nos últimos 3 jogos, mas dados de lesões indisponíveis para esta análise.",
    factors: [
      "Edge abaixo do threshold de 5 pp (apenas +0,3 pp).",
      "Dados de lesões indisponíveis para o visitante.",
      "Forma ofensiva mista nos últimos 3 jogos.",
      "Mercado já incorpora bem a probabilidade estimada.",
    ],
    meta: {
      prompt: "over_under_v1.1",
      model: "sonnet-4.5",
      cost: 0.0079,
      timestamp: "14 mai · 19:48",
      bookmaker: "bet365",
    },
  },
  m2_under: {
    rec: "under",
    confidence: 56,
    edge: 6.7,
    minimumOdd: 1.8,
    rationale:
      "Real Madrid joga sem dois titulares de criação por lesão. Manchester City vem de 3 jogos com média 1,0 gol marcado. Champions League fase mata-mata historicamente tem média de gols 18% menor que fase de grupos.",
    factors: [
      "Ausências críticas no Real Madrid (Vinícius Jr., Bellingham).",
      "Baixa produção ofensiva recente do City (1,0 gol/jogo nos últimos 3).",
      "Padrão histórico de mata-mata da Champions (−18% de gols).",
      "Probabilidade de empate elevada favorece under.",
    ],
    meta: {
      prompt: "over_under_v1.1",
      model: "sonnet-4.5",
      cost: 0.0091,
      timestamp: "14 mai · 17:11",
      bookmaker: "bet365",
    },
  },
};

export const sidebarStats = {
  yield30d: 7.3,
  settled: 18,
  winRate: 50,
  passRate: 38,
  avgCost: 0.0084,
};

export function findMatch(id: string): Match | undefined {
  return matches.find((m) => m.id === id);
}

export function findAnalysisForMatch(
  matchId: string,
  variant: "result" | "existing" | "pass" = "result",
): Analysis {
  if (variant === "pass") return analyses.m1_pass;
  if (matchId === "m2") return analyses.m2_under;
  return analyses.m1_over;
}
