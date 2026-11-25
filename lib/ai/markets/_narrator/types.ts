import type { JudgmentQuestionId } from "@/lib/ai/judgments/types";

// A decisão fixa que o narrador explica (ADR 0041 §4). Tudo aqui é número do
// código — o narrador não produz nenhum.

export type NarratorTeams = { home: string; away: string };

// Fatores do JEV que o contexto extra do usuário moveu (#565), com a força do sinal que
// moveu: "confirmed" = o fato e o papel vêm dos nossos dados; "unverified" = algo do que
// moveu o fator é só do usuário (inclusive o papel de um desfalque que a nossa lista
// confirma sem posição). Só a origem: a força da frase continua vindo do valor do JEV.
export type UserFactorOrigins = Partial<
  Record<JudgmentQuestionId, "confirmed" | "unverified">
>;

// De onde veio um fator que não é só do JEV (narrator_v1.6, #672): o contexto extra do
// usuário (#565) ou as notícias do ge, com a força do sinal que o moveu ("confirmed" =
// os nossos dados confirmam o fato). A força da FRASE continua vindo só do JEV.
export type FactorOrigin = {
  by: "user" | "news";
  strength: "confirmed" | "unverified";
};
export type FactorOrigins = Partial<Record<JudgmentQuestionId, FactorOrigin>>;

export type NarratorSelection = {
  key: string;
  // Rótulo PT-BR da seleção (ex.: "Mais de 2,5 gols (over 2,5)").
  label: string;
  modelProbPct: number;
  impliedPct: number | null;
  edgePct: number | null;
  odd: number | null;
};

// Uma seleção do mercado vista pelo narrador (#669): só a chance do modelo e a
// implícita, sem edge (o edge citável é só o do focus). Deixa o texto citar a chance do
// favorito, ou do empate, sem a fidelidade reprovar.
export type NarratorMarketSelection = {
  key: string;
  label: string;
  modelProbPct: number;
  impliedPct: number | null;
};

export type NarratorDecision = {
  marketKey: string;
  marketLabel: string;
  line: number | null;
  teams: NarratorTeams;
  // Todas as seleções do mercado (descriptor.selectionKeys).
  selectionKeys: readonly string[];
  // As seleções da linha decidida, na ordem de selectionKeys (#669). O template não lê.
  selections: NarratorMarketSelection[];
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
  // Contexto extra (#569): o que a pessoa informou e o código não confere (subtipos de
  // "outra informação"), em linhas montadas pelo código. Sem efeito no número.
  userNotes?: string[];
  // Notícias do ge (#672) sem efeito no número (troca de técnico, motivação), em linhas
  // montadas pelo código (nunca a frase da matéria). Ausente = nenhuma.
  newsNotes?: string[];
  // Reconferência com a escalação (#619): frases da escalação confirmada (papéis, sem
  // nome), montadas pelo código. Só o racional templado lê; o narrador LLM nunca recebe
  // este campo (a reconferência não chama o narrador).
  lineupNotes?: string[];
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
