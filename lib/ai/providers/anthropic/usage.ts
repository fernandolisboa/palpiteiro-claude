import type Anthropic from "@anthropic-ai/sdk";

import type { AnalysisUsage } from "../types";

// Coage o uso de tokens a inteiro finito ≥0 (anti-NaN em `calculateCost` →
// `costUsd` numeric NOT NULL). Identidade pros valores inteiros que a Anthropic
// sempre devolve; relevante de fato no #231 (OpenAI).
function coerceTokens(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
}

export const NO_USAGE: AnalysisUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

// `usage` da resposta → uso neutro (ADR 0071). Na API, `input_tokens` é só a parte
// NÃO cacheada; o total do prompt é a soma com a escrita e a leitura de cache, e é esse
// total que vira `inputTokens`. Os campos de cache vêm null quando não houve cache.
export function usageFromMessage(usage: Anthropic.Usage): AnalysisUsage {
  const uncached = coerceTokens(usage.input_tokens);
  const cacheCreationInputTokens = coerceTokens(
    usage.cache_creation_input_tokens
  );
  const cacheReadInputTokens = coerceTokens(usage.cache_read_input_tokens);
  return {
    inputTokens: uncached + cacheCreationInputTokens + cacheReadInputTokens,
    outputTokens: coerceTokens(usage.output_tokens),
    cacheCreationInputTokens,
    cacheReadInputTokens,
  };
}

export function addUsage(a: AnalysisUsage, b: AnalysisUsage): AnalysisUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens:
      a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}
