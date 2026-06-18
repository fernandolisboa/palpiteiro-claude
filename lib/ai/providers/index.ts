// Barrel do seam de providers (ADR 0027). predict.ts resolve o provider DAQUI e
// nunca importa um SDK de IA direto. Despacha por `model.provider`; o gate de
// audiência + `providerHasKey` (modelsForAudience, models.ts) garante que um
// provider sem chave nunca chega a ser roteado pelo fluxo normal.

import type { AIModel, AIProviderKey } from "@/lib/ai/models";

import { anthropicProvider } from "./anthropic";
import { openaiProvider } from "./openai";
import type { AIProvider } from "./types";

// Total sobre AIProviderKey — um provider novo no union força uma entrada aqui.
const PROVIDERS: Record<AIProviderKey, AIProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
};

export function getProviderForModel(model: AIModel): AIProvider {
  return PROVIDERS[model.provider];
}

export type {
  AIProvider,
  AnalysisRequest,
  AnalysisResult,
  AnalysisOk,
  AnalysisErr,
  AnalysisUsage,
  ToolDef,
} from "./types";
