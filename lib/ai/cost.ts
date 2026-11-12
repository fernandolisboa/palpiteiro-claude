import {
  CACHE_WRITE_MULTIPLIER,
  TYPESAFE_PRICE_PER_MTOK_INPUT,
  type AIModel,
} from "./models";

// Custo lido do próprio `AIModel` (o que rodou de fato, `result.servedModel`): o tipo
// garante que todo modelo tem pricing, inclusive uma versão fora do registry.
// Com `longPromptPricing` (Haiku 5.5), um prompt acima do limite cobra a chamada
// inteira na tarifa maior. `inputTokens` é o TOTAL do prompt, cache incluído (ADR
// 0071); no ramo server-tool ele soma as retomadas de pause_turn, e o limite vale pela
// soma (aproximação a maior).
//
// Prompt caching (ADR 0071): da parte do input que foi escrita no cache cobra-se 1,25×,
// da lida, `cacheReadMultiplier`× e o resto sai pelo preço cheio. Sem os campos de
// cache, tudo sai pelo preço cheio (o custo de antes, nunca a menos).
export function calculateCost(args: {
  model: AIModel;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}): number {
  const m = args.model;
  const rates =
    m.longPromptPricing && args.inputTokens > m.longPromptPricing.aboveInputTokens
      ? m.longPromptPricing
      : m;
  const written = args.cacheCreationInputTokens ?? 0;
  const read = args.cacheReadInputTokens ?? 0;
  const uncached = Math.max(0, args.inputTokens - written - read);
  const inputCost =
    uncached * rates.inputPricePerMTok +
    written * rates.inputPricePerMTok * CACHE_WRITE_MULTIPLIER +
    read * rates.inputPricePerMTok * m.cacheReadMultiplier;
  return (inputCost + args.outputTokens * rates.outputPricePerMTok) / 1_000_000;
}

// Custo de uma chamada de julgamentos JEV (ADR 0041): só input é cobrado.
export function calculateJudgmentCost(inputTokens: number): number {
  return (inputTokens * TYPESAFE_PRICE_PER_MTOK_INPUT) / 1_000_000;
}
