import Anthropic from "@anthropic-ai/sdk";

// `getAnthropicClient` importado do SHIM `@/lib/ai/anthropic`, NÃO de `./client`:
// é o especificador que TODOS os harnesses de predict mockam (predict.test.ts:132
// `vi.mock("@/lib/ai/anthropic", ...)`). Importar de `./client` perderia o mock →
// chamada paga real / throw de key nos testes. LOAD-BEARING — não troque por `./client`.
// `hasKey` NÃO faz parte do boundary mockado (é só leitura de env, nunca chamada no
// caminho pago), então vem direto de `./client` — senão o mock estrito do vitest 4,
// que só exporta getAnthropicClient, estouraria com "No hasKey export".
import { getAnthropicClient } from "@/lib/ai/anthropic";
import { hasKey } from "./client";

import type {
  AIProvider,
  AnalysisRequest,
  AnalysisResult,
} from "../types";
import { classifyAnthropicError, serializeAnthropicError } from "./errors";
import { buildAnthropicRequest } from "./request-builder";

// Coage o uso de tokens a inteiro finito ≥0 (anti-NaN em `calculateCost` →
// `costUsd` numeric NOT NULL). Identidade pros valores inteiros que a Anthropic
// sempre devolve; relevante de fato no #231 (OpenAI).
function coerceTokens(n: number): number {
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function runAnalysis(
  request: AnalysisRequest,
): Promise<AnalysisResult> {
  // Down-map do `ToolDef` neutro pro shape do SDK (`{name, description,
  // input_schema}`). Verificado (#230): todo literal de tool dos 6 cartuchos tem
  // EXATAMENTE esses 3 campos, então o round-trip é identidade — o golden-payload
  // de predict.test.ts trava isso.
  const tool = {
    name: request.tool.name,
    description: request.tool.description,
    input_schema: request.tool.inputSchema,
  } as unknown as Anthropic.Tool;

  const anthropicRequest = buildAnthropicRequest({
    model: request.model,
    system: request.system,
    userMessage: request.userMessage,
    tools: [tool],
    toolName: request.toolName,
    maxTokens: request.maxTokens,
    effort: request.effort,
    temperature: request.temperature,
  });
  // Mesmo objeto logado em ai_calls.inputPayload e enviado na chamada paga (==
  // o cast pré-seam de predict.ts:786, byte-idêntico).
  const inputPayload = anthropicRequest as unknown as Record<string, unknown>;

  const client = getAnthropicClient();
  // Cronômetro TIGHT: começa imediatamente antes da chamada paga e para logo
  // depois — NÃO inclui buildAnthropicRequest/getAnthropicClient (espelha o span
  // de predict.ts:790-814 pré-seam, pra `latencyMs` ficar byte-idêntico).
  const start = performance.now();
  let response: Anthropic.Message;
  try {
    response = await client.messages.create(anthropicRequest);
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const classified = classifyAnthropicError(err);
    return {
      ok: false,
      status: classified.status,
      message: classified.message,
      cause: err,
      usage: { inputTokens: 0, outputTokens: 0 },
      inputPayload,
      outputPayload: { error: serializeAnthropicError(err) },
      stopReason: null,
      latencyMs,
    };
  }
  const latencyMs = Math.round(performance.now() - start);
  // `outputPayload` == o cast pré-seam de predict.ts:817 (byte-idêntico). O
  // tool_missing snippet de predict lê `.content` daqui.
  const outputPayload = response as unknown as Record<string, unknown>;

  // Extração do tool_use block: `toolInput` cru (Zod roda em predict). `undefined`
  // ⇒ predict classifica como tool_missing (dono dessa decisão).
  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === request.toolName,
  );

  return {
    ok: true,
    toolInput: toolUse?.input,
    usage: {
      inputTokens: coerceTokens(response.usage.input_tokens),
      outputTokens: coerceTokens(response.usage.output_tokens),
    },
    inputPayload,
    outputPayload,
    stopReason: response.stop_reason ?? null,
    latencyMs,
  };
}

export const anthropicProvider: AIProvider = {
  providerKey: "anthropic",
  hasKey,
  runAnalysis,
};
