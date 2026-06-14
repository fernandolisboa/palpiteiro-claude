import type Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";

import type { MarketDescriptor } from "@/lib/odds/market-descriptor";

export type UserMessageContext = {
  daysToKickoff: number;
};

/**
 * Shape comum a TODO output de cartucho (gate #9, decisão B). predict.ts narra
 * `parsed.data as BaseMarketOutput` pra ler os campos compartilhados sem `any` e
 * sem ramificar por mercado — `OverUnderOutput`/`MatchResultOutput` são
 * assignáveis a este tipo (têm estes campos + extras próprios). `recommendation`
 * é `string` (não enum fechado): cada cartucho o restringe ao seu próprio enum
 * (`over|under|pass`, `home|draw|away|pass`), mas predict só precisa do valor cru
 * (= selectionKey, ou "pass") pra persistir e calcular edge.
 */
export type BaseMarketOutput = {
  recommendation: string;
  confidence_pct: number;
  rationale: string;
  key_factors: string[];
  minimum_odd?: number;
};

/**
 * Shape GENÉRICO dos args de odds/implied que predict.ts monta UMA vez (a partir
 * do `MarketOddsBundle.selections` + `impliedByKey` sobre `descriptor.selectionKeys`)
 * e passa pro `buildPredictionInput` de QUALQUER cartucho. Cada cartucho DOWN-MAPEIA
 * esse shape no seu input concreto (ex.: over_under → `over_2_5_decimal`/`under_2_5_decimal`).
 * O `Args` de cada cartucho ESTENDE isto (mesmos campos de odds/implied; o resto é
 * dado de sports-data específico). Ver `over_under/build-input.ts`.
 */
export type GenericOddsArgs = {
  bookmaker: string;
  captured_at: string;
  selections: { key: string; odd: number }[];
  // Escada multi-linha (over_under v3.0, #175): odds + implícita do MELHOR book POR
  // linha candidata (1.5/2.5/3.5). Só o build-input do v3 consome; predict deixa
  // `undefined` pra todos os outros cartuchos E pro over_under flag-OFF (single-line).
  // NÃO altera `selections` (par único do caminho legado) — additivo e inerte por default.
  lineLadder?: LineLadderEntry[];
};
export type GenericImpliedArgs = { pct: Record<string, number> };

// Uma linha candidata renderizável pela escada multi-linha (#175): a linha, o
// melhor book daquela linha + odds por seleção + implícita (já de-vigada Σ=1 por
// linha, partição — nunca 1/odd cru). predict monta a partir de um MarketOddsBundle
// por linha; o cartucho v3 a renderiza pro LLM escolher (linha, over|under, stake).
export type LineLadderEntry = {
  line: number;
  bookmaker: string;
  captured_at: string;
  selections: { key: string; odd: number }[];
  impliedPct: Record<string, number>;
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
  // Deriva a probabilidade do MODELO (0–100) por seleção a partir do output do
  // LLM, keyed por selectionKey (= `descriptor.selectionKeys`). Função PURA
  // (não toca prompt/schema/payload) — predict grava `model_prob_pct` por seleção
  // em prediction_selection_odds e alimenta a grade N-vias. binário (over_under)
  // deriva `{[rec]: confidence, [outro]: 100−confidence}`; distribuição (1X2)
  // retorna as 3 probs diretas do output.
  selectionProbs: (output: Output) => Record<string, number>;
  // Deriva os marketParams persistidos (a linha ESCOLHIDA) a partir do output do
  // LLM — usado por mercados MULTI-LINHA (over_under v3.0, #175) onde a linha não é
  // estática no descriptor. Quando presente, predict persiste marketParams DAQUI (a
  // linha escolhida cai em marketParams.line → settlement). Ausente (todos os outros
  // cartuchos + over_under v2.0) → predict usa descriptor.params (caminho de hoje).
  resolveParams?: (output: Output) => { line: number };
  // Conjunto canônico de seleções do mercado (`["over","under"]`). Espelha
  // `descriptor.selectionKeys` — a ordem é o contrato chave→índice do edge N-vias.
  selections: string[];
  // Descriptor local de odds (#164): provider/db market keys, params, resolução
  // de seleção. predict consome `providerMarketKey` (request) e `params` (linha).
  descriptor: MarketDescriptor;
};
