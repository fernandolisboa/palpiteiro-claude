// Tipos da camada de julgamentos (ADR 0041). Neutros de provider: o adapter
// TypeSafe (provider.ts) traduz o wire pra cá.

export const JUDGMENT_FACTORS = [
  "attack_weakened",
  "defense_weakened",
  "rotation_risk",
  "high_stakes",
] as const;
export type JudgmentFactor = (typeof JUDGMENT_FACTORS)[number];

export type TeamSide = "home" | "away";

export type JudgmentQuestionId = `${JudgmentFactor}_${TeamSide}`;

export type JudgmentText = string | Record<string, unknown>;

export type JudgmentQuestion = {
  type: "noul";
  instructions: JudgmentText;
  criteria: { true: JudgmentText; false: JudgmentText };
};

export type JudgmentQuestionSet = Record<JudgmentQuestionId, JudgmentQuestion>;

// Estado em inglês enviado ao JEV. Só buckets e papéis — nunca números crus,
// datas ou nomes de jogador (jaggedness + minimização LGPD).
export type JudgmentTeamState = {
  name: string;
  absences: string[];
  rest_before_match: string;
  next_match: string;
  league_situation: string;
};

export type JudgmentState = {
  match: { competition: string; season_stage: string };
  home_team: JudgmentTeamState;
  away_team: JudgmentTeamState;
};

// `value` = noul (probabilidade de a afirmação ser verdadeira, 0..1).
export type Judgment = { value: number; confidence: number };

export type JudgmentAnswers = Record<JudgmentQuestionId, Judgment>;

export type JudgmentResult = {
  answers: Record<string, Judgment>;
  model: string;
  inputTokens: number;
  latencyMs: number;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
};

export type JudgmentProvider = {
  hasKey(): boolean;
  judge(
    state: JudgmentState,
    questions: JudgmentQuestionSet
  ): Promise<JudgmentResult>;
};
