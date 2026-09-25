import { toToolDef } from "../types";
import { buildNarratorContext } from "./context";
import { templatedNarration } from "./fallback";
import { checkNarrationFidelity } from "./fidelity";
import {
  describeAbsencePt,
  judgmentFactorPhrases,
  selectionLabel,
} from "./labels";
import {
  NARRATOR_VERSION,
  SUBMIT_NARRATION_TOOL,
  SYSTEM_PROMPT,
} from "./prompt";
import { NarratorOutputSchema, type NarratorOutput } from "./schemas";
import type {
  NarratorContext,
  NarratorDecision,
  NarratorSelection,
} from "./types";
import { buildNarratorMessage } from "./user-message";

// Cartucho narrador (ADR 0041 §4). Não é um mercado (fica fora do registry, como
// _scorer_shared): o predict o usa no motor code_jev pra narrar a decisão do
// código, pelo mesmo seam AIProvider e com o mesmo logging em ai_calls.
export const narratorCartridge = {
  version: NARRATOR_VERSION,
  systemPrompt: SYSTEM_PROMPT,
  tool: toToolDef(SUBMIT_NARRATION_TOOL),
  toolName: SUBMIT_NARRATION_TOOL.name,
  outputSchema: NarratorOutputSchema,
  buildUserMessage: buildNarratorMessage,
  checkFidelity: checkNarrationFidelity,
  fallback: templatedNarration,
} as const;

export {
  buildNarratorContext,
  buildNarratorMessage,
  checkNarrationFidelity,
  describeAbsencePt,
  judgmentFactorPhrases,
  NARRATOR_VERSION,
  NarratorOutputSchema,
  selectionLabel,
  SUBMIT_NARRATION_TOOL,
  SYSTEM_PROMPT,
  templatedNarration,
};
export type {
  NarratorContext,
  NarratorDecision,
  NarratorOutput,
  NarratorSelection,
};
