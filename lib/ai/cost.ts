import {
  MODEL_REGISTRY,
  TYPESAFE_PRICE_PER_MTOK_INPUT,
  type AIModelId,
} from "./models";

// Custo derivado do registry — garante que TODO modelo selecionável tem pricing.
// (Antes só Sonnet 4.5 existia aqui; um call Opus indexaria undefined → NaN.)
export function calculateCost(args: {
  model: AIModelId;
  inputTokens: number;
  outputTokens: number;
}): number {
  const m = MODEL_REGISTRY[args.model];
  return (
    (args.inputTokens * m.inputPricePerMTok +
      args.outputTokens * m.outputPricePerMTok) /
    1_000_000
  );
}

// Custo de uma chamada de julgamentos JEV (ADR 0041): só input é cobrado.
export function calculateJudgmentCost(inputTokens: number): number {
  return (inputTokens * TYPESAFE_PRICE_PER_MTOK_INPUT) / 1_000_000;
}
