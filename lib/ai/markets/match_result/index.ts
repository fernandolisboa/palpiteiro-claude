import type Anthropic from "@anthropic-ai/sdk";

import { MATCH_RESULT } from "@/lib/odds/market-descriptor";

import type { MarketCartridge } from "../types";
import {
  buildPredictionInput,
  BuildInputError,
  type BuildPredictionInputArgs,
} from "./build-input";
import { SUBMIT_PREDICTION_TOOL, SYSTEM_PROMPT } from "./prompt";
import {
  MatchResultInputSchema,
  MatchResultOutputSchema,
  type MatchResultInput,
  type MatchResultOutput,
} from "./schemas";
import { buildUserMessage } from "./user-message";

// Versão do cartucho 1X2 (match_result). Primeira versão do mercado (ADR 0017).
export const MATCH_RESULT_VERSION = "match_result_v1" as const;

// Re-exports nomeados: espelha over_under pra paridade de spy nos testes
// (vi.spyOn deste módulo intercepta a chamada real do binding).
export {
  buildPredictionInput,
  BuildInputError,
  MatchResultInputSchema,
  MatchResultOutputSchema,
  SUBMIT_PREDICTION_TOOL,
  SYSTEM_PROMPT,
  buildUserMessage,
};
export type { BuildPredictionInputArgs, MatchResultInput, MatchResultOutput };

export const matchResultCartridge: MarketCartridge<
  MatchResultInput,
  MatchResultOutput,
  BuildPredictionInputArgs
> = {
  marketKey: "match_result",
  version: MATCH_RESULT_VERSION,
  systemPrompt: SYSTEM_PROMPT,
  tool: SUBMIT_PREDICTION_TOOL as unknown as Anthropic.Tool,
  toolName: SUBMIT_PREDICTION_TOOL.name,
  inputSchema: MatchResultInputSchema,
  outputSchema: MatchResultOutputSchema,
  buildPredictionInput,
  BuildInputError,
  buildUserMessage,
  // OPTION B: a DISTRIBUIÇÃO completa do output alimenta a grade N-vias direto —
  // cada seleção carrega sua própria prob do modelo (sem complemento binário).
  selectionProbs(output) {
    return {
      home: output.prob_home,
      draw: output.prob_draw,
      away: output.prob_away,
    };
  },
  selections: MATCH_RESULT.selectionKeys,
  descriptor: MATCH_RESULT,
};
