import type Anthropic from "@anthropic-ai/sdk";

import { OVER_UNDER } from "@/lib/odds/market-descriptor";

import type { MarketCartridge } from "../types";
import {
  buildPredictionInput,
  BuildInputError,
  type BuildPredictionInputArgs,
} from "./build-input";
import { SUBMIT_PREDICTION_TOOL, SYSTEM_PROMPT } from "./prompt";
import {
  OverUnderInputSchema,
  OverUnderOutputSchema,
  type OverUnderInput,
  type OverUnderOutput,
} from "./schemas";
import { buildUserMessage } from "./user-message";

// Versão do cartucho over/under. BUMP MAJOR v1.3 → v2.0 pela reestruturação em
// cartucho (ADR 0017). O PAYLOAD é byte-idêntico ao v1.3 (puro restructure) — o
// eval pago é no-op informativo pra ESTE bump.
export const OVER_UNDER_VERSION = "over_under_v2.0" as const;

// Re-exports nomeados: predict.ts importa `buildPredictionInput`/`BuildInputError`
// como BINDINGS DE MÓDULO (não via o objeto do cartucho) pra que os spies do
// teste (vi.spyOn deste módulo) interceptem a chamada real.
export {
  buildPredictionInput,
  BuildInputError,
  OverUnderInputSchema,
  OverUnderOutputSchema,
  SUBMIT_PREDICTION_TOOL,
  SYSTEM_PROMPT,
  buildUserMessage,
};
export type { BuildPredictionInputArgs, OverUnderInput, OverUnderOutput };

export const overUnderCartridge: MarketCartridge<
  OverUnderInput,
  OverUnderOutput,
  BuildPredictionInputArgs
> = {
  marketKey: "over_under",
  version: OVER_UNDER_VERSION,
  systemPrompt: SYSTEM_PROMPT,
  tool: SUBMIT_PREDICTION_TOOL as unknown as Anthropic.Tool,
  toolName: SUBMIT_PREDICTION_TOOL.name,
  inputSchema: OverUnderInputSchema,
  outputSchema: OverUnderOutputSchema,
  buildPredictionInput,
  BuildInputError,
  buildUserMessage,
  selections: OVER_UNDER.selectionKeys,
  descriptor: OVER_UNDER,
};
