import type { JudgmentMultipliers } from "@/lib/ai/judgments/apply";
import type { JudgmentAnswers } from "@/lib/ai/judgments/types";

// Conteúdo de `predictions.judgments` (jsonb, ADR 0041 §6): tudo que a decisão do
// motor code_jev precisa pra ser recomputada a partir da row.
export type PredictionJudgments = {
  engine: "code_jev";
  // Julgamentos JEV aplicados ao λ? false = JEV falhou/sem chave → λ_base puro.
  applied: boolean;
  answers: JudgmentAnswers | null;
  multipliers: JudgmentMultipliers | null;
  lambda: {
    source: "dixon_coles" | "heuristic";
    degraded: boolean;
    // ρ da matriz; null = DIXON_COLES_RHO pinado de scorelineMatrix.
    rho: number | null;
    base: { home: number; away: number };
    adjusted: { home: number; away: number };
  };
  versions: {
    judgments: string;
    weights: string;
    narrator: string;
    // Modelo JEV que respondeu (null quando o JEV não respondeu).
    jevModel: string | null;
  };
  // Por que o JEV não foi aplicado (null quando aplicado).
  failure: { kind: string; message: string } | null;
  // sha256 do JSON canônico do `state` enviado ao JEV: chave de reuso das
  // respostas entre mercados do mesmo jogo (ADR 0041 §1).
  stateHash: string;
  // Row de ai_calls da chamada JEV que produziu `answers` (null quando o insert de
  // auditoria falhou). Num reuso, é a chamada da predição de origem.
  aiCallId: string | null;
  // Predição de origem cujas respostas foram reusadas (sem chamada JEV nova);
  // null quando o JEV foi chamado nesta análise (no best bet, pelo run: todas as
  // predições do run apontam pra mesma `aiCallId`).
  reusedFromPredictionId: string | null;
  // Quem escreveu o racional (#512). "llm_call": esta predição fez a chamada
  // narradora (a row de ai_calls é a dela; falha do narrador → texto templado, com
  // o status da falha na row). "best_bet_template": mercado não escolhido no best
  // bet — racional templado em código, sem chamada; `aiCallId` da predição aponta
  // pra narração do mercado escolhido no mesmo run. Ausente nas rows anteriores.
  narration?: "llm_call" | "best_bet_template";
};
