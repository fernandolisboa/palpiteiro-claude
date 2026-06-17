import type Anthropic from "@anthropic-ai/sdk";

import { ANYTIME_SCORER } from "@/lib/odds/market-descriptor";

import type { MarketCartridge } from "../types";
import {
  buildScorerInput,
  BuildInputError,
  type BuildPredictionInputArgs,
} from "../_scorer_shared/build-input";
import {
  buildScorerSystemPrompt,
  buildScorerTool,
} from "../_scorer_shared/prompt";
import {
  ScorerInputSchema,
  ScorerOutputSchema,
  type ScorerInput,
  type ScorerOutput,
} from "../_scorer_shared/schemas";
import { buildScorerUserMessage } from "../_scorer_shared/user-message";

// Versão do cartucho de artilheiro (anytime scorer). 1ª versão (ADR 0017), bare _v1.
export const ANYTIME_SCORER_VERSION = "anytime_scorer_v1" as const;

const COPY = {
  marketNoun: "artilheiro (marcar a qualquer momento)",
  eventDescription: "marcar pelo menos um gol no tempo regulamentar (90')",
  shortVerb: "marcar",
} as const;

const SYSTEM_PROMPT = buildScorerSystemPrompt(COPY);
const SUBMIT_PREDICTION_TOOL = buildScorerTool(COPY);

function buildPredictionInput(args: BuildPredictionInputArgs): ScorerInput {
  return buildScorerInput(args);
}

function buildUserMessage(
  input: ScorerInput,
  ctx: { daysToKickoff: number },
): string {
  return buildScorerUserMessage(input, ctx, {
    oddsHeading: "Odds e probabilidades implícitas (artilheiro — marcar a qualquer momento)",
    taskVerb: "marcar",
  });
}

// Re-exports nomeados (LOAD-BEARING pro vi.spyOn dos testes do predict; espelha
// correct_score/match_result).
export {
  buildPredictionInput,
  BuildInputError,
  ScorerInputSchema,
  ScorerOutputSchema,
  SUBMIT_PREDICTION_TOOL,
  SYSTEM_PROMPT,
  buildUserMessage,
};
export type { BuildPredictionInputArgs, ScorerInput, ScorerOutput };

export const anytimeScorerCartridge: MarketCartridge<
  ScorerInput,
  ScorerOutput,
  BuildPredictionInputArgs
> = {
  marketKey: "anytime_scorer",
  version: ANYTIME_SCORER_VERSION,
  systemPrompt: SYSTEM_PROMPT,
  tool: SUBMIT_PREDICTION_TOOL as unknown as Anthropic.Tool,
  toolName: SUBMIT_PREDICTION_TOOL.name,
  inputSchema: ScorerInputSchema,
  outputSchema: ScorerOutputSchema,
  buildPredictionInput,
  BuildInputError,
  buildUserMessage,
  // independent_binary: a prob `yes` POR jogador alimenta a grade N-vias direto.
  selectionProbs(output) {
    return output.player_probs;
  },
  // Seleções DINÂMICAS (crescem lazy via ensureScorerSelections) — descriptor
  // selectionKeys é []; o predict thread as keys do bundle de odds.
  selections: ANYTIME_SCORER.selectionKeys,
  descriptor: ANYTIME_SCORER,
};
