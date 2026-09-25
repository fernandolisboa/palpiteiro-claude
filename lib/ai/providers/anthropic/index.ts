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
  AnalysisErr,
  AnalysisRequest,
  AnalysisResult,
  AnalysisUsage,
} from "../types";
import {
  classifyAnthropicError,
  type ModelRefusalError,
  refusalFromMessage,
  serializeAnthropicError,
} from "./errors";
import { buildAnthropicRequest } from "./request-builder";
import { requestTiming } from "./timeouts";

// Sinal interno: o prazo do run acabou antes da chamada (nada foi enviado).
class NoBudgetError extends Error {
  constructor() {
    super("deadline exceeded before the call; nothing was sent");
    this.name = "NoBudgetError";
  }
}

// A chamada paga, com timeout/retries por request (requestTiming): adaptive escala
// o timeout por max_tokens/effort; com prazo, os dois são cortados pelo restante.
// Temperature sem prazo chama com 1 argumento só, como sempre.
//
// TOKENS NUM TIMEOUT: a chamada é não-streaming, então um timeout (do SDK ou do
// prazo) não devolve `usage` nenhum — os tokens NÃO são conhecíveis e a row de
// ai_calls grava 0/0 com `usageUnknown: true` no outputPayload. A API pode ter
// cobrado a geração parcial; o custo real só aparece no console da Anthropic.
function createMessage(
  client: ReturnType<typeof getAnthropicClient>,
  params: Anthropic.MessageCreateParamsNonStreaming,
  request: AnalysisRequest,
): Promise<Anthropic.Message> {
  const timing = requestTiming({
    thinkingMode: request.model.thinkingMode,
    maxTokens: request.maxTokens,
    effort: request.effort,
    deadlineAt: request.deadlineAt,
  });
  if (timing.kind === "no-budget") return Promise.reject(new NoBudgetError());
  return timing.kind === "options"
    ? client.messages.create(params, timing.options)
    : client.messages.create(params);
}

// Falha de uma chamada que não devolveu corpo (erro do SDK, timeout, sem prazo).
function callFailure(args: {
  err: unknown;
  usage: AnalysisUsage;
  inputPayload: Record<string, unknown>;
  stopReason: string | null;
  latencyMs: number;
}): AnalysisErr {
  if (args.err instanceof NoBudgetError) {
    return {
      ok: false,
      status: "timeout",
      message: args.err.message,
      cause: args.err,
      usage: args.usage,
      inputPayload: args.inputPayload,
      outputPayload: { error: serializeAnthropicError(args.err) },
      stopReason: args.stopReason,
      latencyMs: args.latencyMs,
    };
  }
  const classified = classifyAnthropicError(args.err);
  return {
    ok: false,
    status: classified.status,
    message: classified.message,
    cause: args.err,
    usage: args.usage,
    inputPayload: args.inputPayload,
    outputPayload: {
      error: serializeAnthropicError(args.err),
      // Timeout não traz usage (ver createMessage): tokens desconhecidos, não zero.
      ...(classified.status === "timeout" ? { usageUnknown: true } : {}),
    },
    stopReason: args.stopReason,
    latencyMs: args.latencyMs,
  };
}

// Recusa do modelo (#524) → falha TIPADA, não sucesso sem tool. Checada ANTES de
// ler `content`. `status` fica `provider_error` (o enum de ai_calls não ganha valor
// novo); `refusal` + `cause: ModelRefusalError` deixam o caller dar a mensagem certa.
// O outputPayload é a resposta crua (auditoria) e `usage` são os tokens cobrados.
function refusalResult(args: {
  refusal: ModelRefusalError;
  response: Anthropic.Message;
  usage: AnalysisUsage;
  inputPayload: Record<string, unknown>;
  latencyMs: number;
}): AnalysisErr {
  return {
    ok: false,
    status: "provider_error",
    message: args.refusal.message,
    cause: args.refusal,
    refusal: {
      category: args.refusal.category,
      explanation: args.refusal.explanation,
    },
    usage: args.usage,
    inputPayload: args.inputPayload,
    outputPayload: args.response as unknown as Record<string, unknown>,
    stopReason: "refusal",
    latencyMs: args.latencyMs,
  };
}

// Coage o uso de tokens a inteiro finito ≥0 (anti-NaN em `calculateCost` →
// `costUsd` numeric NOT NULL). Identidade pros valores inteiros que a Anthropic
// sempre devolve; relevante de fato no #231 (OpenAI).
function coerceTokens(n: number): number {
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Teto de continuações do laço de pause_turn (ADR 0032 / #377). A server-tool loop da
// Claude para em `stop_reason: "pause_turn"` quando bate o limite interno de iterações;
// retomamos reenviando [user, {assistant, content}] SEM mensagem "Continue". Bounded pra
// nunca queimar tokens num laço infinito.
const MAX_PAUSE_CONTINUATIONS = 3;

async function runAnalysis(
  request: AnalysisRequest,
): Promise<AnalysisResult> {
  // RAMO SERVER-TOOL (ADR 0032, #377). ADITIVO: só quando `serverTool` está setado
  // (provider de notícias). O caminho forçado abaixo fica BYTE-IDÊNTICO — os golden
  // payload tests (request-builder.test.ts / predict.test.ts) seguem verdes.
  if (request.serverTool) {
    return runServerToolAnalysis(request);
  }
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
    response = await createMessage(client, anthropicRequest, request);
  } catch (err) {
    return callFailure({
      err,
      usage: { inputTokens: 0, outputTokens: 0 },
      inputPayload,
      stopReason: null,
      latencyMs: Math.round(performance.now() - start),
    });
  }
  const latencyMs = Math.round(performance.now() - start);
  const usage = {
    inputTokens: coerceTokens(response.usage.input_tokens),
    outputTokens: coerceTokens(response.usage.output_tokens),
  };
  const refusal = refusalFromMessage(response);
  if (refusal) {
    return refusalResult({ refusal, response, usage, inputPayload, latencyMs });
  }
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
    usage,
    inputPayload,
    outputPayload,
    stopReason: response.stop_reason ?? null,
    latencyMs,
  };
}

// Caminho SERVER-TOOL (ADR 0032 / #377). Espelha o cronômetro/coerção/serialização do
// caminho forçado, mas: (a) tool_choice:auto + a web search tool (request-builder); (b)
// laço bounded de pause_turn (reenvia [user, {assistant, content}] sem "Continue"); (c)
// devolve `contentBlocks` (os blocos crus da resposta FINAL) pro provider de notícias
// andar atrás dos `web_search_tool_result`. NÃO extrai/valida nada aqui — o provider faz.
async function runServerToolAnalysis(
  request: AnalysisRequest,
): Promise<AnalysisResult> {
  const anthropicRequest = buildAnthropicRequest({
    model: request.model,
    system: request.system,
    userMessage: request.userMessage,
    // Tool forçado IGNORADO no modo server-tool (passamos um array vazio; o builder
    // monta a web search tool a partir de `serverTool`).
    tools: [],
    toolName: request.toolName,
    maxTokens: request.maxTokens,
    effort: request.effort,
    temperature: request.temperature,
    serverTool: request.serverTool,
  });
  const inputPayload = anthropicRequest as unknown as Record<string, unknown>;

  const client = getAnthropicClient();
  const start = performance.now();
  let response: Anthropic.Message;
  try {
    response = await createMessage(client, anthropicRequest, request);
  } catch (err) {
    return callFailure({
      err,
      usage: { inputTokens: 0, outputTokens: 0 },
      inputPayload,
      stopReason: null,
      latencyMs: Math.round(performance.now() - start),
    });
  }

  // Laço bounded de pause_turn: a server-tool loop pausa quando bate o limite interno;
  // retomamos reenviando o histórico ([user, {assistant, content}]) SEM "Continue" — a
  // API detecta o server_tool_use pendente e resume sozinha. Acumula tokens das rodadas.
  let inputTokens = coerceTokens(response.usage.input_tokens);
  let outputTokens = coerceTokens(response.usage.output_tokens);
  let continuations = 0;
  while (
    response.stop_reason === "pause_turn" &&
    continuations < MAX_PAUSE_CONTINUATIONS
  ) {
    continuations += 1;
    let next: Anthropic.Message;
    try {
      next = await createMessage(
        client,
        {
          ...anthropicRequest,
          messages: [
            { role: "user", content: request.userMessage },
            { role: "assistant", content: response.content },
          ],
        },
        request,
      );
    } catch (err) {
      return callFailure({
        err,
        usage: { inputTokens, outputTokens },
        inputPayload,
        stopReason: response.stop_reason ?? null,
        latencyMs: Math.round(performance.now() - start),
      });
    }
    response = next;
    inputTokens += coerceTokens(response.usage.input_tokens);
    outputTokens += coerceTokens(response.usage.output_tokens);
  }
  const latencyMs = Math.round(performance.now() - start);
  const refusal = refusalFromMessage(response);
  if (refusal) {
    return refusalResult({
      refusal,
      response,
      usage: { inputTokens, outputTokens },
      inputPayload,
      latencyMs,
    });
  }
  const outputPayload = response as unknown as Record<string, unknown>;

  return {
    ok: true,
    // Sem submit forçado no modo server-tool — `toolInput` não se aplica.
    toolInput: undefined,
    usage: { inputTokens, outputTokens },
    inputPayload,
    outputPayload,
    stopReason: response.stop_reason ?? null,
    latencyMs,
    contentBlocks: response.content,
  };
}

export const anthropicProvider: AIProvider = {
  providerKey: "anthropic",
  hasKey,
  runAnalysis,
};
