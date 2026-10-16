import { aiCalls } from "@/db/schema";
import { persistAiCallError } from "@/lib/ai/ai-call-logging";
import { calculateCost } from "@/lib/ai/cost";
import { canFitCall } from "@/lib/ai/deadline";
import type { Effort } from "@/lib/ai/generation-params";
import {
  MODEL_REGISTRY,
  isAIProvider,
  isModelAllowedForAudience,
  type AIModelId,
} from "@/lib/ai/models";
import { getProviderForModel } from "@/lib/ai/providers";
import type { AiCallStatus, AnalysisRequest } from "@/lib/ai/providers/types";
import { db } from "@/lib/db";
import { getDefaultModelId } from "@/lib/db/queries/ai-config";
import { getPreferredModelId } from "@/lib/db/queries/users";
import {
  PalpiteNarrationSchema,
  type NarrationSource,
  type PalpiteNarration,
} from "@/lib/user-palpite/types";

import { templatedPalpiteNarration } from "./fallback";
import {
  checkPalpiteNarrationFidelity,
  checkPalpiteNarrationLanguage,
} from "./fidelity";
import {
  NARRATE_TOOL_NAME,
  buildNarrateUserMessage,
  narrateSpecFor,
  narrateTool,
  type NarrationInput,
} from "./narrate-cartridge";

// Narração do "Seu palpite" (#564, ADR 0055) com o modelo de análise do usuário (a
// cascata do predict: preferência filtrada pela audiência, senão o default global), pelo
// seam AIProvider e com log em `ai_calls`. Orçamento pequeno de propósito: o texto é
// curto e o veredito/números já vêm do código. NUNCA lança: qualquer falha (sem chave,
// provider, tool ausente, Zod, guardas, prazo) vira o template, com a row registrando o
// status.

export const NARRATE_MAX_TOKENS = 2000;
const NARRATE_EFFORT: Effort = "low";

export type NarratePalpiteResult = {
  narration: PalpiteNarration;
  source: NarrationSource;
  aiCallId: string | null;
};

async function resolveRunModelId(userId: string, isAdmin: boolean): Promise<AIModelId> {
  const pref = await getPreferredModelId(userId);
  return pref && isModelAllowedForAudience(pref, isAdmin) ? pref : getDefaultModelId();
}

export async function narratePalpite(args: {
  input: NarrationInput;
  userId: string;
  matchId: string;
  isAdmin: boolean;
  deadlineAt?: number;
}): Promise<NarratePalpiteResult> {
  const { input, userId, matchId } = args;
  // Ao vivo (#594): user_palpite_narrate_live_v1; pré-jogo: o de sempre.
  const spec = narrateSpecFor(input);
  const template = (aiCallId: string | null): NarratePalpiteResult => ({
    narration: templatedPalpiteNarration(input),
    source: "template",
    aiCallId,
  });

  try {
    const model = MODEL_REGISTRY[await resolveRunModelId(userId, args.isAdmin)];
    const request: AnalysisRequest = {
      model,
      system: spec.system,
      userMessage: buildNarrateUserMessage(input),
      tool: narrateTool,
      toolName: NARRATE_TOOL_NAME,
      maxTokens: NARRATE_MAX_TOKENS,
      effort: NARRATE_EFFORT,
      deadlineAt: args.deadlineAt,
    };
    const provider = getProviderForModel(model);
    const providerKey = provider.providerKey;
    if (!isAIProvider(providerKey)) return template(null);

    const fail = async (
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
      },
    ) =>
      template(
        await persistAiCallError({
          userId,
          matchId,
          provider: providerKey,
          model: model.id,
          ...payload,
          status,
          errorMessage,
          promptVersion: spec.version,
        }),
      );

    if (!provider.hasKey()) {
      return fail("provider_error", `${providerKey} provider has no API key configured`);
    }
    // Uma narração que o timeout cortaria não é iniciada (padrão do narrador do predict).
    const fits = canFitCall(args.deadlineAt, {
      speed: model.speed,
      maxTokens: NARRATE_MAX_TOKENS,
      effort: NARRATE_EFFORT,
    });
    if (!fits) {
      return fail("timeout", "deadline exceeded before the narration; nothing was sent");
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
      return fail("tool_missing", `model did not call ${NARRATE_TOOL_NAME}`, payload);
    }
    const parsed = PalpiteNarrationSchema.safeParse(result.toolInput);
    if (!parsed.success) {
      return fail("invalid_output", JSON.stringify(parsed.error.issues), payload);
    }
    const fidelity = checkPalpiteNarrationFidelity(parsed.data, input);
    if (!fidelity.ok) return fail("invalid_output", fidelity.reason, payload);
    const language = checkPalpiteNarrationLanguage(parsed.data);
    if (!language.ok) return fail("invalid_output", language.reason, payload);

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
          promptVersion: spec.version,
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
          scope: "narratePalpite",
          matchId,
          error: "ai_call_insert_failed",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return { narration: parsed.data, source: "llm", aiCallId };
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "narratePalpite",
        matchId,
        error: "narration_failed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return template(null);
  }
}
