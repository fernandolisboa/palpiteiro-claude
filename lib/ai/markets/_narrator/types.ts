// A decisão fixa que o narrador explica (ADR 0041 §4). Tudo aqui é número do
// código — o narrador não produz nenhum.

export type NarratorTeams = { home: string; away: string };

export type NarratorSelection = {
  key: string;
  // Rótulo PT-BR da seleção (ex.: "Mais de 2,5 gols (over 2,5)").
  label: string;
  modelProbPct: number;
  impliedPct: number | null;
  edgePct: number | null;
  odd: number | null;
};

export type NarratorDecision = {
  marketKey: string;
  marketLabel: string;
  line: number | null;
  teams: NarratorTeams;
  // Todas as seleções do mercado (descriptor.selectionKeys).
  selectionKeys: readonly string[];
  // selectionKey recomendada ou "pass".
  side: string;
  // A seleção recomendada; num pass, a melhor candidata (maior edge). null quando
  // o edge não foi mensurável.
  focus: NarratorSelection | null;
  // null em pass.
  stakeUnits: number | null;
  minEdgePp: number;
  // λ ajustado (gols esperados que geraram a matriz).
  expectedGoals: { home: number; away: number };
  judgmentsApplied: boolean;
  // Fatores JEV aplicados, já em frases PT-BR (sem números).
  judgmentFactors: string[];
};

// Dados de contexto (os mesmos que o prompt de mercado recebe, com desfalques por
// função, sem nome de jogador).
export type NarratorContext = {
  leagueLabel: string;
  kickoffAt: string;
  venue?: string;
  standings: {
    team: string;
    position: number;
    played: number;
    points: number;
    goalsFor: number;
    goalsAgainst: number;
  }[];
  form: { home: string[]; away: string[] };
  h2h: string[];
  absences: { available: boolean; home: string[]; away: string[] };
};
