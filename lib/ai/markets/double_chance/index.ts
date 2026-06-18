
import { DOUBLE_CHANCE } from "@/lib/odds/market-descriptor";

import { type MarketCartridge, toToolDef } from "../types";
import {
  buildPredictionInput,
  BuildInputError,
  type BuildPredictionInputArgs,
} from "./build-input";
import { SUBMIT_PREDICTION_TOOL, SYSTEM_PROMPT } from "./prompt";
import {
  DoubleChanceInputSchema,
  DoubleChanceOutputSchema,
  type DoubleChanceInput,
  type DoubleChanceOutput,
} from "./schemas";
import { buildUserMessage } from "./user-message";

// Versão do cartucho dupla chance (double_chance). Primeira versão (ADR 0017).
export const DOUBLE_CHANCE_VERSION = "double_chance_v1" as const;

// Re-exports nomeados: espelha match_result pra paridade de spy nos testes
// (vi.spyOn deste módulo intercepta a chamada real do binding).
export {
  buildPredictionInput,
  BuildInputError,
  DoubleChanceInputSchema,
  DoubleChanceOutputSchema,
  SUBMIT_PREDICTION_TOOL,
  SYSTEM_PROMPT,
  buildUserMessage,
};
export type { BuildPredictionInputArgs, DoubleChanceInput, DoubleChanceOutput };

export const doubleChanceCartridge: MarketCartridge<
  DoubleChanceInput,
  DoubleChanceOutput,
  BuildPredictionInputArgs
> = {
  marketKey: "double_chance",
  version: DOUBLE_CHANCE_VERSION,
  systemPrompt: SYSTEM_PROMPT,
  tool: toToolDef(SUBMIT_PREDICTION_TOOL),
  toolName: SUBMIT_PREDICTION_TOOL.name,
  inputSchema: DoubleChanceInputSchema,
  outputSchema: DoubleChanceOutputSchema,
  buildPredictionInput,
  BuildInputError,
  buildUserMessage,
  // OPTION B: a DISTRIBUIÇÃO honesta de cada dupla alimenta a grade N-vias direto.
  // As probs se SOBREPÕEM e somam ~200% (cada par cobre 2 de 3 resultados); a
  // implícita vem na MESMA escala (de-vig Σ=2 via descriptor.impliedSumTarget),
  // então o edge por dupla é honesto. SEM normalizar / SEM complemento binário.
  selectionProbs(output) {
    return {
      home_or_draw: output.prob_home_or_draw,
      away_or_draw: output.prob_away_or_draw,
      home_or_away: output.prob_home_or_away,
    };
  },
  selections: DOUBLE_CHANCE.selectionKeys,
  descriptor: DOUBLE_CHANCE,
};
