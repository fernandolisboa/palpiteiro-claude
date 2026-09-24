import { calculateJudgmentCost } from "@/lib/ai/cost";
import {
  TypeSafeError,
  type TypeSafeErrorKind,
} from "@/lib/ai/providers/typesafe/errors";

import {
  JUDGMENT_QUESTION_IDS,
  JUDGMENT_QUESTIONS,
  JUDGMENTS_VERSION,
} from "./questions";
import { buildJudgmentState, type JudgmentStateInput } from "./state";
import type { JudgmentAnswers, JudgmentProvider, JudgmentState } from "./types";

export type MatchJudgments = {
  version: typeof JUDGMENTS_VERSION;
  answers: JudgmentAnswers;
  state: JudgmentState;
  model: string;
  inputTokens: number;
  costUsd: number;
  latencyMs: number;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
};

export type JudgmentFailure = {
  kind: TypeSafeErrorKind | "missing_key" | "unexpected";
  message: string;
  httpStatus: number | null;
  latencyMs: number;
  responseBody: unknown;
};

function toFailure(err: unknown): JudgmentFailure {
  if (err instanceof TypeSafeError) {
    return {
      kind: err.kind,
      message: err.message,
      httpStatus: err.httpStatus,
      latencyMs: err.latencyMs,
      responseBody: err.responseBody,
    };
  }
  return {
    kind: "unexpected",
    message: err instanceof Error ? err.message : String(err),
    httpStatus: null,
    latencyMs: 0,
    responseBody: null,
  };
}

// Uma chamada JEV por jogo (ADR 0041 §1). Fail-open: chave ausente ou QUALQUER
// erro → null (o chamador segue com λ_base e grava judgmentsApplied=false).
// Nunca lança. `onFailure` deixa o chamador logar a falha em ai_calls.
export async function judgeMatch(
  provider: JudgmentProvider,
  stateInput: JudgmentStateInput,
  options: { onFailure?: (failure: JudgmentFailure) => void } = {}
): Promise<MatchJudgments | null> {
  const report = (failure: JudgmentFailure) => {
    try {
      options.onFailure?.(failure);
    } catch {
      // O callback de log nunca pode furar o fail-open.
    }
  };

  try {
    if (!provider.hasKey()) {
      report({
        kind: "missing_key",
        message: "TYPESAFE_API_KEY ausente",
        httpStatus: null,
        latencyMs: 0,
        responseBody: null,
      });
      return null;
    }
    const state = buildJudgmentState(stateInput);
    const result = await provider.judge(state, JUDGMENT_QUESTIONS);

    const missing = JUDGMENT_QUESTION_IDS.filter((id) => !result.answers[id]);
    if (missing.length > 0) {
      throw new TypeSafeError({
        kind: "bad_response",
        message: `julgamentos sem resposta para: ${missing.join(", ")}`,
        latencyMs: result.latencyMs,
        responseBody: result.responsePayload,
      });
    }
    const answers = Object.fromEntries(
      JUDGMENT_QUESTION_IDS.map((id) => [id, result.answers[id]])
    ) as JudgmentAnswers;

    return {
      version: JUDGMENTS_VERSION,
      answers,
      state,
      model: result.model,
      inputTokens: result.inputTokens,
      costUsd: calculateJudgmentCost(result.inputTokens),
      latencyMs: result.latencyMs,
      requestPayload: result.requestPayload,
      responsePayload: result.responsePayload,
    };
  } catch (err) {
    report(toFailure(err));
    return null;
  }
}
