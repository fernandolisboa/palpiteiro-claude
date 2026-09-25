import type { PredictionJudgments } from "@/lib/ai/engine/types";

// A row de ai_calls referenciada pela predição é DELA? Falso só no mercado não
// escolhido do best bet code_jev (#512): racional templado em código, sem chamada
// própria — `aiCallId` aponta pra narração de OUTRO mercado do run, cujo custo,
// tokens, status e payloads não são desta predição.
export function ownsAiCall(prediction: {
  judgments: PredictionJudgments | null;
}): boolean {
  return prediction.judgments?.narration !== "best_bet_template";
}
