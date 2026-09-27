
import { OVER_UNDER_ALT } from "@/lib/odds/market-descriptor";

import { type MarketCartridge, toToolDef } from "../types";
import {
  buildPredictionInputV3,
  BuildInputError,
  type BuildPredictionInputArgs,
} from "./build-input";
import { SUBMIT_PREDICTION_TOOL_V3, SYSTEM_PROMPT_V3 } from "./prompt-v3";
import {
  OverUnderInputV3Schema,
  OverUnderOutputV3Schema,
  type OverUnderInputV3,
  type OverUnderOutputV3,
} from "./schemas";
import { buildUserMessageV3 } from "./user-message-v3";

// Versão do cartucho over/under MULTI-LINHA (#175). Bump MAJOR v2.0 → v3.0: o
// payload MUDOU (escada 1.5/2.5/3.5 + campo `line` no output) — não é restructure
// no-op. Selecionado SÓ via getCartridge('over_under', { extraLines: true }); o
// caminho default continua no v2 (byte-idêntico).
// BUMP MINOR v3.0 → v3.1 (#226, ADR 0026): proveniência de desfalques (`fonte` no
// user-message compartilhado + regra de ponderação por source no prompt-v3).
// BUMP MINOR v3.2 → v3.3 (ADR 0051): baseline por linha vindo do Dixon-Coles, como o
// v2.3. Prompt e mensagem byte-idênticos.
export const OVER_UNDER_V3_VERSION = "over_under_v3.3" as const;

export {
  buildPredictionInputV3,
  OverUnderInputV3Schema,
  OverUnderOutputV3Schema,
  SUBMIT_PREDICTION_TOOL_V3,
  SYSTEM_PROMPT_V3,
  buildUserMessageV3,
};
export type { OverUnderInputV3, OverUnderOutputV3 };

export const overUnderCartridgeV3: MarketCartridge<
  OverUnderInputV3,
  OverUnderOutputV3,
  BuildPredictionInputArgs
> = {
  marketKey: "over_under",
  version: OVER_UNDER_V3_VERSION,
  systemPrompt: SYSTEM_PROMPT_V3,
  tool: toToolDef(SUBMIT_PREDICTION_TOOL_V3),
  toolName: SUBMIT_PREDICTION_TOOL_V3.name,
  inputSchema: OverUnderInputV3Schema,
  outputSchema: OverUnderOutputV3Schema,
  buildPredictionInput: buildPredictionInputV3,
  BuildInputError,
  buildUserMessage: buildUserMessageV3,
  // Lógica binária IDÊNTICA ao v2 (over/under) — copiada pra não acoplar os cartuchos.
  // Convenção do confidence_pct: P(lado recomendado) em over/under; P(over) em pass.
  //   - rec "over"  → {over: conf,  under: 100−conf}
  //   - rec "under" → {under: conf, over: 100−conf}
  //   - rec "pass"  → {over: conf,  under: 100−conf}  (conf = P(over))
  selectionProbs(output) {
    const conf = output.confidence_pct;
    if (output.recommendation === "under") {
      return { over: 100 - conf, under: conf };
    }
    return { over: conf, under: 100 - conf };
  },
  // Multi-linha: a linha NÃO é estática no descriptor — vem da escolha do LLM.
  // predict persiste marketParams.line DAQUI (cai em settlement; ignorada em pass).
  resolveParams: (output) => ({ line: output.line }),
  selections: OVER_UNDER_ALT.selectionKeys,
  descriptor: OVER_UNDER_ALT,
};
