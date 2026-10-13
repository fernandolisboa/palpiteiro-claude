import { z } from "zod";

import { aiCalls } from "@/db/schema";
import { persistAiCallError } from "@/lib/ai/ai-call-logging";
import { calculateCost } from "@/lib/ai/cost";
import { MODEL_REGISTRY, isAIProvider } from "@/lib/ai/models";
import { getProviderForModel } from "@/lib/ai/providers";
import type { AiCallStatus, AnalysisRequest } from "@/lib/ai/providers/types";
import { db } from "@/lib/db";
import { stripPlayerNames } from "@/lib/user-palpite/check-claims";
import type { TeamNames } from "@/lib/user-palpite/reading";
import { ClaimSchema, MAX_CLAIMS, type Claim } from "@/lib/user-palpite/types";

import {
  EXTRACT_SYSTEM_PROMPT,
  USER_PALPITE_EXTRACT_TOOL_NAME,
  USER_PALPITE_EXTRACT_VERSION,
  buildExtractUserMessage,
  extractTool,
} from "./extract-cartridge";

// Extração Haiku do motivo do "Seu palpite" (#564, ADR 0054) pelo seam AIProvider, com
// log em `ai_calls` — mesma disciplina de lib/ai/bet-parse/parse.ts: nunca SDK direto,
// nunca por predict.ts. Sem `canFitCall`: a action começa agora e a extração é a 1ª
// chamada (cabe sempre); o `deadlineAt` ainda vai pro adapter cortar o timeout.

const EXTRACT_MODEL = MODEL_REGISTRY["claude-haiku-4-5"];
const EXTRACT_MAX_TOKENS = 1500;

// Envelope frouxo: o item a item é o Zod de verdade (ClaimSchema); o teto de 8 é do
// código (o excedente é cortado com aviso).
export const ExtractEnvelopeSchema = z.object({ claims: z.array(z.unknown()) }).strict();

export type ExtractResult =
  | { ok: true; claims: Claim[]; warnings: string[]; aiCallId: string | null }
  | { ok: false; message: string; aiCallId: string | null };

export async function extractPalpiteClaims(args: {
  reason: string;
  teams: TeamNames;
  matchId: string;
  userId: string;
  deadlineAt?: number;
}): Promise<ExtractResult> {
  const { userId, matchId } = args;
  const model = EXTRACT_MODEL;
  const request: AnalysisRequest = {
    model,
    system: EXTRACT_SYSTEM_PROMPT,
    userMessage: buildExtractUserMessage(args.reason, args.teams),
    tool: extractTool,
    toolName: USER_PALPITE_EXTRACT_TOOL_NAME,
    maxTokens: EXTRACT_MAX_TOKENS,
    temperature: model.temperature,
    deadlineAt: args.deadlineAt,
  };
  const provider = getProviderForModel(model);
  const providerKey = provider.providerKey;
  if (!isAIProvider(providerKey)) {
    return { ok: false, message: "provider inválido", aiCallId: null };
  }

  const fail = async (
    status: Exclude<AiCallStatus, "ok">,
    errorMessage: string,
    payload: {
      inputPayload: Record<string, unknown>;
      outputPayload: Record<string, unknown>;
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
    },
  ): Promise<ExtractResult> => {
    const aiCallId = await persistAiCallError({
      userId,
      matchId,
      provider: providerKey,
      model: model.id,
      ...payload,
      status,
      errorMessage,
      promptVersion: USER_PALPITE_EXTRACT_VERSION,
    });
    return { ok: false, message: errorMessage, aiCallId };
  };

  if (!provider.hasKey()) {
    const msg = `${providerKey} provider has no API key configured`;
    return fail("provider_error", msg, {
      inputPayload: request as unknown as Record<string, unknown>,
      outputPayload: { error: msg },
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    });
  }

  const result = await provider.runAnalysis(request);
  const payload = {
    inputPayload: result.inputPayload,
    outputPayload: result.outputPayload,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    latencyMs: result.latencyMs,
  };
  if (!result.ok) return fail(result.status, result.message, payload);
  if (result.toolInput === undefined) {
    return fail("tool_missing", `model did not call ${USER_PALPITE_EXTRACT_TOOL_NAME}`, payload);
  }
  const envelope = ExtractEnvelopeSchema.safeParse(result.toolInput);
  if (!envelope.success) {
    return fail("invalid_output", JSON.stringify(envelope.error.issues), payload);
  }

  const claims: Claim[] = [];
  const warnings: string[] = [];
  let dropped = 0;
  for (const item of envelope.data.claims) {
    const parsed = ClaimSchema.safeParse(item);
    if (!parsed.success) {
      dropped++;
      continue;
    }
    if (claims.length >= MAX_CLAIMS) {
      warnings.push(
        `Considerei só as ${MAX_CLAIMS} primeiras afirmações do seu motivo.`,
      );
      break;
    }
    const c = parsed.data;
    // Nome de jogador não fica na paráfrase (LGPD): ela vai ao narrador e à tela.
    claims.push(c.players ? { ...c, text: stripPlayerNames(c.text, c.players) } : c);
  }
  if (dropped > 0) {
    warnings.push(
      dropped === 1
        ? "Não entendi uma das suas afirmações; ela ficou de fora."
        : `Não entendi ${dropped} das suas afirmações; elas ficaram de fora.`,
    );
  }

  // Sucesso (inclusive zero afirmações: motivo só de opinião). Log best-effort.
  const cost = calculateCost({
    model: model.id,
    inputTokens: payload.inputTokens,
    outputTokens: payload.outputTokens,
  });
  let aiCallId: string | null = null;
  try {
    const [row] = await db
      .insert(aiCalls)
      .values({
        userId,
        matchId,
        provider: providerKey,
        model: model.id,
        promptVersion: USER_PALPITE_EXTRACT_VERSION,
        ...payload,
        costUsd: cost.toFixed(6),
        status: "ok",
        errorMessage: null,
      })
      .returning({ id: aiCalls.id });
    aiCallId = row?.id ?? null;
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "extractPalpiteClaims",
        matchId,
        error: "ai_call_insert_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
  return { ok: true, claims, warnings, aiCallId };
}
