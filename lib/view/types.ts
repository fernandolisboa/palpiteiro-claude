export type LeagueKey = "bsa" | "ucl" | "wc";
export type LeagueFilter = LeagueKey | "all";
export type Recommendation = "OVER" | "UNDER" | "PASS";

// Espelha matchStatusEnum (db/schema.ts). A view carrega o status pra decidir
// entre render agendado (odds + analisar) e encerrado (placar). `finished`
// mostra placar; `postponed`/`cancelled` precisam renderizar sãos (não como um
// 0–0 encerrado); `live` mantém o comportamento de agendado.
export type MatchStatus =
  | "scheduled"
  | "live"
  | "finished"
  | "postponed"
  | "cancelled";

export type Team = {
  name: string;
  short: string;
  hue: number;
};

export type MatchRowView = {
  id: string;
  home: Team;
  away: Team;
  league: LeagueKey;
  kickoff: string;
  when: string;
  odds: { over: string; under: string } | null;
  hasPrediction: boolean;
  status: MatchStatus;
  // Placar final. Não-null só em jogos cujo provider já reportou gols
  // (tipicamente `finished`). null em scheduled/live/postponed/cancelled — e
  // mesmo num finished sem placar (dado faltando) — então a UI nunca inventa
  // um 0–0.
  homeScore: number | null;
  awayScore: number | null;
  venue?: string;
  countdown?: string;
};

export type MatchHeroView = MatchRowView;

export type OddsView = {
  over: string;
  under: string;
  overPct: string;
  underPct: string;
  bookmaker: string;
  overround: string;
  updatedAgo: string;
};

// Frase leiga da aposta recomendada: `market` é o nome do mercado em linguagem
// clara ("Mais de 2.5 gols") e `plain` a tradução literal ("pelo menos 3 gols
// no jogo"). null em pass — não há aposta.
export type BetSummary = {
  market: string;
  plain: string;
};

// Uma coluna do bloco de cenários — 100% strings prontas pra render
// (célula não-derivável = "—"). Valores congelados da análise, nunca do
// snapshot vivo (ADR 0012).
export type ScenarioSideView = {
  modelProb: string; // "58%" — prob. do modelo (label unificado; nunca "confidence")
  marketProb: string; // "50.7%" ou "—" — implied normalizada
  odd: string; // "1.92" ou "—" — odd congelada na análise
  edge: string; // "+7.3pp" ou "—"
  expectedReturn: string; // "+11.4%" ou "—"
  modelBreakEvenOdd: string; // "2.38" — odd de equilíbrio pelo modelo
};

export type ScenariosView = {
  over: ScenarioSideView;
  under: ScenarioSideView;
  recommended: "over" | "under" | null;
  // Frase full-width abaixo do grid: break-even da zebra (não-pass) ou copy
  // de margem de erro (pass). null quando não derivável (histórica sem odd).
  framing: string | null;
  // Nota de degradação pra históricas sem o par congelado.
  note: string | null;
};

export type AnalysisView = {
  kind: Recommendation;
  minOdd: string | null;
  betSummary: BetSummary | null;
  oddAtRec: string | null;
  oddAtRecAgo: string | null;
  bookmaker: string | null;
  expectedReturn: string | null;
  expectedReturnTone: "positive" | "neutral";
  evLegend: string | null;
  minEdgeLabel: string;
  scenarios: ScenariosView | null;
  rationale: string;
  factors: string[];
  generatedAt: string;
  promptVersion: string;
  model: string;
  costUsd: string;
};

export type RecentPredictionView = {
  id: string;
  matchId: string;
  home: string;
  away: string;
  rec: Recommendation;
  edge: string | null;
  when: string;
  league: LeagueKey;
};

export type FormResult = "W" | "D" | "L";

export type FormViewRow = {
  name: string;
  results: FormResult[];
};

export type FormView = {
  home: FormViewRow;
  away: FormViewRow;
};

export type H2HViewRow = {
  date: string;
  h: string;
  a: string;
  s: string;
  tag: "over" | "under";
};

export type H2HView = {
  rows: H2HViewRow[];
  summary: string;
};

export type StandingsViewRow = {
  pos: number;
  team: string;
  p: number;
  gf: number;
  ga: number;
  focus?: boolean;
};

export type StandingsView = {
  rows: StandingsViewRow[];
  round: string;
};

export type InjuriesViewSide = Array<{ name: string; status: string }>;

export type InjuriesView = {
  available: boolean;
  home: InjuriesViewSide;
  away: InjuriesViewSide;
};

export type LineupViewSide = {
  formation?: string;
  starters: string[];
};

export type LineupView = {
  available: boolean;
  home?: LineupViewSide;
  away?: LineupViewSide;
};

export function parseLeagueFilter(input: string | undefined | null): LeagueFilter {
  if (input === "bsa" || input === "ucl" || input === "wc") return input;
  return "all";
}
