import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";

// getOpenAIClient importado do SHIM @/lib/ai/openai (o especificador mockado por
// openai.test.ts), NÃO de ./client — senão o mock não interceptaria. LOAD-BEARING.
// hasKey vem direto de ./client (fora do boundary mockado).
import { getOpenAIClient } from "@/lib/ai/openai";
import { hasKey } from "./client";

import type {
  AIProvider,
  AnalysisRequest,
  AnalysisResult,
} from "../types";
import { classifyOpenAIError, serializeOpenAIError } from "./errors";

// Coage o uso de tokens a inteiro finito ≥0 (anti-NaN em calculateCost → costUsd
// numeric NOT NULL). completion_tokens da OpenAI JÁ inclui os reasoning tokens
// (itemizados em completion_tokens_details.reasoning_tokens) — NÃO somar de novo.
function coerceTokens(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0;
}

async function runAnalysis(
  request: AnalysisRequest,
): Promise<AnalysisResult> {
  // ToolDef → função OpenAI. strict:false é uma limitação DELIBERADA da PoC: o tool
  // over_under tem additionalProperties:false MAS omite minimum_odd de `required`, e
  // o strict:true (Structured Outputs) exige todas as keys em `required` → daria 400.
  // A garantia real do output continua sendo o Zod em predict (cartridge.outputSchema).
  const openaiRequest: ChatCompletionCreateParamsNonStreaming = {
    model: request.model.id,
    messages: [
      { role: "system", content: request.system },
      { role: "user", content: request.userMessage },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: request.tool.name,
          description: request.tool.description,
          parameters: request.tool.inputSchema,
          strict: false,
        },
      },
    ],
    tool_choice: { type: "function", function: { name: request.toolName } },
    // gpt-5-mini é modelo de RACIOCÍNIO: usa max_completion_tokens e REJEITA
    // `temperature` → omitida INCONDICIONALMENTE (não keyamos por thinkingMode).
    max_completion_tokens: request.maxTokens,
  };
  const inputPayload = openaiRequest as unknown as Record<string, unknown>;

  const client = getOpenAIClient();
  // Cronômetro TIGHT: só a chamada paga (espelha o adapter Anthropic).
  const start = performance.now();
  let response: ChatCompletion;
  try {
    response = await client.chat.completions.create(openaiRequest);
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const classified = classifyOpenAIError(err);
    return {
      ok: false,
      status: classified.status,
      message: classified.message,
      cause: err,
      usage: { inputTokens: 0, outputTokens: 0 },
      inputPayload,
      outputPayload: { error: serializeOpenAIError(err) },
      stopReason: null,
      latencyMs,
    };
  }
  const latencyMs = Math.round(performance.now() - start);
  const outputPayload = response as unknown as Record<string, unknown>;
  const usage = {
    inputTokens: coerceTokens(response.usage?.prompt_tokens),
    outputTokens: coerceTokens(response.usage?.completion_tokens),
  };
  const choice = response.choices[0];
  const stopReason = choice?.finish_reason ?? null;
  const toolCall = choice?.message?.tool_calls?.find(
    (tc) => tc.type === "function" && tc.function.name === request.toolName,
  );

  // Sem tool call que case ⇒ toolInput undefined ⇒ predict classifica tool_missing
  // (o sentinel undefined significa "modelo não chamou o tool"; um parse bem-sucedido
  // SEMPRE produz valor definido/null, nunca undefined).
  if (!toolCall || toolCall.type !== "function") {
    return {
      ok: true,
      toolInput: undefined,
      usage,
      inputPayload,
      outputPayload,
      stopReason,
      latencyMs,
    };
  }

  // OpenAI: arguments é STRING JSON → JSON.parse. Falha de parse = provider_error
  // (NÃO crash, NÃO invalid_output — vendor devolveu não-JSON no slot de args; é
  // falha de provider, não violação do contrato do modelo que o Zod pegaria).
  let toolInput: unknown;
  try {
    toolInput = JSON.parse(toolCall.function.arguments);
  } catch (err) {
    return {
      ok: false,
      status: "provider_error",
      message: `tool arguments not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      cause: err,
      usage,
      inputPayload,
      outputPayload,
      stopReason,
      latencyMs,
    };
  }

  return {
    ok: true,
    toolInput,
    usage,
    inputPayload,
    outputPayload,
    stopReason,
    latencyMs,
  };
}

export const openaiProvider: AIProvider = {
  providerKey: "openai",
  hasKey,
  runAnalysis,
};
