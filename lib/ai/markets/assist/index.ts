
import { ASSIST } from "@/lib/odds/market-descriptor";

import { type MarketCartridge, toToolDef } from "../types";
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

// Versão do cartucho de assistência. 1ª versão (ADR 0017), bare _v1.
export const ASSIST_VERSION = "assist_v1" as const;

const COPY = {
  marketNoun: "assistência (dar uma assistência a qualquer momento)",
  eventDescription: "dar pelo menos uma assistência no tempo regulamentar (90')",
  shortVerb: "dar uma assistência",
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
    oddsHeading: "Odds e probabilidades implícitas (assistência — a qualquer momento)",
    taskVerb: "dar uma assistência",
  });
}

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

export const assistCartridge: MarketCartridge<
  ScorerInput,
  ScorerOutput,
  BuildPredictionInputArgs
> = {
  marketKey: "assist",
  version: ASSIST_VERSION,
  systemPrompt: SYSTEM_PROMPT,
  tool: toToolDef(SUBMIT_PREDICTION_TOOL),
  toolName: SUBMIT_PREDICTION_TOOL.name,
  inputSchema: ScorerInputSchema,
  outputSchema: ScorerOutputSchema,
  buildPredictionInput,
  BuildInputError,
  buildUserMessage,
  selectionProbs(output) {
    return output.player_probs;
  },
  selections: ASSIST.selectionKeys,
  descriptor: ASSIST,
};
