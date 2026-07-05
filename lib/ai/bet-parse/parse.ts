import { aiCalls } from "@/db/schema";
import { db } from "@/lib/db";
import { persistAiCallError } from "@/lib/ai/ai-call-logging";
import { calculateCost } from "@/lib/ai/cost";
import { MODEL_REGISTRY, isAIProvider } from "@/lib/ai/models";
import { getProviderForModel } from "@/lib/ai/providers";
import type { AnalysisRequest } from "@/lib/ai/providers/types";

import {
  BET_PARSE_SYSTEM_PROMPT,
  BET_PARSE_TOOL_NAME,
  BET_PARSE_VERSION,
  betParseTool,
  buildBetParseUserMessage,
} from "./cartridge";
import {
  BetLegSchema,
  BetParseEnvelopeSchema,
  MAX_LEGS,
  type BetLeg,
} from "./schema";

// Orquestra o parse Haiku via o seam AIProvider (ADR 0027) e loga em `ai_calls`
// — MESMA disciplina de lib/ai/palpites/index.ts (provider→runAnalysis→log com
// returning id), NUNCA SDK direto, NUNCA por predict.ts. O texto já vem capado a
// MAX_RAW_INPUT pelo boundary Zod da action. Devolve as pernas VÁLIDAS + avisos de
// drop-por-perna + o aiCallId (pra o slip carregar parseAiCallId no confirm).

// Modelo econômico do registry (Decisão 2). maxTokens pequeno: o output é um
// envelope minúsculo de pernas.
const BET_PARSE_MODEL = MODEL_REGISTRY["claude-haiku-4-5"];
const BET_PARSE_MAX_TOKENS = 1024;

export type BetParseWarning = { message: string };

export type BetParseResult =
  | {
      ok: true;
      legs: BetLeg[];
      warnings: BetParseWarning[];
      comboUserOdd?: number;
      aiCallId: string | null;
    }
  | { ok: false; status: "parse-falhou"; message: string };

export async function parseBetText(args: {
  rawInput: string;
  matchId: string;
  userId: string;
}): Promise<BetParseResult> {
  const { rawInput, matchId, userId } = args;
  const model = BET_PARSE_MODEL;

  const request: AnalysisRequest = {
    model,
    system: BET_PARSE_SYSTEM_PROMPT,
    userMessage: buildBetParseUserMessage(rawInput),
    tool: betParseTool,
    toolName: BET_PARSE_TOOL_NAME,
    maxTokens: BET_PARSE_MAX_TOKENS,
    temperature: model.temperature,
  };

  const provider = getProviderForModel(model);
  const providerKey = provider.providerKey;
  if (!isAIProvider(providerKey)) {
    return { ok: false, status: "parse-falhou", message: "provider inválido" };
  }
  // Sem chave → auditado (provider_error) + parse-falhou, zero gasto (padrão do #227).
  if (!provider.hasKey()) {
    const msg = `${providerKey} provider has no API key configured`;
    await persistAiCallError({
      userId,
      matchId,
      provider: providerKey,
      model: model.id,
      inputPayload: request as unknown as Record<string, unknown>,
      outputPayload: { error: msg },
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      status: "provider_error",
      errorMessage: msg,
      promptVersion: BET_PARSE_VERSION,
    });
    return { ok: false, status: "parse-falhou", message: msg };
  }

  const result = await provider.runAnalysis(request);

  if (!result.ok) {
    await persistAiCallError({
      userId,
      matchId,
      provider: providerKey,
      model: model.id,
      inputPayload: result.inputPayload,
      outputPayload: result.outputPayload,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: result.latencyMs,
      status: result.status,
      errorMessage: result.message,
      promptVersion: BET_PARSE_VERSION,
    });
    return { ok: false, status: "parse-falhou", message: result.message };
  }

  const { inputTokens, outputTokens } = result.usage;

  if (result.toolInput === undefined) {
    await persistAiCallError({
      userId,
      matchId,
      provider: providerKey,
      model: model.id,
      inputPayload: result.inputPayload,
      outputPayload: result.outputPayload,
      inputTokens,
      outputTokens,
      latencyMs: result.latencyMs,
      status: "tool_missing",
      errorMessage: `model did not call ${BET_PARSE_TOOL_NAME}`,
      promptVersion: BET_PARSE_VERSION,
    });
    return {
      ok: false,
      status: "parse-falhou",
      message: "o modelo não devolveu pernas",
    };
  }

  // Envelope malformado ou legs vazio → parse-falhou (Decisão 2). O safeParse do
  // envelope NÃO valida cada perna (legs é unknown[]) — a validação dura é por-item.
  const envelope = BetParseEnvelopeSchema.safeParse(result.toolInput);
  if (!envelope.success || envelope.data.legs.length === 0) {
    await persistAiCallError({
      userId,
      matchId,
      provider: providerKey,
      model: model.id,
      inputPayload: result.inputPayload,
      outputPayload: result.outputPayload,
      inputTokens,
      outputTokens,
      latencyMs: result.latencyMs,
      status: "invalid_output",
      errorMessage: envelope.success
        ? "envelope de parse sem pernas"
        : JSON.stringify(envelope.error.issues),
      promptVersion: BET_PARSE_VERSION,
    });
    return {
      ok: false,
      status: "parse-falhou",
      message: "não entendi nenhuma aposta no texto",
    };
  }

  // Validação POR-ITEM: cada item da união .strict(); inválido → aviso + DROP
  // (Decisão 1/2). Cap MAX_LEGS por slip (o excedente é dropado com aviso).
  const legs: BetLeg[] = [];
  const warnings: BetParseWarning[] = [];
  for (const item of envelope.data.legs) {
    if (legs.length >= MAX_LEGS) {
      warnings.push({
        message: `só avalio até ${MAX_LEGS} pernas por aposta — o restante foi ignorado`,
      });
      break;
    }
    const parsed = BetLegSchema.safeParse(item);
    if (parsed.success) {
      legs.push(parsed.data);
    } else {
      const kind =
        item && typeof item === "object" && "kind" in item
          ? String((item as { kind: unknown }).kind)
          : "desconhecida";
      warnings.push({
        message: `não consegui interpretar uma perna (${kind}) — confira ou reescreva`,
      });
    }
  }

  // Todas as pernas dropadas → parse-falhou (nada válido pra confirmar). O ai_call
  // ainda é logado como ok (a chamada em si funcionou) mais abaixo? NÃO: sem perna
  // válida não há slip; loga como invalid_output e retorna parse-falhou.
  if (legs.length === 0) {
    await persistAiCallError({
      userId,
      matchId,
      provider: providerKey,
      model: model.id,
      inputPayload: result.inputPayload,
      outputPayload: result.outputPayload,
      inputTokens,
      outputTokens,
      latencyMs: result.latencyMs,
      status: "invalid_output",
      errorMessage: "todas as pernas do parse foram dropadas na validação por-item",
      promptVersion: BET_PARSE_VERSION,
    });
    return {
      ok: false,
      status: "parse-falhou",
      message: "não consegui interpretar nenhuma aposta válida",
    };
  }

  // Sucesso: loga ai_call status ok e devolve o id (→ slip.parseAiCallId no confirm).
  const cost = calculateCost({ model: model.id, inputTokens, outputTokens });
  let aiCallId: string | null = null;
  try {
    const [row] = await db
      .insert(aiCalls)
      .values({
        userId,
        matchId,
        provider: providerKey,
        model: model.id,
        promptVersion: BET_PARSE_VERSION,
        inputPayload: result.inputPayload,
        outputPayload: result.outputPayload,
        inputTokens,
        outputTokens,
        latencyMs: result.latencyMs,
        costUsd: cost.toFixed(6),
        status: "ok",
        errorMessage: null,
      })
      .returning({ id: aiCalls.id });
    aiCallId = row.id;
  } catch (err) {
    // O log de auditoria é best-effort (como em palpites): o parse SOBREVIVE à
    // falha do insert — o slip só perde o ponteiro parseAiCallId (nullable).
    console.error(
      JSON.stringify({
        scope: "parseBetText",
        matchId,
        error: "bet_parse_ai_call_insert_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  return {
    ok: true,
    legs,
    warnings,
    comboUserOdd: envelope.data.comboUserOdd,
    aiCallId,
  };
}
