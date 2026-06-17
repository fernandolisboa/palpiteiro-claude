import type Anthropic from "@anthropic-ai/sdk";

import { CORRECT_SCORE } from "@/lib/odds/market-descriptor";

import type { MarketCartridge } from "../types";
import {
  buildPredictionInput,
  BuildInputError,
  type BuildPredictionInputArgs,
} from "./build-input";
import { SUBMIT_PREDICTION_TOOL, SYSTEM_PROMPT } from "./prompt";
import {
  CorrectScoreInputSchema,
  CorrectScoreOutputSchema,
  type CorrectScoreInput,
  type CorrectScoreOutput,
} from "./schemas";
import { buildUserMessage } from "./user-message";

// Versão do cartucho de placar exato (correct_score). Primeira versão do mercado
// (ADR 0017), bare _v1 — espelha match_result_v1.
export const CORRECT_SCORE_VERSION = "correct_score_v1" as const;

// Re-exports nomeados: espelha match_result pra paridade de spy nos testes
// (vi.spyOn deste módulo intercepta a chamada real do binding). LOAD-BEARING —
// predict.ts importa estes como bindings de módulo.
export {
  buildPredictionInput,
  BuildInputError,
  CorrectScoreInputSchema,
  CorrectScoreOutputSchema,
  SUBMIT_PREDICTION_TOOL,
  SYSTEM_PROMPT,
  buildUserMessage,
};
export type { BuildPredictionInputArgs, CorrectScoreInput, CorrectScoreOutput };

export const correctScoreCartridge: MarketCartridge<
  CorrectScoreInput,
  CorrectScoreOutput,
  BuildPredictionInputArgs
> = {
  marketKey: "correct_score",
  version: CORRECT_SCORE_VERSION,
  systemPrompt: SYSTEM_PROMPT,
  tool: SUBMIT_PREDICTION_TOOL as unknown as Anthropic.Tool,
  toolName: SUBMIT_PREDICTION_TOOL.name,
  inputSchema: CorrectScoreInputSchema,
  outputSchema: CorrectScoreOutputSchema,
  buildPredictionInput,
  BuildInputError,
  buildUserMessage,
  // OPTION B: a DISTRIBUIÇÃO completa do output alimenta a grade N-vias direto —
  // cada célula carrega sua própria prob do modelo (sem complemento binário).
  // cell_probs já é o record keyed por selectionKey (cs_0_0..cs_3_3).
  selectionProbs(output) {
    return output.cell_probs;
  },
  // Grid estática (16 células) — SEM resolveParams (correct_score não carrega linha).
  selections: CORRECT_SCORE.selectionKeys,
  descriptor: CORRECT_SCORE,
};
