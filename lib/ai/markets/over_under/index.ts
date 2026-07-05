
import { OVER_UNDER } from "@/lib/odds/market-descriptor";

import { type MarketCartridge, toToolDef } from "../types";
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
// cartucho (ADR 0017). BUMP MINOR v2.0 → v2.1 (#226, ADR 0026): proveniência de
// desfalques (`fonte` no user-message + regra de ponderação por source no prompt).
// O payload MUDOU (campo `source` opcional nas absences) — rodar o replay-eval.
export const OVER_UNDER_VERSION = "over_under_v2.2" as const;

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
  tool: toToolDef(SUBMIT_PREDICTION_TOOL),
  toolName: SUBMIT_PREDICTION_TOOL.name,
  inputSchema: OverUnderInputSchema,
  outputSchema: OverUnderOutputSchema,
  buildPredictionInput,
  BuildInputError,
  buildUserMessage,
  // Deriva P_over/P_under do output binário (função PURA — não toca prompt/schema,
  // eval-noop). Convenção do confidence_pct (ver schemas.ts): em over/under é
  // P(lado recomendado); em pass é P(over). Logo:
  //   - rec "over"  → {over: conf,        under: 100−conf}
  //   - rec "under" → {under: conf,       over: 100−conf}
  //   - rec "pass"  → {over: conf,        under: 100−conf}  (conf = P(over))
  selectionProbs(output) {
    const conf = output.confidence_pct;
    if (output.recommendation === "under") {
      return { over: 100 - conf, under: conf };
    }
    // "over" e "pass" tratam conf como P(over) (ver convenção do schema).
    return { over: conf, under: 100 - conf };
  },
  selections: OVER_UNDER.selectionKeys,
  descriptor: OVER_UNDER,
};
