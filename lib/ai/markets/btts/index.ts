import type Anthropic from "@anthropic-ai/sdk";

import { BTTS } from "@/lib/odds/market-descriptor";

import type { MarketCartridge } from "../types";
import {
  buildPredictionInput,
  BuildInputError,
  type BuildPredictionInputArgs,
} from "./build-input";
import { SUBMIT_PREDICTION_TOOL, SYSTEM_PROMPT } from "./prompt";
import {
  BttsInputSchema,
  BttsOutputSchema,
  type BttsInput,
  type BttsOutput,
} from "./schemas";
import { buildUserMessage } from "./user-message";

// Versão do cartucho btts (ADR 0017: versionamento por cartucho). Bare `_v1`
// (sem .0), espelhando match_result_v1.
export const BTTS_VERSION = "btts_v1" as const;

// Re-exports nomeados: predict.ts importa `buildPredictionInput`/`BuildInputError`
// como BINDINGS DE MÓDULO (não via o objeto do cartucho) pra que os spies do
// teste (vi.spyOn deste módulo) interceptem a chamada real.
export {
  buildPredictionInput,
  BuildInputError,
  BttsInputSchema,
  BttsOutputSchema,
  SUBMIT_PREDICTION_TOOL,
  SYSTEM_PROMPT,
  buildUserMessage,
};
export type { BuildPredictionInputArgs, BttsInput, BttsOutput };

export const bttsCartridge: MarketCartridge<
  BttsInput,
  BttsOutput,
  BuildPredictionInputArgs
> = {
  marketKey: "btts",
  version: BTTS_VERSION,
  systemPrompt: SYSTEM_PROMPT,
  tool: SUBMIT_PREDICTION_TOOL as unknown as Anthropic.Tool,
  toolName: SUBMIT_PREDICTION_TOOL.name,
  inputSchema: BttsInputSchema,
  outputSchema: BttsOutputSchema,
  buildPredictionInput,
  BuildInputError,
  buildUserMessage,
  // Deriva P_yes/P_no do output binário (função PURA — não toca prompt/schema,
  // eval-noop). Convenção do confidence_pct (ver schemas.ts): em yes/no é
  // P(lado recomendado); em pass é P(yes). Logo:
  //   - rec "yes"  → {yes: conf,        no: 100−conf}
  //   - rec "no"   → {no: conf,         yes: 100−conf}
  //   - rec "pass" → {yes: conf,        no: 100−conf}  (conf = P(yes))
  selectionProbs(output) {
    const conf = output.confidence_pct;
    if (output.recommendation === "no") {
      return { yes: 100 - conf, no: conf };
    }
    // "yes" e "pass" tratam conf como P(yes) (ver convenção do schema).
    return { yes: conf, no: 100 - conf };
  },
  selections: BTTS.selectionKeys,
  descriptor: BTTS,
};
