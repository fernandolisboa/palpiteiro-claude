import type Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";

import type { MarketDescriptor } from "@/lib/odds/market-descriptor";

export type UserMessageContext = {
  daysToKickoff: number;
};

/**
 * Contrato de UM cartucho de mercado: tudo que `predict()` precisa pra rodar uma
 * análise market-agnostic (prompt + tool + schemas + montagem do input/mensagem
 * + descriptor de odds). predict.ts despacha por `marketKey` via `getCartridge`
 * (registry.ts) e NUNCA ramifica por `if (market === X)`.
 *
 * over/under é o PRIMEIRO cartucho (Tier 1); o segundo (1X2/BTTS) fatora a
 * camada-base. Por ora a estrutura é a do over/under, byte-idêntica ao v1.3.
 *
 * `Input`/`Output`/`Args` ficam genéricos: cada cartucho instancia com seus
 * próprios tipos concretos (ver `over_under/index.ts`).
 */
export type MarketCartridge<
  Input = unknown,
  Output = unknown,
  Args = unknown,
> = {
  // Chave de despacho do registry (`"over_under"`). NÃO é o enum legado
  // `match_odds_snapshots.market = 'over_under_2_5'`.
  marketKey: string;
  // Versão semver-like do cartucho (ADR 0017). Gravada em ai_calls.promptVersion
  // e predictions.promptVersion. Ex.: `"over_under_v2.0"`.
  version: string;
  // SYSTEM_PROMPT byte-idêntico ao do prompt versionado original.
  systemPrompt: string;
  // Tool definition (já no shape do Anthropic SDK) + o nome usado no tool_choice
  // e na extração do tool_use block.
  tool: Anthropic.Tool;
  toolName: string;
  // Schema Zod do input montado (validado em buildPredictionInput) + schema do
  // output do LLM (validado sempre, antes de qualquer uso — fronteira do CLAUDE.md).
  inputSchema: ZodType<Input>;
  outputSchema: ZodType<Output>;
  // Monta o input tipado a partir dos dados normalizados (sports-data + odds);
  // lança BuildInputError em dados insuficientes (ex.: standings faltando).
  // predict.ts chama o BINDING DE MÓDULO (import nomeado) pra que os spies do
  // teste (vi.spyOn) interceptem; este campo é a mesma função, exposta no contrato.
  buildPredictionInput: (args: Args) => Input;
  // Classe de erro de montagem do input — predict.ts faz `instanceof` no catch.
  BuildInputError: new (
    message: string,
    context?: Record<string, unknown>,
  ) => Error;
  // Renderiza a mensagem markdown do usuário a partir do input validado.
  buildUserMessage: (input: Input, ctx: UserMessageContext) => string;
  // Conjunto canônico de seleções do mercado (`["over","under"]`). Espelha
  // `descriptor.selectionKeys` — a ordem é o contrato chave→índice do edge N-vias.
  selections: string[];
  // Descriptor local de odds (#164): provider/db market keys, params, resolução
  // de seleção. predict consome `providerMarketKey` (request) e `params` (linha).
  descriptor: MarketDescriptor;
};
