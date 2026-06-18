// Barrel do seam de providers (ADR 0027). predict.ts resolve o provider DAQUI e
// nunca importa um SDK de IA direto. No #230 só existe o Anthropic, então
// `getProviderForModel` devolve INCONDICIONALMENTE o `anthropicProvider`; o #231
// amplia pra despachar por `model.provider` (campo novo no registry) + filtro de
// `hasKey()`/audiência.

import type { AIModel } from "@/lib/ai/models";

import { anthropicProvider } from "./anthropic";
import type { AIProvider } from "./types";

export function getProviderForModel(model: AIModel): AIProvider {
  // #231: dispatch por `model.provider` + gate de audiência/`hasKey()`. Hoje
  // (#230) é Anthropic-only — o parâmetro existe pra fixar a assinatura do seam.
  void model;
  return anthropicProvider;
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
