import { TYPESAFE_PRICE_PER_MTOK_INPUT, type AIModel } from "./models";

// Custo lido do próprio `AIModel` (o que rodou de fato, `result.servedModel`): o tipo
// garante que todo modelo tem pricing, inclusive uma versão fora do registry.
// Com `longPromptPricing` (Haiku 5.5), um prompt acima do limite cobra a chamada
// inteira na tarifa maior. `inputTokens` é o total da chamada; no ramo server-tool ele
// soma as retomadas de pause_turn, e o limite vale pela soma (aproximação a maior).
export function calculateCost(args: {
  model: AIModel;
  inputTokens: number;
  outputTokens: number;
}): number {
  const m = args.model;
  const rates =
    m.longPromptPricing && args.inputTokens > m.longPromptPricing.aboveInputTokens
      ? m.longPromptPricing
      : m;
  return (
    (args.inputTokens * rates.inputPricePerMTok +
      args.outputTokens * rates.outputPricePerMTok) /
    1_000_000
  );
}

// Custo de uma chamada de julgamentos JEV (ADR 0041): só input é cobrado.
export function calculateJudgmentCost(inputTokens: number): number {
  return (inputTokens * TYPESAFE_PRICE_PER_MTOK_INPUT) / 1_000_000;
}
