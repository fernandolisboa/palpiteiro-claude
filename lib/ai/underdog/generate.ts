import type { z } from "zod";

import { aiCalls } from "@/db/schema";
import { persistAiCallError } from "@/lib/ai/ai-call-logging";
import { calculateCost } from "@/lib/ai/cost";
import { canFitCall } from "@/lib/ai/deadline";
import type { Effort } from "@/lib/ai/generation-params";
import {
  isAIProvider,
  MODEL_REGISTRY,
  UTILITY_EFFORT,
  UTILITY_MODEL_ID,
  type AIModel,
  type AIProviderKey,
} from "@/lib/ai/models";
import { getProviderForModel } from "@/lib/ai/providers";
import type {
  AiCallStatus,
  AnalysisRequest,
  ToolDef,
} from "@/lib/ai/providers/types";
import { resolveUserRunModelId } from "@/lib/ai/user-run-model";
import { db } from "@/lib/db";
import type { FactsBlock } from "@/lib/underdog/facts";
import type { UnderdogFacts, UnderdogNarrative } from "@/lib/underdog/types";

import {
  ADVOCATE_SYSTEM_PROMPT,
  ADVOCATE_TOOL_NAME,
  advocateTool,
  buildAdvocateUserMessage,
  UNDERDOG_ADVOCATE_VERSION,
} from "./advocate-cartridge";
import { templatedNarrative } from "./fallback";
import { draftSurvives, guardDraft, mergeReview } from "./merge";
import {
  buildReviewUserMessage,
  REVIEW_SYSTEM_PROMPT,
  REVIEW_TOOL_NAME,
  reviewTool,
  UNDERDOG_REVIEW_VERSION,
} from "./review-cartridge";
import { UnderdogCaseSchema, UnderdogReviewSchema } from "./schema";

// Advogado da zebra + revisor adversarial (#671, ADR 0072). Segunda porta de LLM, fora
// do predict (como o "Explicar com IA", ADR 0063 §5): seam AIProvider, uma row em
// ai_calls por chamada (promptVersion de cada uma, custo com cache, modelo que serviu).
// NUNCA lança. `failure`:
//   - none: texto da IA revisado;
//   - guards: o rascunho não passou (Zod/guardas do advogado, ou o revisor deixou menos
//     de 2 frases apoiadas) → texto padrão, que GRAVA (determinístico);
//   - infra: chave, provider, prazo, ferramenta ausente ou QUALQUER falha do revisor →
//     texto padrão que NÃO grava (o usuário pode tentar de novo).

export const ADVOCATE_MAX_TOKENS = 1500;
export const REVIEW_MAX_TOKENS = 1000;
const ADVOCATE_EFFORT: Effort = "low";

export type UnderdogGenerateFailure = "none" | "guards" | "infra";

export type GenerateUnderdogResult = {
  narrative: UnderdogNarrative;
  source: "llm" | "template";
  failure: UnderdogGenerateFailure;
  persist: boolean;
  advocateAiCallId: string | null;
  reviewerAiCallId: string | null;
};

type CallPayload = {
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  latencyMs: number;
};

type CallOk<T> = {
  ok: true;
  data: T;
  served: AIModel;
  provider: AIProviderKey;
  payload: CallPayload;
};
type CallFail = {
  ok: false;
  failure: "infra" | "output";
  aiCallId: string | null;
};

type Ctx = { userId: string; matchId: string; deadlineAt?: number };

// Família pra tela ("Advogado da zebra · Sonnet"): o rótulo sem o parêntese.
export const familyLabel = (m: AIModel) => m.label.replace(/\s*\(.*\)\s*$/, "");

async function logError(
  ctx: Ctx,
  provider: AIProviderKey,
  model: AIModel,
  promptVersion: string,
  status: Exclude<AiCallStatus, "ok">,
  errorMessage: string,
  payload?: CallPayload
): Promise<string | null> {
  return persistAiCallError({
    userId: ctx.userId,
    matchId: ctx.matchId,
    provider,
    model,
    ...(payload ?? {
      inputPayload: { promptVersion },
      outputPayload: { error: errorMessage },
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
    }),
    status,
    errorMessage,
    promptVersion,
  });
}

async function logOk(
  ctx: Ctx,
  call: CallOk<unknown>,
  promptVersion: string
): Promise<string | null> {
  const cost = calculateCost({
    model: call.served,
    inputTokens: call.payload.inputTokens,
    outputTokens: call.payload.outputTokens,
    cacheCreationInputTokens: call.payload.cacheCreationInputTokens,
    cacheReadInputTokens: call.payload.cacheReadInputTokens,
  });
  try {
    const [row] = await db
      .insert(aiCalls)
      .values({
        userId: ctx.userId,
        matchId: ctx.matchId,
        provider: call.provider,
        model: call.served.id,
        promptVersion,
        ...call.payload,
        costUsd: cost.toFixed(6),
        status: "ok",
        errorMessage: null,
      })
      .returning({ id: aiCalls.id });
    return row?.id ?? null;
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "underdog",
        matchId: ctx.matchId,
        error: "ai_call_insert_failed",
        promptVersion,
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return null;
  }
}

async function callTool<T>(
  ctx: Ctx,
  args: {
    model: AIModel;
    system: string;
    userMessage: string;
    tool: ToolDef;
    toolName: string;
    maxTokens: number;
    effort: Effort;
    promptVersion: string;
    schema: z.ZodType<T>;
  }
): Promise<CallOk<T> | CallFail> {
  const request: AnalysisRequest = {
    model: args.model,
    system: args.system,
    userMessage: args.userMessage,
    tool: args.tool,
    toolName: args.toolName,
    maxTokens: args.maxTokens,
    effort: args.effort,
    deadlineAt: ctx.deadlineAt,
  };
  const provider = getProviderForModel(args.model);
  const key = provider.providerKey;
  if (!isAIProvider(key))
    return { ok: false, failure: "infra", aiCallId: null };
  const infra = async (
    model: AIModel,
    status: Exclude<AiCallStatus, "ok">,
    message: string,
    payload?: CallPayload
  ): Promise<CallFail> => ({
    ok: false,
    failure: "infra",
    aiCallId: await logError(
      ctx,
      key,
      model,
      args.promptVersion,
      status,
      message,
      payload
    ),
  });
  if (!provider.hasKey()) {
    return infra(
      args.model,
      "provider_error",
      `${key} provider has no API key configured`
    );
  }
  // Chamada que o prazo cortaria não é iniciada (padrão do narrador e do explain).
  if (
    !canFitCall(ctx.deadlineAt, {
      speed: args.model.speed,
      maxTokens: args.maxTokens,
      effort: args.effort,
    })
  ) {
    return infra(
      args.model,
      "timeout",
      "deadline exceeded before the call; nothing was sent"
    );
  }
  const result = await provider.runAnalysis(request);
  const served = result.servedModel;
  const payload: CallPayload = {
    inputPayload: result.inputPayload,
    outputPayload: result.outputPayload,
    ...result.usage,
    latencyMs: result.latencyMs,
  };
  if (!result.ok) return infra(served, result.status, result.message, payload);
  if (result.toolInput === undefined) {
    return infra(
      served,
      "tool_missing",
      `model did not call ${args.toolName}`,
      payload
    );
  }
  const parsed = args.schema.safeParse(result.toolInput);
  if (!parsed.success) {
    return {
      ok: false,
      failure: "output",
      aiCallId: await logError(
        ctx,
        key,
        served,
        args.promptVersion,
        "invalid_output",
        JSON.stringify(parsed.error.issues).slice(0, 2000),
        payload
      ),
    };
  }
  return { ok: true, data: parsed.data, served, provider: key, payload };
}

export async function generateUnderdogCase(args: {
  facts: UnderdogFacts;
  block: FactsBlock;
  // Nomes de EXIBIÇÃO (o texto padrão usa os mesmos do bloco).
  teams: { home: string; away: string };
  userId: string;
  matchId: string;
  isAdmin: boolean;
  deadlineAt?: number;
}): Promise<GenerateUnderdogResult> {
  const ctx: Ctx = {
    userId: args.userId,
    matchId: args.matchId,
    deadlineAt: args.deadlineAt,
  };
  let advocateAiCallId: string | null = null;
  let reviewerAiCallId: string | null = null;
  const template = (
    failure: Exclude<UnderdogGenerateFailure, "none">,
    total = 0
  ): GenerateUnderdogResult => ({
    narrative: templatedNarrative(args.facts, args.teams, total),
    source: "template",
    failure,
    persist: failure === "guards",
    advocateAiCallId,
    reviewerAiCallId,
  });
  const log = (event: string, detail: Record<string, unknown> = {}) =>
    console.warn(
      JSON.stringify({
        scope: "underdog",
        matchId: args.matchId,
        event,
        ...detail,
      })
    );

  try {
    const advocateModel =
      MODEL_REGISTRY[await resolveUserRunModelId(args.userId, args.isAdmin)];
    const advocate = await callTool(ctx, {
      model: advocateModel,
      system: ADVOCATE_SYSTEM_PROMPT,
      userMessage: buildAdvocateUserMessage(args.block.text),
      tool: advocateTool,
      toolName: ADVOCATE_TOOL_NAME,
      maxTokens: ADVOCATE_MAX_TOKENS,
      effort: ADVOCATE_EFFORT,
      promptVersion: UNDERDOG_ADVOCATE_VERSION,
      schema: UnderdogCaseSchema,
    });
    if (!advocate.ok) {
      advocateAiCallId = advocate.aiCallId;
      return template(advocate.failure === "output" ? "guards" : "infra");
    }

    const guarded = guardDraft(advocate.data, args.block);
    if (!draftSurvives(guarded)) {
      advocateAiCallId = await logError(
        ctx,
        advocate.provider,
        advocate.served,
        UNDERDOG_ADVOCATE_VERSION,
        "invalid_output",
        `guards: ${guarded.reasons.join("; ")}`.slice(0, 2000),
        advocate.payload
      );
      log("draft_rejected", { reasons: guarded.reasons });
      return template("guards", guarded.total);
    }
    advocateAiCallId = await logOk(ctx, advocate, UNDERDOG_ADVOCATE_VERSION);

    const review = await callTool(ctx, {
      model: MODEL_REGISTRY[UTILITY_MODEL_ID],
      system: REVIEW_SYSTEM_PROMPT,
      userMessage: buildReviewUserMessage(args.block.text, guarded.survivors),
      tool: reviewTool,
      toolName: REVIEW_TOOL_NAME,
      maxTokens: REVIEW_MAX_TOKENS,
      effort: UTILITY_EFFORT,
      promptVersion: UNDERDOG_REVIEW_VERSION,
      schema: UnderdogReviewSchema,
    });
    // Texto sem revisão não vai à tela; falha do revisor não grava (fail-closed).
    if (!review.ok) {
      reviewerAiCallId = review.aiCallId;
      return template("infra", guarded.total);
    }

    const merged = mergeReview({
      guarded,
      review: review.data,
      block: args.block,
      facts: args.facts,
      teams: args.teams,
      advocateFamily: familyLabel(advocate.served),
    });
    if (!merged.ok && merged.kind === "review_invalid") {
      reviewerAiCallId = await logError(
        ctx,
        review.provider,
        review.served,
        UNDERDOG_REVIEW_VERSION,
        "invalid_output",
        merged.reason,
        review.payload
      );
      return template("infra", guarded.total);
    }
    reviewerAiCallId = await logOk(ctx, review, UNDERDOG_REVIEW_VERSION);
    if (!merged.ok) {
      log("too_few_supported", { reason: merged.reason });
      return template("guards", guarded.total);
    }
    log("verdicts", {
      verdicts: merged.narrative.verdicts,
      cut: merged.narrative.cut,
      total: merged.narrative.total,
      counterpoint: merged.narrative.counterpointSource,
    });
    return {
      narrative: merged.narrative,
      source: "llm",
      failure: "none",
      persist: true,
      advocateAiCallId,
      reviewerAiCallId,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        scope: "underdog",
        matchId: args.matchId,
        error: "generate_failed",
        message: err instanceof Error ? err.message : String(err),
      })
    );
    return template("infra");
  }
}
