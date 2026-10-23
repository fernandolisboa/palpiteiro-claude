import type { PredictionJudgments } from "@/lib/ai/engine/types";

// A row de ai_calls referenciada pela predição é DELA? Allow-list (#619): só quando a
// predição fez a própria chamada narradora (`llm_call`) ou não tem marcador (caminho
// LLM e rows antigas). Qualquer racional templado que aponta pra chamada de outro
// (mercado não escolhido do best bet, #512; reconferência com a escalação, que aponta
// pra chamada JEV de sistema) não herda custo, tokens, status nem payloads.
export function ownsAiCall(prediction: {
  judgments: PredictionJudgments | null;
}): boolean {
  const narration = prediction.judgments?.narration;
  return narration === undefined || narration === "llm_call";
}
