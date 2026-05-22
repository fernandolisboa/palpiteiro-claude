export type LeagueKey = "bsa" | "ucl";
export type LeagueFilter = LeagueKey | "all";
export type Recommendation = "OVER" | "UNDER" | "PASS";

export type Team = {
  name: string;
  short: string;
  hue: number;
};

export type Fixture = {
  id: string;
  home: Team;
  away: Team;
  league: LeagueKey;
  kickoff: string;
  when: string;
  odds: { over: string; under: string };
  hasPrediction: boolean;
  venue?: string;
  countdown?: string;
};

export type RecentPrediction = {
  id: string;
  home: string;
  away: string;
  rec: Recommendation;
  edge: string | null;
  when: string;
  league: LeagueKey;
};

export const LEAGUE_LABEL: Record<LeagueKey, string> = {
  bsa: "Brasileirão",
  ucl: "Champions",
};

export const FIXTURES: Fixture[] = [
  {
    id: "pal-fla",
    home: { name: "Palmeiras", short: "PAL", hue: 145 },
    away: { name: "Flamengo", short: "FLA", hue: 25 },
    league: "bsa",
    kickoff: "em 3h 24min",
    when: "hoje, 21:30",
    odds: { over: "1.92", under: "1.88" },
    hasPrediction: true,
    venue: "Allianz Parque · São Paulo",
    countdown: "em 3h 24min",
  },
  {
    id: "rma-mci",
    home: { name: "Real Madrid", short: "RMA", hue: 240 },
    away: { name: "Manchester City", short: "MCI", hue: 200 },
    league: "ucl",
    kickoff: "em 5h 10min",
    when: "hoje, 23:00",
    odds: { over: "2.10", under: "1.74" },
    hasPrediction: false,
    venue: "Santiago Bernabéu · Madrid",
    countdown: "em 5h 10min",
  },
  {
    id: "cam-bot",
    home: { name: "Atlético-MG", short: "CAM", hue: 0 },
    away: { name: "Botafogo", short: "BOT", hue: 0 },
    league: "bsa",
    kickoff: "amanhã, 16:00",
    when: "qua, 23 mai",
    odds: { over: "2.05", under: "1.78" },
    hasPrediction: false,
    venue: "Arena MRV · Belo Horizonte",
  },
  {
    id: "psg-bay",
    home: { name: "Paris SG", short: "PSG", hue: 230 },
    away: { name: "Bayern", short: "BAY", hue: 25 },
    league: "ucl",
    kickoff: "qui, 21:00",
    when: "qui, 24 mai",
    odds: { over: "1.82", under: "2.00" },
    hasPrediction: true,
    venue: "Parc des Princes · Paris",
  },
  {
    id: "cru-int",
    home: { name: "Cruzeiro", short: "CRU", hue: 240 },
    away: { name: "Internacional", short: "INT", hue: 25 },
    league: "bsa",
    kickoff: "sex, 19:00",
    when: "sex, 25 mai",
    odds: { over: "2.28", under: "1.62" },
    hasPrediction: false,
    venue: "Mineirão · Belo Horizonte",
  },
];

export const RECENT_PREDS: RecentPrediction[] = [
  { id: "p1", home: "GRE", away: "COR", rec: "OVER", edge: "+4.8", when: "20 mai", league: "bsa" },
  { id: "p2", home: "BAR", away: "PSG", rec: "PASS", edge: null, when: "18 mai", league: "ucl" },
  { id: "p3", home: "FLU", away: "SAO", rec: "UNDER", edge: "+5.3", when: "17 mai", league: "bsa" },
  { id: "p4", home: "BVB", away: "MUN", rec: "OVER", edge: "+8.1", when: "15 mai", league: "ucl" },
  { id: "p5", home: "VAS", away: "BAH", rec: "OVER", edge: "+6.2", when: "13 mai", league: "bsa" },
];

export function filterFixturesByLeague(
  fixtures: Fixture[],
  league: LeagueFilter,
): Fixture[] {
  if (league === "all") return fixtures;
  return fixtures.filter((f) => f.league === league);
}

export function parseLeagueFilter(input: string | undefined | null): LeagueFilter {
  if (input === "bsa" || input === "ucl") return input;
  return "all";
}

export function getFixtureById(id: string): Fixture | undefined {
  return FIXTURES.find((f) => f.id === id);
}

export type AnalysisKind = "OVER" | "UNDER" | "PASS";

export type Analysis = {
  kind: AnalysisKind;
  confidence: string;
  edge: string | null;
  minOdd: string | null;
  rationale: string;
  factors: string[];
  generatedAt: string;
  promptVersion: string;
  model: string;
  costUsd: string;
};

const OVER_ANALYSIS: Analysis = {
  kind: "OVER",
  confidence: "58%",
  edge: "+7.3",
  minOdd: "1.75",
  rationale:
    "Ambos os times têm média de 1.8 gols marcados nos últimos 5 jogos e defesas vazadas com frequência. H2H histórico mostra 7 dos últimos 10 confrontos com 3+ gols. Sem lesões relevantes em atacantes titulares.",
  factors: [
    "Média ofensiva alta de ambos os lados",
    "H2H tende a jogos com gols",
    "Sem ausências críticas no ataque",
    "Mando neutro em estádio histórico de placar elevado",
  ],
  generatedAt: "19 mai · 14:22",
  promptVersion: "over_under_v1.2",
  model: "claude-sonnet-4.5",
  costUsd: "$0.014",
};

const UNDER_ANALYSIS: Analysis = {
  kind: "UNDER",
  confidence: "56%",
  edge: "+6.7",
  minOdd: "1.80",
  rationale:
    "Real Madrid joga sem dois titulares de criação por lesão. Manchester City vem de 3 jogos com média 1.0 gol marcado. Champions League fase mata-mata historicamente tem média de gols 18% menor que fase de grupos.",
  factors: [
    "Ausências críticas no Real Madrid",
    "Baixa produção ofensiva recente do City",
    "Padrão histórico de mata-mata da Champions",
    "Probabilidade de empate elevada favorece under",
  ],
  generatedAt: "19 mai · 14:22",
  promptVersion: "over_under_v1.2",
  model: "claude-sonnet-4.5",
  costUsd: "$0.012",
};

const PASS_ANALYSIS: Analysis = {
  kind: "PASS",
  confidence: "51%",
  edge: null,
  minOdd: null,
  rationale:
    "Probabilidade estimada de over (51%) está próxima demais da implícita do mercado (50.7%). Sem edge significativo após considerar margem de erro. Time visitante chega com baixa rotatividade ofensiva nos últimos 3 jogos, mas dados de lesões indisponíveis para esta análise.",
  factors: [
    "Edge abaixo do threshold de 5pp",
    "Dados de lesões indisponíveis",
  ],
  generatedAt: "19 mai · 14:22",
  promptVersion: "over_under_v1.2",
  model: "claude-sonnet-4.5",
  costUsd: "$0.011",
};

export function getAnalysisForKind(kind: AnalysisKind): Analysis {
  if (kind === "OVER") return OVER_ANALYSIS;
  if (kind === "UNDER") return UNDER_ANALYSIS;
  return PASS_ANALYSIS;
}
