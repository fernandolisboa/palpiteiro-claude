export type LeagueKey = "bsa" | "ucl" | "wc";
export type LeagueFilter = LeagueKey | "all";
export type Recommendation = "OVER" | "UNDER" | "PASS";

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

export type AnalysisView = {
  kind: Recommendation;
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
