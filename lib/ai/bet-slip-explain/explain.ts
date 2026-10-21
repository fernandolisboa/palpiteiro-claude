import { aiCalls } from "@/db/schema";
import { persistAiCallError } from "@/lib/ai/ai-call-logging";
import { calculateCost } from "@/lib/ai/cost";
import { canFitCall } from "@/lib/ai/deadline";
import type { Effort } from "@/lib/ai/generation-params";
import { MODEL_REGISTRY, isAIProvider, type AIModel } from "@/lib/ai/models";
import { getProviderForModel } from "@/lib/ai/providers";
import type { AiCallStatus, AnalysisRequest } from "@/lib/ai/providers/types";
import { resolveUserRunModelId } from "@/lib/ai/user-run-model";
import { db } from "@/lib/db";
import type { BetExplainInput } from "@/lib/bets/explain-input";

import {
  BET_SLIP_EXPLAIN_VERSION,
  EXPLAIN_SYSTEM_PROMPT,
  EXPLAIN_TOOL_NAME,
  buildExplainUserMessage,
  explainTool,
} from "./cartridge";
import { templatedBetExplanation } from "./fallback";
import { checkExplanationFidelity, checkExplanationLanguage } from "./fidelity";
import { BetExplanationSchema, type BetExplanation } from "./schema";

// "Explicar com IA" nas apostas registradas (#562, ADR 0063), com o modelo de análise
// do usuário, pelo seam AIProvider (fora do predict, como a narração do "Seu palpite",
// ADR 0055 §8) e com log em `ai_calls` (`servedModel`). Os números e o veredito já vêm
// do código. NUNCA lança: qualquer falha (sem chave, provider, tool ausente, Zod,
// guardas, prazo) vira o template, com a row registrando o status.

export const EXPLAIN_MAX_TOKENS = 2000;
const EXPLAIN_EFFORT: Effort = "low";

export type ExplainBetSlipResult = {
  explanation: BetExplanation;
  source: "llm" | "template";
  aiCallId: string | null;
};

export async function explainBetSlipWithAI(args: {
  input: BetExplainInput;
  userId: string;
  matchId: string;
  isAdmin: boolean;
  deadlineAt?: number;
}): Promise<ExplainBetSlipResult> {
  const { input, userId, matchId } = args;
  const template = (aiCallId: string | null): ExplainBetSlipResult => ({
    explanation: templatedBetExplanation(input),
    source: "template",
    aiCallId,
  });

  try {
    const model =
      MODEL_REGISTRY[await resolveUserRunModelId(userId, args.isAdmin)];
    const request: AnalysisRequest = {
      model,
      system: EXPLAIN_SYSTEM_PROMPT,
      userMessage: buildExplainUserMessage(input),
      tool: explainTool,
      toolName: EXPLAIN_TOOL_NAME,
      maxTokens: EXPLAIN_MAX_TOKENS,
      effort: EXPLAIN_EFFORT,
      deadlineAt: args.deadlineAt,
    };
    const provider = getProviderForModel(model);
    const providerKey = provider.providerKey;
    if (!isAIProvider(providerKey)) return template(null);

    // `servedModel`: o modelo que respondeu; o pedido quando não houve chamada.
    const fail = async (
      servedModel: AIModel,
      status: Exclude<AiCallStatus, "ok">,
      errorMessage: string,
      payload: {
        inputPayload: Record<string, unknown>;
        outputPayload: Record<string, unknown>;
        inputTokens: number;
        outputTokens: number;
        latencyMs: number;
      } = {
        inputPayload: request as unknown as Record<string, unknown>,
        outputPayload: { error: errorMessage },
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      }
    ) =>
      template(
        await persistAiCallError({
          userId,
          matchId,
          provider: providerKey,
          model: servedModel,
          ...payload,
          status,
          errorMessage,
          promptVersion: BET_SLIP_EXPLAIN_VERSION,
        })
      );

    if (!provider.hasKey()) {
      return fail(
        model,
        "provider_error",
        `${providerKey} provider has no API key configured`
      );
    }
    // Uma chamada que o timeout cortaria não é iniciada (padrão do narrador do predict).
    const fits = canFitCall(args.deadlineAt, {
      speed: model.speed,
      maxTokens: EXPLAIN_MAX_TOKENS,
      effort: EXPLAIN_EFFORT,
    });
    if (!fits) {
      return fail(
        model,
        "timeout",
        "deadline exceeded before the explanation; nothing was sent"
      );
    }

    const result = await provider.runAnalysis(request);
    const served = result.servedModel;
    const payload = {
      inputPayload: result.inputPayload,
      outputPayload: result.outputPayload,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: result.latencyMs,
    };
    if (!result.ok) return fail(served, result.status, result.message, payload);
    if (result.toolInput === undefined) {
      return fail(
        served,
        "tool_missing",
        `model did not call ${EXPLAIN_TOOL_NAME}`,
        payload
      );
    }
    const parsed = BetExplanationSchema.safeParse(result.toolInput);
    if (!parsed.success) {
      return fail(
        served,
        "invalid_output",
        JSON.stringify(parsed.error.issues),
        payload
      );
    }
    const fidelity = checkExplanationFidelity(parsed.data, input);
    if (!fidelity.ok)
      return fail(served, "invalid_output", fidelity.reason, payload);
    const language = checkExplanationLanguage(parsed.data);
    if (!language.ok)
      return fail(served, "invalid_output", language.reason, payload);

    const cost = calculateCost({
      model: served,
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
          model: served.id,
          promptVersion: BET_SLIP_EXPLAIN_VERSION,
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
          scope: "explainBetSlip",
          matchId,
          error: "ai_call_insert_failed",
          message: err instanceof Error ? err.message : String(err),
        })
      );
    }
    return { explanation: parsed.data, source: "llm", aiCallId };
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "explainBetSlip",
        matchId,
        error: "explanation_failed",
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return template(null);
  }
}
